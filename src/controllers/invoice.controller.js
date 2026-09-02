const pool = require('../config/database');
const PDFDocument = require('pdfkit');
const logger = require('../config/logger');

const SELLER = {
  name: 'AapnaEstore',
  entity: 'Nikhil Mathur HUF',
  address: 'C-143, Maharana Pratap Enclave,\nPitam Pura, New Delhi - 110034',
  state: 'Delhi',
  stateCode: '07',
  gstin: 'Applied For',
  udyam: 'UDYAM-DL-06-0221356',
  email: 'aapnaestore@gmail.com',
  phone: '+91 9818410640',
  sac: '998314',
};

const PLAN_LABELS = {
  subdomain_apnaestore: 'Free Subdomain + AapnaEstore Hosting',
  custom_domain_apnaestore: 'Custom Domain + AapnaEstore Hosting',
  custom_domain_own_hosting: 'Custom Domain + Own Hosting',
};

const CYCLE_LABELS = {
  '30days': '30 Days',
  '90days': '90 Days',
  '365days': '365 Days',
};

const PAYMENT_LABELS = {
  cashfree: 'Cashfree',
  razorpay: 'Razorpay',
  stripe: 'Stripe',
  manual: 'Manual',
};

// Generate next invoice number
const getNextInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const result = await pool.query(
    `UPDATE invoice_sequence SET last_number = last_number + 1
     WHERE year = $1 RETURNING last_number`,
    [year]
  );
  if (result.rows.length === 0) {
    await pool.query(
      `INSERT INTO invoice_sequence (year, last_number) VALUES ($1, 1)`,
      [year]
    );
    return `INV-AAPNA-${year}-0001`;
  }
  const num = result.rows[0].last_number;
  return `INV-AAPNA-${year}-${String(num).padStart(4, '0')}`;
};

// Draw a horizontal line
const drawLine = (doc, y, color = '#e0e3e6') => {
  doc.moveTo(40, y).lineTo(555, y).strokeColor(color).lineWidth(0.5).stroke();
};

// Generate PDF buffer
const generateInvoicePDF = (invoice, subscription, store, tenant) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const isDelhi = (invoice.tenant_state || '').toLowerCase().includes('delhi');
      const baseAmount = parseFloat(subscription.base_amount || 0);
      const totalAmount = parseFloat(subscription.total_amount || 0);
      const taxAmount = parseFloat(subscription.tax_amount || (totalAmount - baseAmount).toFixed(2));
      const cgst = isDelhi ? (taxAmount / 2) : 0;
      const sgst = isDelhi ? (taxAmount / 2) : 0;
      const igst = isDelhi ? 0 : taxAmount;

      // ── HEADER ──────────────────────────────────────────
      doc.rect(40, 40, 515, 80).fill('#006d2f');
      doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
        .text('TAX INVOICE', 50, 55);
      doc.fontSize(10).font('Helvetica')
        .text('AapnaEstore Platform Subscription', 50, 82);
      doc.fontSize(9)
        .text(`Invoice No: ${invoice.invoice_number}`, 350, 55, { align: 'right', width: 195 })
        .text(`Date: ${new Date(invoice.invoice_generated_at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, 350, 70, { align: 'right', width: 195 })
        .text(`Status: PAID`, 350, 85, { align: 'right', width: 195 });

      // ── SELLER & BUYER ───────────────────────────────────
      doc.fillColor('#191c1e').fontSize(9).font('Helvetica-Bold')
        .text('FROM (SELLER)', 40, 140)
        .text('TO (BUYER)', 300, 140);

      drawLine(doc, 153);

      doc.font('Helvetica-Bold').fontSize(10)
        .text(SELLER.name, 40, 158)
        .text(invoice.tenant_business_name || tenant.company_name || 'Business', 300, 158);

      doc.font('Helvetica').fontSize(8).fillColor('#556067')
        .text(`Operated by: ${SELLER.entity}`, 40, 172)
        .text(SELLER.address, 40, 184, { width: 230 })
        .text(`State: ${SELLER.state} (${SELLER.stateCode})`, 40, 210)
        .text(`GSTIN: ${SELLER.gstin}`, 40, 222)
        .text(`Udyam: ${SELLER.udyam}`, 40, 234)
        .text(`Email: ${SELLER.email}`, 40, 246)
        .text(`Phone: ${SELLER.phone}`, 40, 258);

      doc.fontSize(8).fillColor('#556067')
        .text(`Phone: ${tenant.phone}`, 300, 172)
        .text(`Email: ${tenant.email || 'N/A'}`, 300, 184)
        .text(`Address: ${invoice.tenant_address || 'N/A'}`, 300, 196, { width: 230 })
        .text(`State: ${invoice.tenant_state || 'N/A'}`, 300, 222)
        .text(`GSTIN: ${invoice.tenant_gstin || 'Not Applicable'}`, 300, 234);

      // ── SERVICE DETAILS TABLE ────────────────────────────
      doc.rect(40, 278, 515, 24).fill('#f2f4f7');
      doc.fillColor('#191c1e').fontSize(8).font('Helvetica-Bold')
        .text('SAC', 45, 286)
        .text('SERVICE DESCRIPTION', 85, 286)
        .text('STORE', 310, 286)
        .text('PERIOD', 400, 286)
        .text('AMOUNT', 480, 286, { width: 70, align: 'right' });

      drawLine(doc, 302);

      const planLabel = PLAN_LABELS[subscription.plan_key] || subscription.plan_name || subscription.plan_key;
      const cycleLabel = CYCLE_LABELS[subscription.billing_cycle] || subscription.billing_cycle;
      const storeUrl = store.subdomain ? `${store.subdomain}.aapnaestore.com` : (store.custom_domain || store.name);
      const validFrom = subscription.paid_at ? new Date(subscription.paid_at).toLocaleDateString('en-IN') : 'N/A';
      const validUntil = subscription.valid_until ? new Date(subscription.valid_until).toLocaleDateString('en-IN') : 'N/A';

      doc.font('Helvetica').fontSize(8).fillColor('#556067')
        .text(SELLER.sac, 45, 308)
        .text(planLabel, 85, 308, { width: 215 })
        .text(storeUrl, 310, 308, { width: 85 })
        .text(`${validFrom} to\n${validUntil}`, 400, 308, { width: 75 })
        .text(`₹${baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 480, 308, { width: 70, align: 'right' });

      drawLine(doc, 340);

      // ── TAX SUMMARY ──────────────────────────────────────
      const taxY = 350;
      doc.rect(310, taxY, 245, isDelhi ? 80 : 64).fill('#fafafa');

      doc.fillColor('#556067').font('Helvetica').fontSize(8)
        .text('Taxable Amount (Base)', 315, taxY + 8)
        .text(`₹${baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 480, taxY + 8, { width: 70, align: 'right' });

      if (isDelhi) {
        doc.text(`CGST @ 9% (Delhi - Same State)`, 315, taxY + 24)
          .text(`₹${cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 480, taxY + 24, { width: 70, align: 'right' });
        doc.text(`SGST @ 9% (Delhi - Same State)`, 315, taxY + 40)
          .text(`₹${sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 480, taxY + 40, { width: 70, align: 'right' });
      } else {
        doc.text(`IGST @ 18% (Inter-State)`, 315, taxY + 24)
          .text(`₹${igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 480, taxY + 24, { width: 70, align: 'right' });
      }

      const totalY = isDelhi ? taxY + 56 : taxY + 40;
      doc.rect(310, totalY, 245, 24).fill('#006d2f');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
        .text('TOTAL AMOUNT', 315, totalY + 7)
        .text(`₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 480, totalY + 7, { width: 70, align: 'right' });

      // ── PAYMENT INFO ─────────────────────────────────────
      doc.fillColor('#556067').font('Helvetica').fontSize(8)
        .text('Payment Method:', 40, taxY + 8)
        .text(PAYMENT_LABELS[subscription.payment_method] || subscription.payment_method || 'Online', 130, taxY + 8)
        .text('Payment Date:', 40, taxY + 22)
        .text(subscription.paid_at ? new Date(subscription.paid_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : 'N/A', 130, taxY + 22)
        .text('Subscription Cycle:', 40, taxY + 36)
        .text(cycleLabel, 130, taxY + 36)
        .text('Valid Until:', 40, taxY + 50)
        .text(validUntil, 130, taxY + 50)
        .text('Place of Supply:', 40, taxY + 64)
        .text(invoice.tenant_state || 'N/A', 130, taxY + 64);

      // ── AMOUNT IN WORDS ──────────────────────────────────
      drawLine(doc, totalY + 38);
      doc.fillColor('#556067').font('Helvetica').fontSize(7.5)
        .text(`SAC Code 998314 — Information Technology (IT) Enabled Services`, 40, totalY + 44)
        .text(`This is a computer generated invoice and does not require a physical signature.`, 40, totalY + 56);

      // ── FOOTER ───────────────────────────────────────────
      const footerY = 740;
      drawLine(doc, footerY);
      doc.rect(40, footerY + 1, 515, 55).fill('#f2f4f7');
      doc.fillColor('#556067').font('Helvetica').fontSize(7)
        .text('This invoice is issued by Nikhil Mathur HUF operating as AapnaEstore. For queries contact: aapnaestore@gmail.com | +91 9818410640', 45, footerY + 8, { width: 505, align: 'center' })
        .text('AapnaEstore is a software platform only. It does not handle, process, or hold any payments on behalf of store owners.', 45, footerY + 20, { width: 505, align: 'center' })
        .text(`© ${new Date().getFullYear()} Nikhil Mathur HUF. All rights reserved. | aapnaestore.com`, 45, footerY + 32, { width: 505, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

const InvoiceController = {

  // GET /api/invoices — list all invoices for logged-in tenant
  listTenantInvoices: async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const result = await pool.query(
        `SELECT ss.*, s.store_name, s.subdomain, s.custom_domain
         FROM store_subscriptions ss
         JOIN stores s ON s.id = ss.store_id
         WHERE s.tenant_id = $1 AND ss.payment_status = 'paid'
         ORDER BY ss.paid_at DESC`,
        [tenantId]
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      logger.error('List invoices error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // POST /api/invoices/:subscriptionId/generate — save tenant details + assign invoice number
  generateInvoice: async (req, res) => {
    try {
      const { subscriptionId } = req.params;
      const tenantId = req.tenantId;
      const { tenant_gstin, tenant_address, tenant_state, tenant_business_name } = req.body;

      // Verify subscription belongs to this tenant
      const subResult = await pool.query(
        `SELECT ss.*, s.tenant_id FROM store_subscriptions ss
         JOIN stores s ON s.id = ss.store_id
         WHERE ss.id = $1`,
        [subscriptionId]
      );

      if (subResult.rows.length === 0 || subResult.rows[0].tenant_id !== tenantId) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      const sub = subResult.rows[0];

      // Generate invoice number if not already assigned
      let invoiceNumber = sub.invoice_number;
      if (!invoiceNumber) {
        invoiceNumber = await getNextInvoiceNumber();
      }

      // Save invoice details
      await pool.query(
        `UPDATE store_subscriptions SET
          invoice_number = $1,
          tenant_gstin = $2,
          tenant_address = $3,
          tenant_state = $4,
          tenant_business_name = $5,
          invoice_generated_at = COALESCE(invoice_generated_at, NOW()),
          updated_at = NOW()
         WHERE id = $6`,
        [invoiceNumber, tenant_gstin || null, tenant_address, tenant_state, tenant_business_name, subscriptionId]
      );

      res.json({ success: true, data: { invoice_number: invoiceNumber } });
    } catch (err) {
      logger.error('Generate invoice error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // GET /api/invoices/:subscriptionId/download — download PDF
  downloadInvoice: async (req, res) => {
    try {
      const { subscriptionId } = req.params;
      const tenantId = req.tenantId;

      const result = await pool.query(
        `SELECT ss.*, s.store_name, s.subdomain, s.custom_domain, s.tenant_id,
                t.company_name, t.phone, t.email
         FROM store_subscriptions ss
         JOIN stores s ON s.id = ss.store_id
         JOIN tenants t ON t.id = s.tenant_id
         WHERE ss.id = $1`,
        [subscriptionId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      const row = result.rows[0];

      // Allow tenant or admin
      const isAdmin = req.isAdmin;
      if (!isAdmin && row.tenant_id !== tenantId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      // Auto-generate invoice number if not exists (for admin downloads)
      if (!row.invoice_number) {
        const newInvNumber = await getNextInvoiceNumber();
        await pool.query(
          `UPDATE store_subscriptions SET invoice_number = $1, invoice_generated_at = NOW() WHERE id = $2`,
          [newInvNumber, subscriptionId]
        );
        row.invoice_number = newInvNumber;
        row.invoice_generated_at = new Date();
      }

      const invoice = {
        invoice_number: row.invoice_number,
        invoice_generated_at: row.invoice_generated_at,
        tenant_gstin: row.tenant_gstin,
        tenant_address: row.tenant_address,
        tenant_state: row.tenant_state,
        tenant_business_name: row.tenant_business_name,
      };

      const subscription = {
        plan_key: row.plan_key,
        plan_name: row.plan_name,
        billing_cycle: row.billing_cycle,
        base_amount: row.base_amount,
        tax_amount: row.tax_amount,
        total_amount: row.total_amount,
        payment_method: row.payment_method,
        paid_at: row.paid_at,
        valid_until: row.valid_until,
      };

      const store = {
        name: row.store_name,
        subdomain: row.subdomain,
        custom_domain: row.custom_domain,
      };

      const tenant = {
        company_name: row.company_name,
        phone: row.phone,
        email: row.email,
      };

      const pdfBuffer = await generateInvoicePDF(invoice, subscription, store, tenant);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${row.invoice_number}.pdf"`);
      res.send(pdfBuffer);

    } catch (err) {
      logger.error('Download invoice error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // GET /api/admin/tenants/:tenantId/invoices — super admin list
  adminListInvoices: async (req, res) => {
    try {
      const { tenantId } = req.params;
      const result = await pool.query(
        `SELECT ss.*, s.store_name, s.subdomain, s.custom_domain
         FROM store_subscriptions ss
         JOIN stores s ON s.id = ss.store_id
         WHERE s.tenant_id = $1 AND ss.payment_status = 'paid'
         ORDER BY ss.paid_at DESC`,
        [tenantId]
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      logger.error('Admin list invoices error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
};

module.exports = InvoiceController;
module.exports.generateInvoicePDF = generateInvoicePDF;
module.exports.getNextInvoiceNumber = getNextInvoiceNumber;
