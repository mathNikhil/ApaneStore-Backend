const pool = require('../config/database');
const cashfreeService = require('../services/paymentGateway.service');
const discountService = require('../services/discount.service');

// ✅ Publish flow: domain + hosting + payment.
//
// This REPLACES the old direct "Ready to Publish -> status = 'published'"
// behavior. Now: domain/hosting choice -> (simulated) DNS if needed ->
// payment -> only THEN does stores.status flip to 'published'. If a tenant
// abandons the flow partway, resuming is driven by what's actually saved
// in store_domain_config / store_subscriptions, not a separate progress
// field — see getState().
const PublishFlowController = {
    // Maps a domain+hosting combination to its pricing_plans row and
    _publishStoreDirectly: async (id, tenantId, billingCycle, paymentMethod, termsAccepted, req, res) => {
        const domainConfigResult = await pool.query('SELECT * FROM store_domain_config WHERE store_id = $1', [id]);
        const domainConfig = domainConfigResult.rows[0];
        const resolvedKey = PublishFlowController._resolvePlanKey(domainConfig.domain_type, domainConfig.hosting_type);
        const cycle = billingCycle || 'annual';
        const planResult = await pool.query(
            'SELECT * FROM pricing_plans WHERE plan_key = $1 AND billing_cycle = $2 AND is_active = true',
            [resolvedKey, cycle]
        );
        const plan = planResult.rows.length > 0 ? planResult.rows[0] : { plan_key: resolvedKey, display_name: 'Test Plan', billing_cycle: cycle, base_amount: 0, tax_percentage: 0, validity_days: 365 };
        const baseAmount = parseFloat(plan.base_amount || 0);
        const taxAmount = baseAmount * (parseFloat(plan.tax_percentage || 0) / 100);
        const totalAmount = baseAmount + taxAmount;
        const subscriptionResult = await pool.query(
            `INSERT INTO store_subscriptions (store_id, plan_key, plan_name, billing_cycle, base_amount, tax_amount, total_amount, payment_status, payment_method, paid_at, valid_until, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8, NOW(), NOW() + ($9 || ' days')::interval, NOW())
             ON CONFLICT (store_id) DO UPDATE SET plan_key=$2, plan_name=$3, billing_cycle=$4, base_amount=$5, tax_amount=$6, total_amount=$7,
             payment_status='paid', payment_method=$8, paid_at=NOW(), valid_until=NOW() + ($9 || ' days')::interval, updated_at=NOW() RETURNING *`,
            [id, plan.plan_key, plan.display_name, plan.billing_cycle, baseAmount, taxAmount, totalAmount, paymentMethod || 'test', plan.validity_days]
        );
        const storeUpdateResult = await pool.query(
            `UPDATE stores SET status='published', published_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING id, store_id, store_name, subdomain, status, published_at`,
            [id]
        );
        const { TERMS_VERSION } = require('../config/terms');
        await pool.query(
            `INSERT INTO terms_acceptances (tenant_id, store_id, terms_version, ip_address) VALUES ($1, $2, $3, $4)`,
            [tenantId, id, TERMS_VERSION, req.ip || req.headers['x-forwarded-for'] || null]
        );
        // Increment publish count for test tenants (no real payment)
        await discountService.incrementPublishCount(tenantId);
        return res.json({ success: true, data: { subscription: subscriptionResult.rows[0], store: storeUpdateResult.rows[0] } });
    },

    // decides what DNS status it should start at. This is the single
    // source of truth for "which of the 3 valid combinations is this."
    _resolvePlanKey(domainType, hostingType) {
        if (domainType === 'subdomain') return 'subdomain_apnaestore';
        if (domainType === 'custom' && hostingType === 'apnaestore') return 'custom_domain_apnaestore';
        if (domainType === 'custom' && hostingType === 'own') return 'custom_domain_own_hosting';
        return null;
    },

    _initialDnsStatus(domainType, hostingType) {
        // Only the "custom domain, hosted by us" path needs the tenant to
        // actually do anything with DNS — we need their domain pointed at
        // our servers. A free subdomain uses a single wildcard DNS record
        // we control once, at the infrastructure level, not per store. And
        // if hosting is entirely their own, we're not involved in serving
        // it at all, so there's nothing of ours to point DNS at.
        if (domainType === 'custom' && hostingType === 'apnaestore') return 'pending';
        return 'not_required';
    },

    // GET /api/stores/:id/publish-flow
    // Combined state for resuming wherever the tenant left off.
    getState: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const storeCheck = await pool.query(
                'SELECT id, status, subdomain FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const domainConfigResult = await pool.query(
                'SELECT * FROM store_domain_config WHERE store_id = $1',
                [id]
            );
            const subscriptionResult = await pool.query(
                'SELECT * FROM store_subscriptions WHERE store_id = $1',
                [id]
            );

            res.json({
                success: true,
                data: {
                    store: storeCheck.rows[0],
                    domainConfig: domainConfigResult.rows[0] || null,
                    subscription: subscriptionResult.rows[0] || null,
                },
            });
        } catch (error) {
            console.error('❌ Get publish flow state error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get publish flow state' });
        }
    },

    // PUT /api/stores/:id/domain-config
    // body: { domainType, customDomain?, hostingType, ownHostingServerIp?, ownHostingProvider? }
    saveDomainConfig: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;
            const { domainType, customDomain, hostingType, ownHostingServerIp, ownHostingProvider } = req.body;

            if (!['subdomain', 'custom'].includes(domainType)) {
                return res.status(400).json({ success: false, error: 'Invalid domain type' });
            }
            if (!['apnaestore', 'own'].includes(hostingType)) {
                return res.status(400).json({ success: false, error: 'Invalid hosting type' });
            }
            if (domainType === 'subdomain' && hostingType === 'own') {
                return res.status(400).json({ success: false, error: 'A free subdomain can only be used with ApnaEstore hosting' });
            }
            if (domainType === 'custom' && !customDomain) {
                return res.status(400).json({ success: false, error: 'Custom domain is required' });
            }

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const dnsStatus = PublishFlowController._initialDnsStatus(domainType, hostingType);

            const result = await pool.query(
                `INSERT INTO store_domain_config
                    (store_id, domain_type, custom_domain, hosting_type, own_hosting_server_ip, own_hosting_provider, dns_status, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 ON CONFLICT (store_id) DO UPDATE
                 SET domain_type = $2, custom_domain = $3, hosting_type = $4,
                     own_hosting_server_ip = $5, own_hosting_provider = $6,
                     dns_status = $7, dns_verified_at = NULL, updated_at = NOW()
                 RETURNING *`,
                [id, domainType, customDomain || null, hostingType, ownHostingServerIp || null, ownHostingProvider || null, dnsStatus]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Save domain config error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to save domain configuration' });
        }
    },

    // POST /api/stores/:id/domain-config/verify-dns
    // Simulated — no real DNS lookup yet. Marks it verified immediately.
    verifyDns: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const result = await pool.query(
                `UPDATE store_domain_config
                 SET dns_status = 'verified', dns_verified_at = NOW(), updated_at = NOW()
                 WHERE store_id = $1
                 RETURNING *`,
                [id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Domain configuration not found — complete domain selection first' });
            }

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Verify DNS error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to verify DNS' });
        }
    },

    // POST /api/stores/:id/payment
    // body: { paymentMethod, billingCycle, termsAccepted }
    // Simulated payment — no real gateway yet. This is the step that
    // finally flips stores.status to 'published'.
    completePayment: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;
            const { paymentMethod, billingCycle, termsAccepted } = req.body;

            if (!termsAccepted) {
                return res.status(400).json({ success: false, error: 'You must accept the Terms & Conditions to publish your store.' });
            }

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            // Check if test tenant — bypass payment
            const tenantResult = await pool.query('SELECT mobile FROM tenants WHERE id = $1', [tenantId]);
            const tenantMobile = tenantResult.rows[0]?.mobile;
            if (cashfreeService.isTestTenant(tenantMobile)) {
                console.log(`✅ Test tenant ${tenantMobile} — bypassing payment`);
                return await PublishFlowController._publishStoreDirectly(id, tenantId, billingCycle, paymentMethod, termsAccepted, req, res);
            }

            const domainConfigResult = await pool.query(
                'SELECT * FROM store_domain_config WHERE store_id = $1',
                [id]
            );
            if (domainConfigResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Complete domain and hosting selection first' });
            }
            const domainConfig = domainConfigResult.rows[0];

            // A custom domain hosted by us must have verified DNS before
            // payment — everything else (subdomain, or own hosting) has
            // dns_status = 'not_required' and skips this check entirely.
            if (domainConfig.dns_status === 'pending') {
                return res.status(400).json({ success: false, error: 'Please verify your DNS configuration before proceeding to payment' });
            }

            const planKey = PublishFlowController._resolvePlanKey(domainConfig.domain_type, domainConfig.hosting_type);
            const cycle = billingCycle || 'annual';
            const planResult = await pool.query(
                'SELECT * FROM pricing_plans WHERE plan_key = $1 AND billing_cycle = $2 AND is_active = true',
                [planKey, cycle]
            );
            if (planResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'No active pricing plan found for this configuration' });
            }
            const plan = planResult.rows[0];

            const fullAmount = parseFloat(plan.base_amount) * (1 + parseFloat(plan.tax_percentage) / 100);
            let discountCalc = null;
            try {
                discountCalc = await discountService.calculateDiscount(tenantId, fullAmount, billingCycle || '365days', parseFloat(plan.tax_percentage || 18));
            } catch(e) {
                console.error('Discount calc error:', e.message);
            }
            const finalAmt = discountCalc ? discountCalc.finalAmount : fullAmount;
            const baseAmount = (finalAmt / (1 + parseFloat(plan.tax_percentage) / 100)).toFixed(2);
            const taxAmount = (finalAmt - parseFloat(baseAmount)).toFixed(2);
            const totalAmount = finalAmt.toFixed(2);

            const subscriptionResult = await pool.query(
                `INSERT INTO store_subscriptions
                    (store_id, plan_key, plan_name, billing_cycle, base_amount, tax_amount, total_amount, payment_status, payment_method, paid_at, valid_until, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8, NOW(), NOW() + ($9 || ' days')::interval, NOW())
                 ON CONFLICT (store_id) DO UPDATE
                 SET plan_key = $2, plan_name = $3, billing_cycle = $4, base_amount = $5, tax_amount = $6, total_amount = $7,
                     payment_status = 'paid', payment_method = $8, paid_at = NOW(),
                     valid_until = NOW() + ($9 || ' days')::interval, updated_at = NOW()
                 RETURNING *`,
                [id, plan.plan_key, plan.display_name, plan.billing_cycle, baseAmount, taxAmount, totalAmount, paymentMethod || 'upi', plan.validity_days]
            );

            // ✅ This is the only place stores.status should become
            // 'published' now — replaces the old direct-publish behavior.
            const storeUpdateResult = await pool.query(
                `UPDATE stores SET status = 'published', published_at = NOW(), updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, store_id, store_name, subdomain, status, published_at`,
                [id]
            );

            // ✅ Legal audit trail — records exactly which version of the
            // terms was accepted and when, tied to this tenant and store.
            const { TERMS_VERSION } = require('../config/terms');
            await pool.query(
                `INSERT INTO terms_acceptances (tenant_id, store_id, terms_version, ip_address)
                 VALUES ($1, $2, $3, $4)`,
                [tenantId, id, TERMS_VERSION, req.ip || req.headers['x-forwarded-for'] || null]
            );

            // Increment publish count and credit referrals after successful UPI payment
            await discountService.incrementPublishCount(tenantId);
            if (discountCalc && discountCalc.usableReferrals) await discountService.creditReferrals(tenantId, discountCalc.usableReferrals);

            res.json({
                success: true,
                data: {
                    subscription: subscriptionResult.rows[0],
                    store: storeUpdateResult.rows[0],
                },
            });
        } catch (error) {
            console.error('❌ Complete payment error:', error);
            res.status(500).json({ success: false, error: error.message || 'Payment failed' });
        }
    },
};

module.exports = PublishFlowController;

// POST /api/stores/:id/unpublish
PublishFlowController.unpublish = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId;

        const storeCheck = await pool.query(
            'SELECT id, status FROM stores WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );
        if (storeCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }
        if (storeCheck.rows[0].status !== 'published') {
            return res.status(400).json({ success: false, error: 'Store is not published' });
        }

        await pool.query(
            `UPDATE stores SET status = 'draft', updated_at = NOW() WHERE id = $1`,
            [id]
        );

        res.json({ success: true, message: 'Store unpublished successfully' });
    } catch (error) {
        console.error('❌ Unpublish error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to unpublish store' });
    }
};

// POST /api/stores/:id/republish
PublishFlowController.republish = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId;

        const storeCheck = await pool.query(
            'SELECT id, status FROM stores WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );
        if (storeCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }

        // Check if subscription is still valid
        const subResult = await pool.query(
            `SELECT * FROM store_subscriptions 
             WHERE store_id = $1 AND payment_status = 'paid' AND valid_until > NOW()`,
            [id]
        );

        if (subResult.rows.length === 0) {
            // Subscription expired — needs payment again
            return res.status(402).json({
                success: false,
                requiresPayment: true,
                error: 'Subscription expired. Please complete payment to republish.'
            });
        }

        // Subscription valid — instantly republish
        await pool.query(
            `UPDATE stores SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [id]
        );

        res.json({ success: true, message: 'Store republished successfully' });
    } catch (error) {
        console.error('❌ Republish error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to republish store' });
    }
};
