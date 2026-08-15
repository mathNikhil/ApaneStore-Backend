const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/admin.auth');

// Controllers
const AdminAuthController = require('../controllers/Admin/auth.controller');
const AdminTenantController = require('../controllers/Admin/tenant.controller');
const AdminStoreController = require('../controllers/Admin/store.controller');
const AdminPanelController = require('../controllers/Admin/panel.controller');
const AdminPricingController = require('../controllers/Admin/pricing.controller');

// ✅ Import the admin controller for settings and cleanup
const adminController = require('../controllers/admin.controller');

// ============================================================
// PUBLIC ROUTES (No Auth Required)
// ============================================================
router.post('/login', AdminAuthController.login);

// ============================================================
// PROTECTED ROUTES (Admin Auth Required)
// ============================================================

// Admin Auth
router.post('/logout', authenticateAdmin, AdminAuthController.logout);

// Tenant Management
router.get('/tenants', authenticateAdmin, AdminTenantController.getAll);
router.get('/tenants/:id', authenticateAdmin, AdminTenantController.getById);
router.put('/tenants/:id/toggle', authenticateAdmin, AdminTenantController.toggleStatus);
router.delete('/tenants/:id', authenticateAdmin, AdminTenantController.delete);

// Store Management
router.get('/stores', authenticateAdmin, AdminStoreController.getAll);
router.get('/stores/:id', authenticateAdmin, AdminStoreController.getById);
router.delete('/stores/:id', authenticateAdmin, AdminStoreController.delete);

// ============================================================
// ✅ PLATFORM SETTINGS (Added)
// ============================================================
router.get('/settings', authenticateAdmin, adminController.getSettings);
router.put('/settings', authenticateAdmin, adminController.updateSettings);

// ============================================================
// ✅ STORE CLEANUP (Added)
// ============================================================
router.post('/cleanup/trigger', authenticateAdmin, adminController.triggerCleanup);
router.get('/stores/:storeId/expiry', authenticateAdmin, adminController.getStoreExpiryInfo);
router.get('/cleanup/stats', authenticateAdmin, adminController.getCleanupStats);

// ============================================================
// PANEL CONFIGURATION
// ============================================================
router.get('/stores/:storeId/panels', authenticateAdmin, AdminPanelController.getStorePanels);
router.put('/stores/:storeId/panels', authenticateAdmin, AdminPanelController.updateStorePanels);
router.put('/stores/:storeId/panels/:panelType/toggle', authenticateAdmin, AdminPanelController.togglePanel);

// ============================================================
// ✅ PRICING PLANS (publish flow — domain + hosting + payment)
// ============================================================
router.get('/pricing-plans', authenticateAdmin, AdminPricingController.getAll);
router.put('/pricing-plans/:id', authenticateAdmin, AdminPricingController.update);

// ============================================================
// ✅ SUBSCRIPTION EXPIRY (manual trigger, for testing — the real check
// runs automatically every hour via jobs/subscriptionExpiryJob.js)
// ============================================================
router.post('/subscriptions/check-expiry', authenticateAdmin, async (req, res) => {
    const subscriptionExpiryService = require('../services/subscriptionExpiryService');
    const result = await subscriptionExpiryService.processExpiredSubscriptions();
    res.json(result);
});

// ============================================================
// ✅ TERMS ACCEPTANCE AUDIT TRAIL
// ============================================================
router.get('/terms-acceptances', authenticateAdmin, async (req, res) => {
    const pool = require('../config/database');
    try {
        const result = await pool.query(
            `SELECT ta.*, t.company_name AS tenant_name, t.phone AS tenant_phone,
                    s.store_name, s.subdomain
             FROM terms_acceptances ta
             LEFT JOIN tenants t ON t.id = ta.tenant_id
             LEFT JOIN stores s ON s.id = ta.store_id
             ORDER BY ta.accepted_at DESC`
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ Get terms acceptances error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
// Trial admin routes
const TrialController = require('../controllers/trial.controller');
router.post('/stores/:id/trial/enable', TrialController.adminEnableTrial);
router.get('/trial/extension-requests', TrialController.getExtensionRequests);
router.post('/trial/extension-requests/:requestId/accept', TrialController.acceptExtension);
router.post('/trial/extension-requests/:requestId/reject', TrialController.rejectExtension);
