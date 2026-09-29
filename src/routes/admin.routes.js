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
            `SELECT ta.*, t.company_name AS tenant_name, t.phone AS tenant_phone, t.email AS tenant_email,
                    t.business_name, t.address, t.state, t.gstin, t.pan,
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


// Download Terms Agreement PDF
router.get('/terms-acceptances/:id/download', authenticateAdmin, async (req, res) => {
    const pool = require('../config/database');
    const PDFDocument = require('pdfkit');
    const { TERMS_VERSION, TERMS_TEXT } = require('../config/terms');
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT ta.*, t.company_name AS tenant_name, t.phone AS tenant_phone, t.email AS tenant_email,
                    s.store_name, s.subdomain,
                    ss.tenant_business_name, ss.tenant_gstin, ss.tenant_address, ss.tenant_state
             FROM terms_acceptances ta
             LEFT JOIN tenants t ON t.id = ta.tenant_id
             LEFT JOIN stores s ON s.id = ta.store_id
             LEFT JOIN store_subscriptions ss ON ss.store_id = ta.store_id
             WHERE ta.id = $1`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Record not found' });
        const r = result.rows[0];

        // Get billing settings for AapnaEstore details
        const billing = await pool.query("SELECT key, value FROM platform_settings WHERE key LIKE 'billing_%'");
        const bs = {};
        billing.rows.forEach(row => { bs[row.key.replace('billing_', '')] = row.value; });

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers = [];
        doc.on('data', chunk => buffers.push(chunk));
        doc.on('end', () => {
            const pdf = Buffer.concat(buffers);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="terms-agreement-${r.subdomain}.pdf"`);
            res.send(pdf);
        });

        // Header
        doc.rect(50, 40, 495, 70).fill('#006d2f');
        doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
           .text('TERMS & CONDITIONS — SIGNED AGREEMENT', 60, 55, { width: 475, align: 'center' });
        doc.fontSize(10).font('Helvetica')
           .text('AapnaEstore Platform', 60, 80, { width: 475, align: 'center' });

        doc.moveDown(4);

        // Acceptance Details Box
        doc.fillColor('#191c1e').fontSize(12).font('Helvetica-Bold').text('ACCEPTANCE DETAILS', 50, 130);
        doc.moveTo(50, 145).lineTo(545, 145).strokeColor('#e0e3e6').lineWidth(0.5).stroke();

        const detailY = 155;
        doc.fontSize(9).font('Helvetica').fillColor('#556067');

        const details = [
            ['Tenant Name', r.tenant_name || '—'],
            ['Business Name', r.tenant_business_name || r.store_name || '—'],
            ['Phone', r.tenant_phone || '—'],
            ['Email', r.tenant_email || '—'],
            ['Store', `${r.store_name} (${r.subdomain}.aapnaestore.com)`],
            ['GSTIN', r.tenant_gstin || 'Not Provided'],
            ['State', r.tenant_state || '—'],
            ['Address', r.tenant_address || '—'],
            ['Terms Version', r.terms_version],
            ['Accepted At', new Date(r.accepted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST'],
            ['IP Address', r.ip_address || '—'],
        ];

        let y = detailY;
        details.forEach(([label, value]) => {
            doc.font('Helvetica-Bold').fillColor('#191c1e').text(label + ':', 50, y, { width: 140 });
            doc.font('Helvetica').fillColor('#556067').text(String(value), 200, y, { width: 345 });
            y += 18;
        });

        y += 10;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#e0e3e6').lineWidth(0.5).stroke();
        y += 15;

        // Terms Text
        doc.fillColor('#191c1e').fontSize(12).font('Helvetica-Bold').text('TERMS & CONDITIONS TEXT', 50, y);
        y += 20;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#e0e3e6').lineWidth(0.5).stroke();
        y += 10;

        doc.fontSize(8).font('Helvetica').fillColor('#333333')
           .text(TERMS_TEXT, 50, y, { width: 495, align: 'justify', lineGap: 2 });

        // Signature block
        doc.addPage();
        doc.fillColor('#191c1e').fontSize(12).font('Helvetica-Bold').text('DIGITAL ACCEPTANCE DECLARATION', 50, 50);
        doc.moveTo(50, 68).lineTo(545, 68).strokeColor('#e0e3e6').lineWidth(0.5).stroke();

        doc.fontSize(10).font('Helvetica').fillColor('#333333').text(
            `I/We, ${r.tenant_business_name || r.tenant_name || 'the undersigned'}, hereby confirm that on ${new Date(r.accepted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} IST, we accessed the AapnaEstore platform from IP address ${r.ip_address || 'recorded'}, read the Terms & Conditions (Version: ${r.terms_version}) in full, and by checking the acceptance checkbox and completing payment, agreed to be bound by the said terms with immediate effect.`,
            50, 80, { width: 495, align: 'justify', lineGap: 3 }
        );

        // Signature lines
        const sigY = 200;
        doc.moveTo(50, sigY).lineTo(250, sigY).strokeColor('#191c1e').lineWidth(0.5).stroke();
        doc.fontSize(9).font('Helvetica').fillColor('#556067')
           .text('Authorized Signatory', 50, sigY + 5)
           .text(r.tenant_business_name || r.tenant_name || '—', 50, sigY + 18)
           .text(r.tenant_phone || '', 50, sigY + 31);

        doc.moveTo(300, sigY).lineTo(545, sigY).strokeColor('#191c1e').lineWidth(0.5).stroke();
        doc.text('For AapnaEstore', 300, sigY + 5)
           .text(bs.company_name || 'AapnaEstore', 300, sigY + 18)
           .text(bs.gstin ? `GSTIN: ${bs.gstin}` : '', 300, sigY + 31);

        // Footer
        doc.fontSize(8).fillColor('#8e9eab')
           .text('This is a digitally generated agreement record. The acceptance was recorded electronically on the AapnaEstore platform.', 50, 750, { width: 495, align: 'center' })
           .text(`AapnaEstore | support@aapnaestore.com | +91 8800244169`, 50, 763, { width: 495, align: 'center' });

        doc.end();
    } catch (error) {
        console.error('Terms PDF error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// GET tenant invoice details
router.get('/tenant-invoice-details/:tenantId', authenticateAdmin, async (req, res) => {
    const pool = require('../config/database');
    try {
        const { tenantId } = req.params;
        const result = await pool.query(
            'SELECT id, company_name, business_name, full_name, phone, email, address, state, gst_number as gstin, pan FROM tenants WHERE id=$1',
            [tenantId]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Tenant not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST save tenant invoice details
router.post('/tenant-invoice-details/:tenantId', authenticateAdmin, async (req, res) => {
    const pool = require('../config/database');
    try {
        const { tenantId } = req.params;
        const { business_name, address, state, gstin, pan } = req.body;
        await pool.query(
            `UPDATE tenants SET
                business_name = COALESCE(NULLIF($2,''), business_name),
                address = COALESCE(NULLIF($3,''), address),
                state = COALESCE(NULLIF($4,''), state),
                gst_number = COALESCE(NULLIF($5,''), gst_number),
                pan = COALESCE(NULLIF($6,''), pan)
             WHERE id = $1`,
            [tenantId, business_name||'', address||'', state||'', gstin||'', pan||'']
        );
        const result = await pool.query(
            'SELECT id, company_name, business_name, full_name, phone, email, address, state, gst_number as gstin, pan FROM tenants WHERE id=$1',
            [tenantId]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


// Generate impersonation token for tenant
router.post('/impersonate/:tenantId', authenticateAdmin, async (req, res) => {
    const pool = require('../config/database');
    const jwt = require('jsonwebtoken');
    const crypto = require('crypto');
    try {
        const { tenantId } = req.params;
        
        // Check tenant exists
        const tenantResult = await pool.query(
            'SELECT id, company_name, phone, email FROM tenants WHERE id=$1',
            [tenantId]
        );
        if (tenantResult.rows.length === 0) 
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        
        const tenant = tenantResult.rows[0];
        
        // Generate short-lived impersonation token (15 min)
        const token = jwt.sign(
            { 
                tenantId: tenant.id, 
                phone: tenant.phone,
                impersonated: true,
                adminImpersonation: true
            },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
        
        // Hash token for storage
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        
        // Log impersonation
        await pool.query(
            `INSERT INTO admin_impersonation_log 
             (tenant_id, token_hash, expires_at, ip_address)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, tokenHash, expiresAt, req.ip]
        );
        
        res.json({ 
            success: true, 
            data: { 
                token, 
                tenant_name: tenant.company_name,
                expires_in: '15 minutes'
            } 
        });
    } catch (e) { 
        console.error('Impersonation error:', e);
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// Get impersonation audit log
router.get('/impersonation-log', authenticateAdmin, async (req, res) => {
    const pool = require('../config/database');
    try {
        const result = await pool.query(`
            SELECT il.*, t.company_name as tenant_name, t.phone as tenant_phone
            FROM admin_impersonation_log il
            LEFT JOIN tenants t ON t.id = il.tenant_id
            ORDER BY il.started_at DESC
            LIMIT 100
        `);
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
                ss.tenant_business_name, ss.tenant_gstin, ss.tenant_state, ss.tenant_address,
                s.store_name, s.subdomain, s.custom_domain, s.status as store_status,
                t.company_name as tenant_name, t.phone as tenant_phone, t.email as tenant_email,
                t.business_name as tenant_business_name_profile,
                t.gst_number as tenant_gst_number_profile,
                t.state as tenant_state_profile,
                t.address as tenant_address_profile,
                t.full_name as tenant_full_name
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

router.get('/market/invoices/:orderId/download', authenticateAdmin, async (req, res) => {
  try {
    const pool = require('../config/database');
    const { generateInvoicePDF } = require('../controllers/invoice.controller');
    const { orderId } = req.params;

    const { rows } = await pool.query(`
      SELECT cpo.id, cpo.order_id, cpo.amount, cpo.status, cpo.created_at,
             (cpo.order_data->>'base_amount')::numeric as base_amount,
             (cpo.order_data->>'gst_rate')::numeric as gst_rate,
             (cpo.order_data->>'total_amount')::numeric as total_amount,
             t.company_name as tenant_name, t.email as tenant_email,
             t.phone as tenant_phone, t.business_name, t.full_name,
             t.gstin as gst_number, t.state as tenant_state, t.address as tenant_address,
             p.name as plan_name, p.description as plan_description,
             p.max_scheduled, p.image_retain_days, p.daily_msg_limit, p.validity_days
      FROM cashfree_pending_orders cpo
      LEFT JOIN tenants t ON t.id = (cpo.order_data->>'tenant_id')::int
      LEFT JOIN addon_plans p ON p.id = (cpo.order_data->>'plan_id')::int
      WHERE cpo.order_id = $1
    `, [orderId]);

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Order not found' });
    const order = rows[0];

    const settingsRes = await pool.query("SELECT key, value FROM platform_settings WHERE key LIKE 'billing_%'");
    const s = {};
    settingsRes.rows.forEach(r => { s[r.key.replace('billing_', '')] = r.value; });

    const yr = new Date(order.created_at).getFullYear();
    const invoiceNo = `WA-INV-${yr}-${String(order.id).padStart(4,'0')}`;
    const gstRate = parseFloat(order.gst_rate || 18);
    const totalAmount = parseFloat(order.amount || 0);
    const baseAmount = parseFloat(order.base_amount || (totalAmount / (1 + gstRate/100)).toFixed(2));
    const taxAmount = parseFloat((totalAmount - baseAmount).toFixed(2));

    const invoice = {
      invoice_number: invoiceNo,
      invoice_generated_at: order.created_at,
      tenant_gstin: order.gst_number || '',
      tenant_address: order.tenant_address || '',
      tenant_state: order.tenant_state || '',
      tenant_business_name: order.business_name || order.tenant_name || '',
    };

    // Calculate valid_until from paid_at + validity_days
    const paidAt = new Date(order.created_at);
    const validUntil = new Date(paidAt);
    validUntil.setDate(validUntil.getDate() + (order.validity_days || 30));

    const store = { name: order.tenant_name || 'WhatsApp Market', subdomain: '', custom_domain: '' };

    const subscription = {
      plan_key: 'wa_market',
      plan_name: `WhatsApp Market — ${order.plan_name || 'Subscription'} | ${order.validity_days || 30} Days | ${order.max_scheduled || 0} Schedules | ${order.image_retain_days || 0} Days Image Storage`,
      billing_cycle: 'monthly',
      base_amount: baseAmount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      payment_method: 'Online',
      paid_at: order.created_at,
      valid_until: validUntil.toISOString(),
    };
    const tenant = { company_name: order.tenant_name || '', phone: order.tenant_phone || '', email: order.tenant_email || '' };
    const seller = {
      name: s.company_name || 'AapnaEstore Pvt. Ltd.',
      entity: s.company_name || 'AapnaEstore Pvt. Ltd.',
      address: s.address || '',
      state: s.state || 'Delhi',
      stateCode: '07',
      gstin: s.gstin || 'Applied For',
      pan: s.pan || '',
      udyam: 'UDYAM-DL-06-0221356',
      email: 'aapnaestore@gmail.com',
      phone: '+91 9818410640',
      hsn: s.hsn_code || '998314',
      gst_rate: parseFloat(s.gst_rate || 0),
    };

    const pdfBuffer = await generateInvoicePDF(invoice, subscription, store, tenant, seller);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNo}.pdf"`);
    res.send(pdfBuffer);
  } catch(err) {
    console.error('WA invoice download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// Billing settings
router.get('/billing-settings', authenticateAdmin, async (req, res) => {
    try {
        const pool = require('../config/database');
        const result = await pool.query(
            "SELECT key, value FROM platform_settings WHERE key LIKE 'billing_%'"
        );
        const settings = {};
        result.rows.forEach(r => { settings[r.key.replace('billing_', '')] = r.value; });
        res.json({ success: true, data: settings });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/billing-settings', authenticateAdmin, async (req, res) => {
    try {
        const pool = require('../config/database');
        const fields = ['company_name','gstin','pan','address','state','hsn_code','gst_rate','bank_name','bank_account','bank_ifsc','bank_branch'];
        for (const field of fields) {
            if (req.body[field] !== undefined) {
                await pool.query(
                    `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
                     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
                    [`billing_${field}`, req.body[field]]
                );
            }
        }
        res.json({ success: true, message: 'Billing settings saved' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
