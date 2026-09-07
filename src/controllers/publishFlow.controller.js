const pool = require('../config/database');
const cashfreeService = require('../services/paymentGateway.service');
const discountService = require('../services/discount.service');
const dns = require('dns').promises;

// ✅ Aapna eStore's actual public EC2 server IP — shown to tenants on the DNS setup page
const AAPNA_SERVER_IP = '13.235.136.191';

const PublishFlowController = {

    // GET /api/stores/:id/dns-config
    // Returns the correct server IP and DNS records for the tenant to add at their registrar.
    getDnsConfig: async (req, res) => {
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

            const domainResult = await pool.query(
                'SELECT custom_domain, hosting_type FROM store_domain_config WHERE store_id = $1',
                [id]
            );
            if (domainResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Complete domain selection first' });
            }

            const { custom_domain, hosting_type } = domainResult.rows[0];

            res.json({
                success: true,
                data: {
                    serverIp: AAPNA_SERVER_IP,
                    hostingType: hosting_type,
                    domain: custom_domain,
                    records: [
                        { type: 'A',     name: '@',   value: AAPNA_SERVER_IP },
                        { type: 'CNAME', name: 'www', value: custom_domain },
                    ],
                },
            });
        } catch (error) {
            console.error('❌ Get DNS config error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get DNS config' });
        }
    },

    // Internal helper — publishes store directly (test tenants or own-hosting path)
    _publishStoreDirectly: async (id, tenantId, billingCycle, paymentMethod, termsAccepted, req, res) => {
        const domainConfigResult = await pool.query('SELECT * FROM store_domain_config WHERE store_id = $1', [id]);
        const domainConfig = domainConfigResult.rows[0];
        const resolvedKey = PublishFlowController._resolvePlanKey(domainConfig.domain_type, domainConfig.hosting_type);
        const cycle = billingCycle || 'annual';
        const planResult = await pool.query(
            'SELECT * FROM pricing_plans WHERE plan_key = $1 AND billing_cycle = $2 AND is_active = true',
            [resolvedKey, cycle]
        );
        const plan = planResult.rows.length > 0
            ? planResult.rows[0]
            : { plan_key: resolvedKey, display_name: 'Test Plan', billing_cycle: cycle, base_amount: 0, tax_percentage: 0, validity_days: 365 };

        const baseAmount = parseFloat(plan.base_amount || 0);
        const taxAmount  = baseAmount * (parseFloat(plan.tax_percentage || 0) / 100);
        const totalAmount = baseAmount + taxAmount;

        const subscriptionResult = await pool.query(
            `INSERT INTO store_subscriptions
                (store_id, plan_key, plan_name, billing_cycle, base_amount, tax_amount, total_amount,
                 payment_status, payment_method, paid_at, valid_until, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'paid',$8,NOW(),NOW()+($9||' days')::interval,NOW())
             ON CONFLICT (store_id) DO UPDATE
             SET plan_key=$2, plan_name=$3, billing_cycle=$4, base_amount=$5, tax_amount=$6,
                 total_amount=$7, payment_status='paid', payment_method=$8,
                 paid_at=NOW(), valid_until=NOW()+($9||' days')::interval, updated_at=NOW()
             RETURNING *`,
            [id, plan.plan_key, plan.display_name, plan.billing_cycle,
             baseAmount, taxAmount, totalAmount, paymentMethod || 'test', plan.validity_days]
        );

        const storeUpdateResult = await pool.query(
            `UPDATE stores SET status='published', published_at=NOW(), updated_at=NOW()
             WHERE id=$1
             RETURNING id, store_id, store_name, subdomain, status, published_at`,
            [id]
        );

        const { TERMS_VERSION } = require('../config/terms');
        await pool.query(
            `INSERT INTO terms_acceptances (tenant_id, store_id, terms_version, ip_address)
             VALUES ($1,$2,$3,$4)`,
            [tenantId, id, TERMS_VERSION, req.ip || req.headers['x-forwarded-for'] || null]
        );

        await discountService.incrementPublishCount(tenantId);

        return res.json({
            success: true,
            data: {
                subscription: subscriptionResult.rows[0],
                store: storeUpdateResult.rows[0],
            },
        });
    },

    _resolvePlanKey(domainType, hostingType) {
        if (domainType === 'subdomain') return 'subdomain_apnaestore';
        if (domainType === 'custom' && hostingType === 'apnaestore') return 'custom_domain_apnaestore';
        if (domainType === 'custom' && hostingType === 'own') return 'custom_domain_own_hosting';
        return null;
    },

    _initialDnsStatus(domainType, hostingType) {
        if (domainType === 'custom' && hostingType === 'apnaestore') return 'pending';
        return 'not_required';
    },

    // GET /api/stores/:id/publish-flow
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

            const domainConfigResult  = await pool.query('SELECT * FROM store_domain_config WHERE store_id = $1', [id]);
            const subscriptionResult  = await pool.query('SELECT * FROM store_subscriptions WHERE store_id = $1', [id]);

            res.json({
                success: true,
                data: {
                    store:        storeCheck.rows[0],
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
                    (store_id, domain_type, custom_domain, hosting_type,
                     own_hosting_server_ip, own_hosting_provider, dns_status, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                 ON CONFLICT (store_id) DO UPDATE
                 SET domain_type=$2, custom_domain=$3, hosting_type=$4,
                     own_hosting_server_ip=$5, own_hosting_provider=$6,
                     dns_status=$7, dns_verified_at=NULL, updated_at=NOW()
                 RETURNING *`,
                [id, domainType, customDomain || null, hostingType,
                 ownHostingServerIp || null, ownHostingProvider || null, dnsStatus]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Save domain config error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to save domain configuration' });
        }
    },

    // POST /api/stores/:id/domain-config/verify-dns
    // ✅ Real DNS lookup — checks tenant's domain A record resolves to our server IP.
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

            const domainResult = await pool.query(
                'SELECT custom_domain, hosting_type, dns_status FROM store_domain_config WHERE store_id = $1',
                [id]
            );
            if (domainResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Domain configuration not found — complete domain selection first' });
            }

            const { custom_domain, hosting_type, dns_status } = domainResult.rows[0];

            // Already verified — return immediately
            if (dns_status === 'verified') {
                const config = await pool.query('SELECT * FROM store_domain_config WHERE store_id = $1', [id]);
                return res.json({ success: true, verified: true, data: config.rows[0] });
            }

            // Only custom domain + Aapna hosting needs real DNS check
            if (hosting_type !== 'apnaestore' || !custom_domain) {
                const result = await pool.query(
                    `UPDATE store_domain_config
                     SET dns_status='verified', dns_verified_at=NOW(), updated_at=NOW()
                     WHERE store_id=$1 RETURNING *`,
                    [id]
                );
                return res.json({ success: true, verified: true, data: result.rows[0] });
            }

            // Real DNS lookup
            const cleanDomain = custom_domain
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
                .split('/')[0]
                .trim();

            let resolvedIps = [];
            let dnsError = null;

            try {
                resolvedIps = await dns.resolve4(cleanDomain);
                console.log(`[DNS-Verify] ${cleanDomain} resolves to: ${resolvedIps.join(', ')}`);
            } catch (e) {
                dnsError = e.message;
                console.log(`[DNS-Verify] ${cleanDomain} lookup failed: ${e.message}`);
            }

            const verified = resolvedIps.includes(AAPNA_SERVER_IP);

            if (verified) {
                const result = await pool.query(
                    `UPDATE store_domain_config
                     SET dns_status='verified', dns_verified_at=NOW(), updated_at=NOW()
                     WHERE store_id=$1 RETURNING *`,
                    [id]
                );
                console.log(`✅ [DNS-Verify] Store ${id} — ${cleanDomain} verified`);
                return res.json({ success: true, verified: true, data: result.rows[0] });
            }

            // Not verified yet — return pending with helpful message
            return res.json({
                success: true,
                verified: false,
                message: dnsError
                    ? `Domain not reachable yet. DNS error: ${dnsError}`
                    : `Domain resolves to ${resolvedIps.join(', ')} but needs to point to ${AAPNA_SERVER_IP}. DNS changes can take up to 48 hours.`,
                resolvedIps,
                expectedIp: AAPNA_SERVER_IP,
            });

        } catch (error) {
            console.error('❌ Verify DNS error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to verify DNS' });
        }
    },

    // POST /api/stores/:id/payment
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

            // Test tenant bypass
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

            // ✅ Block payment if DNS not yet verified for custom domain + Aapna hosting
            if (domainConfig.dns_status === 'pending') {
                return res.status(400).json({
                    success: false,
                    error: 'Please verify your DNS configuration before proceeding to payment',
                });
            }

            const planKey = PublishFlowController._resolvePlanKey(domainConfig.domain_type, domainConfig.hosting_type);
            const cycle   = billingCycle || 'annual';
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
            } catch (e) {
                console.error('Discount calc error:', e.message);
            }
            const finalAmt    = discountCalc ? discountCalc.finalAmount : fullAmount;
            const baseAmount  = (finalAmt / (1 + parseFloat(plan.tax_percentage) / 100)).toFixed(2);
            const taxAmount   = (finalAmt - parseFloat(baseAmount)).toFixed(2);
            const totalAmount = finalAmt.toFixed(2);

            const subscriptionResult = await pool.query(
                `INSERT INTO store_subscriptions
                    (store_id, plan_key, plan_name, billing_cycle, base_amount, tax_amount, total_amount,
                     payment_status, payment_method, paid_at, valid_until, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'paid',$8,NOW(),NOW()+($9||' days')::interval,NOW())
                 ON CONFLICT (store_id) DO UPDATE
                 SET plan_key=$2, plan_name=$3, billing_cycle=$4, base_amount=$5, tax_amount=$6,
                     total_amount=$7, payment_status='paid', payment_method=$8,
                     paid_at=NOW(), valid_until=NOW()+($9||' days')::interval, updated_at=NOW()
                 RETURNING *`,
                [id, plan.plan_key, plan.display_name, plan.billing_cycle,
                 baseAmount, taxAmount, totalAmount, paymentMethod || 'upi', plan.validity_days]
            );

            const storeUpdateResult = await pool.query(
                `UPDATE stores SET status='published', published_at=NOW(), updated_at=NOW()
                 WHERE id=$1
                 RETURNING id, store_id, store_name, subdomain, status, published_at`,
                [id]
            );

            const { TERMS_VERSION } = require('../config/terms');
            await pool.query(
                `INSERT INTO terms_acceptances (tenant_id, store_id, terms_version, ip_address)
                 VALUES ($1,$2,$3,$4)`,
                [tenantId, id, TERMS_VERSION, req.ip || req.headers['x-forwarded-for'] || null]
            );

            await discountService.incrementPublishCount(tenantId);
            if (discountCalc?.usableReferrals) await discountService.creditReferrals(tenantId, discountCalc.usableReferrals);

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
        if (storeCheck.rows.length === 0) return res.status(404).json({ success: false, error: 'Store not found' });
        if (storeCheck.rows[0].status !== 'published') return res.status(400).json({ success: false, error: 'Store is not published' });

        await pool.query(`UPDATE stores SET status='draft', updated_at=NOW() WHERE id=$1`, [id]);
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
        if (storeCheck.rows.length === 0) return res.status(404).json({ success: false, error: 'Store not found' });

        const subResult = await pool.query(
            `SELECT * FROM store_subscriptions
             WHERE store_id=$1 AND payment_status='paid' AND valid_until > NOW()`,
            [id]
        );
        if (subResult.rows.length === 0) {
            return res.status(402).json({
                success: false,
                requiresPayment: true,
                error: 'Subscription expired. Please complete payment to republish.',
            });
        }

        await pool.query(
            `UPDATE stores SET status='published', published_at=NOW(), updated_at=NOW() WHERE id=$1`,
            [id]
        );
        res.json({ success: true, message: 'Store republished successfully' });
    } catch (error) {
        console.error('❌ Republish error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to republish store' });
    }
};
