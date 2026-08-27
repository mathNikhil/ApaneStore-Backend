const express = require('express');
const router = express.Router();
const StoreController = require('../controllers/store.controller');
const StoreAdminPasswordController = require('../controllers/storeAdminPassword.controller');
const PublishFlowController = require('../controllers/publishFlow.controller');
const PaymentGatewayController = require('../controllers/paymentGateway.controller');
const { authenticate } = require('../middleware/auth');
const discountService = require('../services/discount.service');
const contentFilter = require('../middleware/contentFilter');

// All store routes require authentication
router.use(authenticate);

router.get('/', StoreController.getAll);
router.get('/:id', StoreController.getById);
router.post('/', contentFilter, StoreController.create);
router.put('/:id', contentFilter, StoreController.update);
router.delete('/:id', StoreController.delete);

// Store Admin password management (view/regenerate) — tenant must own the store
router.get('/:id/admin-password', StoreAdminPasswordController.getPassword);
router.post('/:id/admin-password/generate', StoreAdminPasswordController.generatePassword);

// Publish flow: domain + hosting + payment
router.get('/:id/publish-flow', PublishFlowController.getState);
router.put('/:id/domain-config', PublishFlowController.saveDomainConfig);
router.post('/:id/domain-config/verify-dns', PublishFlowController.verifyDns);
router.post('/:id/payment', PublishFlowController.completePayment);

// Tenant storefront payment gateways (Cashfree/Stripe) — the STORE's own
// gateway account for collecting from THEIR customers, separate from the
// platform payment above. ApnaEstore never touches this money — see the
// payment gateway integration reference doc.
router.get('/:id/payment-gateways', authenticate, PaymentGatewayController.listStoreGateways);

module.exports = router;
// Unpublish — sets status to inactive, keeps subscription/domain intact
router.post('/:id/unpublish', PublishFlowController.unpublish);

// Republish — instantly goes live if subscription still valid, else redirects to payment
router.post('/:id/republish', PublishFlowController.republish);

// Subscription status — days remaining, grace period etc
const subscriptionExpiryService = require('../services/subscriptionExpiryService');
router.get('/:id/subscription-status', async (req, res) => {
    try {
        const status = await subscriptionExpiryService.getSubscriptionStatus(req.params.id);
        res.json({ success: true, data: status });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/stores/:id/publish-discount — calculate discount for tenant
router.get('/:id/publish-discount', authenticate, async (req, res) => {
    try {
        const pool = require('../config/database');
        const tenantId = req.tenantId;
        const { billingCycle } = req.query;

        // Get domain config for plan key
        const storeResult = await pool.query('SELECT id FROM stores WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
        if (!storeResult.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });

        const domainResult = await pool.query('SELECT domain_type, hosting_type FROM store_domain_config WHERE store_id = $1', [req.params.id]);
        const d = domainResult.rows[0] || { domain_type: 'subdomain', hosting_type: 'apnaestore' };
        let planKey = 'subdomain_apnaestore';
        if (d.domain_type === 'custom' && d.hosting_type === 'apnaestore') planKey = 'custom_domain_apnaestore';
        else if (d.domain_type === 'custom' && d.hosting_type === 'own') planKey = 'custom_domain_own_hosting';

        const planResult = await pool.query(
            'SELECT * FROM pricing_plans WHERE billing_cycle = $1 AND plan_key = $2 AND is_active = true LIMIT 1',
            [billingCycle || '365days', planKey]
        );
        if (!planResult.rows.length) return res.status(404).json({ success: false, error: 'Plan not found' });

        const plan = planResult.rows[0];
        const baseAmount = parseFloat(plan.base_amount) * (1 + parseFloat(plan.tax_percentage) / 100);
        const discount = await discountService.calculateDiscount(tenantId, baseAmount, billingCycle || '365days', parseFloat(plan.tax_percentage));

        res.json({ success: true, data: { ...discount, plan } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/referral/summary — referral summary for profile page
router.get('/referral/summary', authenticate, async (req, res) => {
    try {
        const summary = await discountService.getReferralSummary(req.tenantId);
        res.json({ success: true, data: summary });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Initiate Cashfree subscription payment
router.post('/:id/payment/initiate-cashfree', authenticate, async (req, res) => {
    try {
        const pool = require('../config/database');
        const cashfreeService = require('../services/paymentGateway.service');
        const { billingCycle, termsAccepted } = req.body;
        const { id: storeId } = req.params;
        const tenantId = req.tenantId;

        if (!termsAccepted) return res.status(400).json({ success: false, error: 'Terms must be accepted' });

        // Get tenant details
        const tenantResult = await pool.query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
        if (!tenantResult.rows.length) return res.status(404).json({ success: false, error: 'Tenant not found' });
        const tenant = tenantResult.rows[0];

        // Get store publish flow state
        const flowResult = await pool.query('SELECT * FROM stores WHERE id = $1 AND tenant_id = $2', [storeId, tenantId]);
        if (!flowResult.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });

        // Get store domain config to determine plan key
        const store = flowResult.rows[0];
        const domainConfigResult = await pool.query(
            'SELECT domain_type, hosting_type FROM store_domain_config WHERE store_id = $1',
            [storeId]
        );
        const domainConfig = domainConfigResult.rows[0] || { domain_type: 'subdomain', hosting_type: 'apnaestore' };
        let planKey = 'subdomain_apnaestore';
        if (domainConfig.domain_type === 'custom' && domainConfig.hosting_type === 'apnaestore') planKey = 'custom_domain_apnaestore';
        else if (domainConfig.domain_type === 'custom' && domainConfig.hosting_type === 'own') planKey = 'custom_domain_own_hosting';

        // Get pricing plan
        const planResult = await pool.query(
            "SELECT * FROM pricing_plans WHERE billing_cycle = $1 AND plan_key = $2 AND is_active = true LIMIT 1",
            [billingCycle, planKey]
        );
        if (!planResult.rows.length) return res.status(404).json({ success: false, error: 'Plan not found' });
        const plan = planResult.rows[0];

        const fullAmount = parseFloat(plan.base_amount) * (1 + parseFloat(plan.tax_percentage) / 100);
        const discountCalc = await discountService.calculateDiscount(tenantId, fullAmount);
        const totalAmount = discountCalc.finalAmount;
        const orderId = `store_${storeId}_${Date.now()}`;

        // Save to pending_payments
        await pool.query(
            `INSERT INTO pending_payments (order_id, store_id, tenant_id, plan_key, plan_name, billing_cycle, base_amount, tax_amount, total_amount, validity_days, status, terms_accepted)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)
             ON CONFLICT (order_id) DO NOTHING`,
            [orderId, storeId, tenantId, plan.plan_key, plan.display_name, plan.billing_cycle,
             plan.base_amount, (totalAmount - parseFloat(plan.base_amount)).toFixed(2),
             totalAmount.toFixed(2), plan.validity_days, termsAccepted]
        );

        const API_URL = process.env.FRONTEND_URL || 'https://aapnaestore.com';
        const order = await cashfreeService.createOrder({
            orderId,
            amount: totalAmount.toFixed(2),
            customerName: tenant.company_name || 'Tenant',
            customerEmail: tenant.email || `${tenant.phone}@temp.com`,
            customerPhone: tenant.phone,
            returnUrl: `${API_URL}/store-builder/publish/success?storeId=${storeId}&orderId=${orderId}`,
        });

        res.json({ success: true, data: { orderId, paymentSessionId: order.paymentSessionId, amount: totalAmount.toFixed(2), discount: discountCalc } });
    } catch (e) {
        console.error('Initiate Cashfree error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE gateway keys — called when tenant switches away from payment gateway
router.delete('/:id/payment-gateway/:provider/keys', authenticate, async (req, res) => {
    try {
        const pool = require('../config/database');
        const { id: storeId, provider } = req.params;
        const tenantId = req.tenantId;

        const storeCheck = await pool.query('SELECT id FROM stores WHERE id = $1 AND tenant_id = $2', [storeId, tenantId]);
        if (!storeCheck.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });

        await pool.query(
            `DELETE FROM store_payment_gateway_accounts
             WHERE store_id = $1 AND gateway_id = (
                 SELECT id FROM payment_gateways WHERE gateway_key = $2
             )`,
            [storeId, provider]
        );

        res.json({ success: true, message: `${provider} keys deleted` });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Cashfree payment gateway keys
router.post('/:id/payment-gateway/cashfree/keys', authenticate, PaymentGatewayController.saveCashfreeKeys);

// Razorpay payment gateway keys
router.post('/:id/payment-gateway/razorpay/keys', authenticate, PaymentGatewayController.saveRazorpayKeys);

// Stripe payment gateway keys
router.post('/:id/payment-gateway/stripe/keys', authenticate, PaymentGatewayController.saveStripeKeys);

// Trial routes
const TrialController = require('../controllers/trial.controller');
router.get('/trial/eligibility', authenticate, TrialController.checkEligibility);
router.post('/:id/trial/activate', authenticate, TrialController.activateTrial);
