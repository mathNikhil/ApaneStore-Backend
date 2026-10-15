const pool = require('../config/database');
const { generateQRToken, validateQRToken } = require('../utils/qrToken');
const {
  isTestTenant,
  isQRServiceActive,
  getActiveQRSubscription,
  getQRPricing,
  calculateQRCharge,
  activateQRService
} = require('../utils/qrBilling');
const paymentGatewayService = require('../services/paymentGateway.service');

// ─── GET /api/qr/status/:storeId (PUBLIC) ────────────────────────────────────
// Storefront calls this — no auth, just returns { active: bool }
const getQRStatusPublic = async (req, res) => {
  try {
    const { storeId } = req.params;

    // Get tenant mobile via store
    const storeResult = await pool.query(
      'SELECT t.phone FROM stores s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1',
      [storeId]
    );
    if (!storeResult.rows[0]) return res.json({ active: false });

    const active = await isQRServiceActive(storeId, storeResult.rows[0].phone);
    res.json({ active });
  } catch (err) {
    console.error('[QR] getQRStatusPublic error:', err);
    res.json({ active: false }); // fail safe — don't expose errors publicly
  }
};

// ─── GET /api/qr/status-admin/:storeId ───────────────────────────────────────
// Store Admin dashboard — is QR service active + full subscription info
const getQRStatus = async (req, res) => {
  try {
    const { storeId } = req.params;
    const tenantId = req.tenant.id;

    // Get tenant mobile to check test user
    const tenantResult = await pool.query('SELECT phone FROM tenants WHERE id = $1', [tenantId]);
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const isFreeTestUser = isTestTenant(tenant.phone);

    if (isFreeTestUser) {
      return res.json({ active: true, is_test_user: true, subscription: null });
    }

    const subscription = await getActiveQRSubscription(storeId);
    res.json({
      active: !!subscription,
      is_test_user: false,
      subscription: subscription || null
    });
  } catch (err) {
    console.error('[QR] getQRStatus error:', err);
    res.status(500).json({ error: 'Failed to get QR status' });
  }
};

// ─── GET /api/qr/pricing/:storeId ────────────────────────────────────────────
// Get prorata charge breakdown before activation
const getQRPricingForStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!storeId || storeId === 'undefined') {
      return res.status(400).json({ error: 'Invalid store ID' });
    }

    // Test tenants get QR free — return a zero-charge response
    const tenantResult = await pool.query(
      'SELECT t.phone FROM stores s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1',
      [storeId]
    );
    if (tenantResult.rows[0] && isTestTenant(tenantResult.rows[0].phone)) {
      return res.json({
        is_test_user: true,
        annual_price: 0,
        remaining_days: 365,
        base_charge: 0,
        gst_rate: 0,
        gst_amount: 0,
        total: 0,
        currency: 'INR',
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      });
    }

    const charge = await calculateQRCharge(storeId);
    res.json(charge);
  } catch (err) {
    console.error('[QR] getQRPricing error:', err.message, err.stack);
    res.status(400).json({ error: err.message });
  }
};

// ─── POST /api/qr/initiate-payment ───────────────────────────────────────────
// Create Cashfree order for QR activation. Test tenants → skip payment, direct activate.
const initiateQRPayment = async (req, res) => {
  try {
    const { store_id } = req.body;
    const tenantId = req.tenant.id;

    if (!store_id) return res.status(400).json({ error: 'store_id is required' });

    // Get tenant info — join via store; use phone (mobile column is empty)
    const tenantResult = await pool.query(
      `SELECT t.phone, t.email, t.company_name
       FROM stores s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.id = $1`,
      [store_id]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Test tenants — free, direct activation
    if (isTestTenant(tenant.phone)) {
      const storeResult = await pool.query(
        `SELECT ss.valid_until FROM stores s
         JOIN store_subscriptions ss ON ss.store_id = s.id AND ss.payment_status = 'paid'
         WHERE s.id = $1`, [store_id]
      );
      const expires_at = storeResult.rows[0]?.valid_until || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const remaining_days = Math.ceil((new Date(expires_at) - new Date()) / (1000 * 60 * 60 * 24));

      await activateQRService({
        store_id, tenant_id: tenantId,
        days_charged: remaining_days,
        amount_charged: 0, gst_charged: 0,
        payment_ref: 'TEST_FREE', cashfree_order_id: null,
        expires_at
      });
      return res.json({ success: true, is_test_user: true, active: true });
    }

    // Calculate charge
    const charge = await calculateQRCharge(store_id);

    // Trial stores — free, direct activation (QR tied to trial expiry)
    if (charge.is_trial) {
      await activateQRService({
        store_id, tenant_id: tenantId,
        days_charged: charge.remaining_days,
        amount_charged: 0, gst_charged: 0,
        payment_ref: 'TRIAL_FREE', cashfree_order_id: null,
        expires_at: charge.expires_at
      });
      return res.json({ success: true, is_trial: true, active: true });
    }

    // Create Cashfree order
    const orderId = `QR_${store_id}_${Date.now()}`;
    const paymentOrder = await paymentGatewayService.createOrder({
      orderId,
      amount: charge.total,
      currency: 'INR',
      customerName: tenant.company_name || 'Store Owner',
      customerEmail: tenant.email || '',
      customerPhone: tenant.phone,
      returnUrl: `${process.env.FRONTEND_URL || 'https://dashboard.aapnaestore.com'}/qr-payment-return?order_id=${orderId}`
    });

    // Store pending payment record
    await pool.query(
      `INSERT INTO pending_payments (order_id, tenant_id, store_id, amount, payment_type, meta, status)
       VALUES ($1, $2, $3, $4, 'qr_activation', $5, 'pending')`,
      [orderId, tenantId, store_id, charge.total, JSON.stringify({ charge, store_id })]
    );

    res.json({
      success: true,
      order_id: orderId,
      payment_session_id: paymentOrder.payment_session_id,
      charge
    });
  } catch (err) {
    console.error('[QR] initiateQRPayment error:', err);
    res.status(500).json({ error: err.message || 'Payment initiation failed' });
  }
};

// ─── POST /api/qr/cashfree-webhook ───────────────────────────────────────────
// Cashfree calls this on payment success/failure
const handleCashfreeWebhook = async (req, res) => {
  try {
    const settings = await paymentGatewayService.getSettings();
    const webhookSecret = process.env.CASHFREE_QR_WEBHOOK_SECRET || settings.pg_secret;

    const isValid = paymentGatewayService.verifyWebhookSignature(
      req.body, req.headers, webhookSecret, 'cashfree'
    );
    if (!isValid) {
      console.error('[QR Webhook] Invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = paymentGatewayService.parseWebhookEvent(req.body, 'cashfree');
    if (event.status !== 'SUCCESS') {
      return res.json({ received: true });
    }

    // Find pending payment
    const pendingResult = await pool.query(
      'SELECT * FROM pending_payments WHERE order_id = $1 AND status = $2',
      [event.orderId, 'pending']
    );
    const pending = pendingResult.rows[0];
    if (!pending) return res.json({ received: true }); // Already processed

    const meta = typeof pending.meta === 'string' ? JSON.parse(pending.meta) : pending.meta;
    const { charge, store_id } = meta;

    // Activate QR service
    await activateQRService({
      store_id: store_id || pending.store_id,
      tenant_id: pending.tenant_id,
      days_charged: charge.remaining_days,
      amount_charged: charge.base_charge,
      gst_charged: charge.gst_amount,
      payment_ref: event.paymentId,
      cashfree_order_id: event.orderId,
      expires_at: charge.expires_at
    });

    // Mark pending payment complete
    await pool.query(
      'UPDATE pending_payments SET status = $1, updated_at = NOW() WHERE order_id = $2',
      ['completed', event.orderId]
    );

    console.log(`[QR] Activated for store ${store_id}, payment ${event.paymentId}`);
    res.json({ received: true });
  } catch (err) {
    console.error('[QR Webhook] Error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// ─── POST /api/qr/generate ───────────────────────────────────────────────────
// Generate QR tokens for products. Requires active QR subscription.
const generateQRCodes = async (req, res) => {
  try {
    // storeAdminAuth sets req.storeAdmin.store_id from the URL param
    const store_id = req.storeAdmin?.store_id || req.params.storeId;
    const { products } = req.body;

    if (!store_id || !products?.length) {
      return res.status(400).json({ error: 'store_id and products[] are required' });
    }

    // Check QR active — look up tenant via store to get mobile for test-user check
    const tenantResult = await pool.query(
      'SELECT t.phone FROM stores s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1',
      [store_id]
    );
    if (!tenantResult.rows[0]) return res.status(403).json({ error: 'Store not found' });

    const active = await isQRServiceActive(store_id, tenantResult.rows[0].phone);
    if (!active) return res.status(403).json({ error: 'QR service not active for this store' });

    // Generate tokens
    const result = products.map(p => ({
      product_id: p.product_id,
      variant_id: p.variant_id || '',
      sku: p.sku || '',
      token: generateQRToken({
        store_id,
        product_id: p.product_id,
        variant_id: p.variant_id || '',
        sku: p.sku || '',
        price: p.price
      })
    }));

    res.json({ success: true, tokens: result });
  } catch (err) {
    console.error('[QR] generateQRCodes error:', err);
    res.status(500).json({ error: 'Failed to generate QR codes' });
  }
};

// ─── POST /api/qr/validate ───────────────────────────────────────────────────
// Storefront calls this after scanning a QR. Returns product data if valid.
const validateQR = async (req, res) => {
  try {
    const { token, store_id } = req.body;

    if (!token || !store_id) {
      return res.status(400).json({ valid: false, reason: 'token and store_id are required' });
    }

    // Validate signature
    const result = validateQRToken(token, store_id);
    if (!result.valid) {
      return res.json({ valid: false, reason: result.reason });
    }

    // Check QR service is still active for this store
    const storeResult = await pool.query(
      `SELECT s.id, t.phone FROM stores s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE s.id = $1`, [store_id]
    );
    if (!storeResult.rows[0]) return res.json({ valid: false, reason: 'store_not_found' });

    const qrActive = await isQRServiceActive(store_id, storeResult.rows[0].phone);
    if (!qrActive) return res.json({ valid: false, reason: 'qr_service_expired' });

    // Fetch clean display fields from inventory
    // Token has: product_id, variant_id (variation_id), sku (size_id)
    let invRow = null;

    // Best match: product + variation + size_id (sku field in token = size_id)
    if (result.variant_id && result.sku) {
      const invResult = await pool.query(
        `SELECT product_name, variation_name, size_label, image_url, price
         FROM inventory
         WHERE store_id = $1 AND product_id = $2 AND variation_id = $3 AND size_id = $4
         LIMIT 1`,
        [store_id, String(result.product_id), String(result.variant_id), String(result.sku)]
      );
      invRow = invResult.rows[0] || null;
    }

    // Fallback: product + variation only (no size_id in token)
    if (!invRow && result.variant_id) {
      const invResult = await pool.query(
        `SELECT product_name, variation_name, size_label, image_url, price
         FROM inventory
         WHERE store_id = $1 AND product_id = $2 AND variation_id = $3
         ORDER BY id LIMIT 1`,
        [store_id, String(result.product_id), String(result.variant_id)]
      );
      invRow = invResult.rows[0] || null;
    }

    // Last fallback: product only
    if (!invRow) {
      const invResult = await pool.query(
        `SELECT product_name, variation_name, size_label, image_url, price
         FROM inventory
         WHERE store_id = $1 AND product_id = $2
         ORDER BY id LIMIT 1`,
        [store_id, String(result.product_id)]
      );
      invRow = invResult.rows[0] || null;
    }

    if (!invRow) return res.json({ valid: false, reason: 'product_not_found' });

    // Parse size and unit from size_label e.g. "500 ml"
    const sl = invRow.size_label || '';
    const sizeMatch = sl.match(/^([\d.]+)\s*(.*)$/);
    const sizeNum = sizeMatch ? sizeMatch[1] : sl;
    const sizeUnit = sizeMatch ? sizeMatch[2].trim() : '';

    const displayPrice = result.price || invRow.price || 0;
    const imageUrl = invRow.image_url || '';

    res.json({
      valid: true,
      product: {
        id: result.product_id,
        variant_id: result.variant_id || null,
        size_id: result.sku || null,
        name: invRow.product_name || 'Product',
        variation_name: invRow.variation_name || '',
        size_label: invRow.size_label || '',
        size: sizeNum,
        unit: sizeUnit,
        image_url: imageUrl,
        images: imageUrl ? [imageUrl] : [],
        description: '',
        price: displayPrice,
        scanned_price: displayPrice,
      }
    });
  } catch (err) {
    console.error('[QR] validateQR error:', err.message, err.stack);
    res.status(500).json({ valid: false, reason: 'server_error', detail: err.message });
  }
};

// ─── POST /api/qr/admin/activate/:storeId ────────────────────────────────────
// Super admin — force-activate QR for a store (free, no payment, tied to store sub expiry)
const adminActivateQR = async (req, res) => {
  try {
    const { storeId } = req.params;

    // Get store + tenant + subscription expiry
    const storeResult = await pool.query(
      `SELECT s.id, s.tenant_id, ss.valid_until as publish_expires_at
       FROM stores s
       JOIN store_subscriptions ss ON ss.store_id = s.id AND ss.payment_status = 'paid'
       WHERE s.id = $1`,
      [storeId]
    );

    if (!storeResult.rows[0]) {
      return res.status(400).json({ error: 'Store has no active subscription — publish the store first' });
    }

    const { tenant_id, publish_expires_at } = storeResult.rows[0];
    const expires_at = publish_expires_at;
    const remaining_days = Math.max(1, Math.ceil((new Date(expires_at) - new Date()) / (1000 * 60 * 60 * 24)));

    // Deactivate any existing QR subscription first
    await pool.query(
      `UPDATE qr_service_subscriptions SET status = 'cancelled' WHERE store_id = $1 AND status = 'active'`,
      [storeId]
    );

    // Activate
    await activateQRService({
      store_id: storeId,
      tenant_id,
      days_charged: remaining_days,
      amount_charged: 0,
      gst_charged: 0,
      payment_ref: 'ADMIN_GRANTED',
      cashfree_order_id: null,
      expires_at
    });

    console.log(`[QR Admin] Activated QR for store ${storeId} by super admin`);
    res.json({ success: true, active: true, expires_at });
  } catch (err) {
    console.error('[QR Admin] adminActivateQR error:', err);
    res.status(500).json({ error: err.message || 'Failed to activate QR' });
  }
};

// ─── POST /api/qr/admin/deactivate/:storeId ──────────────────────────────────
// Super admin — force-deactivate QR for a store
const adminDeactivateQR = async (req, res) => {
  try {
    const { storeId } = req.params;

    await pool.query(
      `UPDATE qr_service_subscriptions SET status = 'cancelled' WHERE store_id = $1 AND status = 'active'`,
      [storeId]
    );

    console.log(`[QR Admin] Deactivated QR for store ${storeId} by super admin`);
    res.json({ success: true, active: false });
  } catch (err) {
    console.error('[QR Admin] adminDeactivateQR error:', err);
    res.status(500).json({ error: 'Failed to deactivate QR' });
  }
};

// ─── GET /api/qr/admin/pricing ───────────────────────────────────────────────
// Super admin — get current QR pricing config
const getAdminQRPricing = async (req, res) => {
  try {
    const pricing = await getQRPricing();
    res.json(pricing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/qr/admin/pricing ───────────────────────────────────────────────
// Super admin — update QR pricing
const updateAdminQRPricing = async (req, res) => {
  try {
    const { annual_price, gst_rate_percent } = req.body;
    if (annual_price === undefined || annual_price === null || gst_rate_percent === undefined || gst_rate_percent === null) {
      return res.status(400).json({ error: 'annual_price and gst_rate_percent are required' });
    }
    if (Number(annual_price) < 0 || Number(gst_rate_percent) < 0) {
      return res.status(400).json({ error: 'Values cannot be negative' });
    }

    const result = await pool.query(
      `UPDATE qr_pricing_config
       SET annual_price = $1, gst_rate_percent = $2, updated_at = NOW()
       WHERE is_active = true
       RETURNING *`,
      [annual_price, gst_rate_percent]
    );
    res.json({ success: true, pricing: result.rows[0] });
  } catch (err) {
    console.error('[QR Admin] updatePricing error:', err);
    res.status(500).json({ error: 'Failed to update pricing' });
  }
};

// ─── GET /api/qr/payment-status ──────────────────────────────────────────────
// Called from QRPaymentReturn page after Cashfree redirect — checks if QR is now active
const getQRPaymentStatus = async (req, res) => {
  try {
    const { order_id } = req.query;
    if (!order_id) return res.status(400).json({ active: false, error: 'order_id required' });

    const result = await pool.query(
      'SELECT store_id, status FROM pending_payments WHERE order_id = $1',
      [order_id]
    );
    const payment = result.rows[0];
    if (!payment) return res.json({ active: false });

    if (payment.status === 'completed') {
      const sub = await getActiveQRSubscription(payment.store_id);
      return res.json({ active: !!sub });
    }

    res.json({ active: false });
  } catch (err) {
    console.error('[QR] getQRPaymentStatus error:', err);
    res.status(500).json({ active: false });
  }
};

module.exports = {
  getQRStatusPublic,
  getQRStatus,
  getQRPricingForStore,
  initiateQRPayment,
  handleCashfreeWebhook,
  generateQRCodes,
  validateQR,
  getAdminQRPricing,
  updateAdminQRPricing,
  adminActivateQR,
  adminDeactivateQR,
  getQRPaymentStatus
};
