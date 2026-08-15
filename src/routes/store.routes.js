const express = require('express');
const router = express.Router();
const StoreController = require('../controllers/store.controller');
const StoreAdminPasswordController = require('../controllers/storeAdminPassword.controller');
const PublishFlowController = require('../controllers/publishFlow.controller');
const PaymentGatewayController = require('../controllers/paymentGateway.controller');
const { authenticate } = require('../middleware/auth');

// All store routes require authentication
router.use(authenticate);

router.get('/', StoreController.getAll);
router.get('/:id', StoreController.getById);
router.post('/', StoreController.create);
router.put('/:id', StoreController.update);
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
router.get('/:id/payment-gateways', PaymentGatewayController.listStoreGateways);
router.get('/:id/payment-gateway/:gatewayKey', PaymentGatewayController.getGatewayStatus);
router.post('/:id/payment-gateway/:gatewayKey', PaymentGatewayController.createOrUpdateGatewayAccount);
router.post('/:id/payment-gateway/default', PaymentGatewayController.setDefaultGateway);

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

// Trial routes
const TrialController = require('../controllers/trial.controller');
router.get('/trial/eligibility', authenticate, TrialController.checkEligibility);
router.post('/:id/trial/activate', authenticate, TrialController.activateTrial);
