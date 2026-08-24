const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/admin.auth');

// Controllers
const AdminAuthController = require('../controllers/Admin/auth.controller');
const AdminTenantController = require('../controllers/Admin/tenant.controller');
const AdminStoreController = require('../controllers/Admin/store.controller');
const AdminPanelController = require('../controllers/Admin/panel.controller');
const AdminPricingController = require('../controllers/Admin/pricing.controller');
const InvoiceController = require('../controllers/invoice.controller');
const PlatformSettingsController = require('../controllers/platformSettings.controller');

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
router.patch('/stores/:id/status', authenticateAdmin, AdminStoreController.changeStoreStatus);

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

// Payment gateway configuration
router.get('/payment-gateway', authenticateAdmin, PlatformSettingsController.getPaymentGatewayConfig);
router.post('/payment-gateway', authenticateAdmin, PlatformSettingsController.savePaymentGatewayConfig);

// Revenue overview
router.get('/revenue', authenticateAdmin, async (req, res) => {
    try {
        const pool = require('../config/database');
        const result = await pool.query(`
            SELECT 
                ss.id, ss.store_id, ss.plan_key, ss.plan_name, ss.billing_cycle,
                ss.base_amount, ss.tax_amount, ss.total_amount,
                ss.payment_method, ss.paid_at, ss.valid_until,
                ss.invoice_number,
                s.store_name, s.subdomain, s.custom_domain, s.status as store_status,
                t.company_name as tenant_name, t.phone as tenant_phone, t.email as tenant_email
            FROM store_subscriptions ss
            JOIN stores s ON s.id = ss.store_id
            JOIN tenants t ON t.id = s.tenant_id
            WHERE ss.payment_status = 'paid'
            ORDER BY ss.paid_at DESC
        `);

        const rows = result.rows;
        const totalBase = rows.reduce((sum, r) => sum + parseFloat(r.base_amount || 0), 0);
        const totalGst = rows.reduce((sum, r) => sum + parseFloat(r.tax_amount || 0), 0);
        const totalRevenue = rows.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);

        res.json({
            success: true,
            data: {
                subscriptions: rows,
                summary: {
                    totalBase: totalBase.toFixed(2),
                    totalGst: totalGst.toFixed(2),
                    totalRevenue: totalRevenue.toFixed(2),
                    count: rows.length,
                }
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Invoice routes for super admin
router.get('/tenants/:tenantId/invoices', authenticateAdmin, InvoiceController.adminListInvoices);
router.get('/invoices/:subscriptionId/download', authenticateAdmin, InvoiceController.downloadInvoice);

module.exports = router;
// Trial admin routes
const TrialController = require('../controllers/trial.controller');
router.post('/stores/:id/trial/enable', TrialController.adminEnableTrial);
router.get('/trial/extension-requests', TrialController.getExtensionRequests);
router.post('/trial/extension-requests/:requestId/accept', TrialController.acceptExtension);
router.post('/trial/extension-requests/:requestId/reject', TrialController.rejectExtension);

// Store storage info
router.get('/stores/:id/storage', async (req, res) => {
    const pool = require('../config/database');
    const { id } = req.params;
    const LIMIT = 20 * 1024 * 1024; // 20MB
    const result = await pool.query('SELECT storage_used_bytes FROM stores WHERE id = $1', [id]);
    const used = parseInt(result.rows[0]?.storage_used_bytes || 0);
    const pct = Math.round((used / LIMIT) * 100);
    res.json({ success: true, data: { used, limit: LIMIT, percentage: pct,
        usedMB: (used / 1024 / 1024).toFixed(2),
        limitMB: '20',
        warning: pct >= 80,
        full: pct >= 100
    }});
});
