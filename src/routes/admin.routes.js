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

// Discount settings
router.get('/discount-settings', authenticateAdmin, async (req, res) => {
    try {
        const pool = require('../config/database');
        const result = await pool.query(
            `SELECT key, value FROM platform_settings WHERE key LIKE '%publish%' OR key IN ('referral_bonus_percent','max_referral_count')`
        );
        const data = {};
        result.rows.forEach(r => { data[r.key] = parseFloat(r.value); });
        res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/discount-settings', authenticateAdmin, async (req, res) => {
    try {
        const pool = require('../config/database');
        const keys = [
            'first_publish_30days','first_publish_90days','first_publish_365days',
            'repeat_publish_30days','repeat_publish_90days','repeat_publish_365days',
            'third_publish_30days','third_publish_90days','third_publish_365days',
            'referral_bonus_percent','max_referral_count'
        ];
        for (const key of keys) {
            if (req.body[key] !== undefined) {
                await pool.query(
                    `INSERT INTO platform_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
                    [key, String(req.body[key])]
                );
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Invoice routes for super admin
router.get('/tenants/:tenantId/invoices', authenticateAdmin, InvoiceController.adminListInvoices);
router.get('/invoices/:subscriptionId/download', authenticateAdmin, InvoiceController.downloadInvoice);

// WhatsApp Market subscriptions
router.get('/market/subscriptions', authenticateAdmin, async (req, res) => {
  try {
    const pool = require('../config/database');
    const { rows } = await pool.query(`
      SELECT s.id, s.tenant_id, s.is_active, s.quota_used, s.price_paid,
             s.activated_at, s.expires_at, s.deactivation_reason,
             t.company_name as tenant_name, t.email as tenant_email,
             p.max_scheduled, p.name as plan_name
      FROM wa_subscriptions s
      JOIN tenants t ON t.id = s.tenant_id
      LEFT JOIN addon_plans p ON p.id = s.addon_plan_id
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Bulk download — combined store + WA invoices in one HTML
router.get('/invoices/bulk-download', authenticateAdmin, async (req, res) => {
  try {
    const pool = require('../config/database');

    // Store invoices
    const { rows: storeRows } = await pool.query(`
      SELECT ss.*, s.store_name, s.subdomain, t.company_name as tenant_name
      FROM store_subscriptions ss
      JOIN stores s ON s.id = ss.store_id
      JOIN tenants t ON t.id = s.tenant_id
      WHERE ss.payment_status = 'paid'
      ORDER BY ss.paid_at DESC
    `);

    // WA market invoices
    const { rows: waRows } = await pool.query(`
      SELECT cpo.id, cpo.order_id, cpo.amount, cpo.created_at,
             (cpo.order_data->>'base_amount')::numeric as base_amount,
             (cpo.order_data->>'gst_rate')::numeric as gst_rate,
             (cpo.order_data->>'gst_amount')::numeric as gst_amount,
             (cpo.order_data->>'total_amount')::numeric as total_amount,
             t.company_name as tenant_name, t.email as tenant_email,
             p.name as plan_name
      FROM cashfree_pending_orders cpo
      LEFT JOIN tenants t ON t.id = (cpo.order_data->>'tenant_id')::int
      LEFT JOIN addon_plans p ON p.id = (cpo.order_data->>'plan_id')::int
      WHERE cpo.order_id LIKE 'WA_%' AND cpo.status = 'paid'
      ORDER BY cpo.created_at DESC
    `);

    const storeInvoiceRows = storeRows.map((sub, i) => {
      const base = parseFloat(sub.base_amount || 0);
      const gst = parseFloat(sub.tax_amount || 0);
      const total = parseFloat(sub.total_amount || 0);
      const date = sub.paid_at ? new Date(sub.paid_at).toLocaleDateString('en-IN') : 'N/A';
      return `<tr><td>${sub.invoice_number || `INV-${i+1}`}</td><td>${sub.store_name}</td><td>${sub.tenant_name}</td><td>${date}</td><td>₹${base.toFixed(2)}</td><td>₹${gst.toFixed(2)}</td><td>₹${total.toFixed(2)}</td></tr>`;
    }).join('');

    const waInvoiceRows = waRows.map((order, i) => {
      const amt = parseFloat(order.amount || 0);
      const gstRate = parseFloat(order.gst_rate || 18);
      const base = parseFloat(order.base_amount || (amt/(1+gstRate/100)).toFixed(2));
      const gst = parseFloat((amt - base).toFixed(2));
      const yr = new Date(order.created_at||Date.now()).getFullYear();
      const invoiceNo = `WA-INV-${yr}-${String(order.id).padStart(4,'0')}`;
      const date = order.created_at ? new Date(order.created_at).toLocaleDateString('en-IN') : 'N/A';
      return `<tr><td>${invoiceNo}</td><td>${order.plan_name||'—'}</td><td>${order.tenant_name||'—'}</td><td>${date}</td><td>₹${base.toFixed(2)}</td><td>${gstRate}%</td><td>₹${gst.toFixed(2)}</td><td>₹${amt.toFixed(2)}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>All Invoices</title>
    <style>body{font-family:Arial;margin:40px}table{width:100%;border-collapse:collapse;margin-bottom:40px}
    th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #e8ecf0}
    td{padding:8px;border-bottom:1px solid #f0f4f8}h1{color:#006d2f}h2{color:#1976d2;margin-top:40px}
    </style></head><body>
    <h1>AapnaEstore — All Invoices (Seller Copy)</h1>
    <h2>📦 Store Subscriptions (${storeRows.length})</h2>
    <table><tr><th>Invoice</th><th>Store</th><th>Tenant</th><th>Date</th><th>Base</th><th>GST</th><th>Total</th></tr>
    ${storeInvoiceRows || '<tr><td colspan="7">No store invoices</td></tr>'}</table>
    <h2>📱 WhatsApp Market (${waRows.length})</h2>
    <table><tr><th>Invoice</th><th>Plan</th><th>Tenant</th><th>Date</th><th>Base</th><th>GST%</th><th>GST</th><th>Total</th></tr>
    ${waInvoiceRows || '<tr><td colspan="8">No WA invoices</td></tr>'}</table>
    </body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// All WhatsApp Market invoices for admin revenue page
router.get('/market/all-invoices', authenticateAdmin, async (req, res) => {
  try {
    const pool = require('../config/database');
    const { rows } = await pool.query(`
      SELECT cpo.id, cpo.order_id, cpo.amount, cpo.status, cpo.created_at,
             (cpo.order_data->>'base_amount')::numeric as base_amount,
             (cpo.order_data->>'gst_rate')::numeric as gst_rate,
             (cpo.order_data->>'gst_amount')::numeric as gst_amount,
             (cpo.order_data->>'total_amount')::numeric as total_amount,
             t.company_name as tenant_name, t.email as tenant_email,
             p.name as plan_name
      FROM cashfree_pending_orders cpo
      LEFT JOIN tenants t ON t.id = (cpo.order_data->>'tenant_id')::int
      LEFT JOIN addon_plans p ON p.id = (cpo.order_data->>'plan_id')::int
      WHERE cpo.order_id LIKE 'WA_%' AND cpo.status = 'paid'
      ORDER BY cpo.created_at DESC
    `);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

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
