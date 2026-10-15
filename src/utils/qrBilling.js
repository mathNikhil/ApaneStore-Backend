const pool = require('../config/database');

// Test tenants — QR service is free and auto-active for these numbers
const TEST_TENANT_NUMBERS = ['5555555555', '6666666666', '7777777777'];

const isTestTenant = (mobile) => TEST_TENANT_NUMBERS.includes(String(mobile));

/**
 * Get the active QR subscription for a store.
 * Returns subscription row or null if none active.
 */
const getActiveQRSubscription = async (store_id) => {
  const result = await pool.query(
    `SELECT * FROM qr_service_subscriptions
     WHERE store_id = $1 AND status = 'active' AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [store_id]
  );
  return result.rows[0] || null;
};

/**
 * Check if QR service is active for a store.
 * For test tenants — always returns true.
 */
const isQRServiceActive = async (store_id, tenant_mobile) => {
  if (isTestTenant(tenant_mobile)) return true;
  const sub = await getActiveQRSubscription(store_id);
  return !!sub;
};

/**
 * Get QR pricing config from DB.
 */
const getQRPricing = async () => {
  const result = await pool.query(
    'SELECT * FROM qr_pricing_config WHERE is_active = true ORDER BY id DESC LIMIT 1'
  );
  if (!result.rows[0]) throw new Error('QR pricing not configured');
  return result.rows[0];
};

/**
 * Calculate prorata charge for QR activation.
 * Charge = (annual_price / 365) x remaining_days + GST
 * Linked to the store's publish expiry date.
 * Trial stores get QR free for the trial duration.
 */
const calculateQRCharge = async (store_id) => {
  // Get active store subscription — paid OR trial, not expired
  const storeResult = await pool.query(
    `SELECT ss.valid_until as publish_expires_at, ss.is_trial
     FROM stores s
     JOIN store_subscriptions ss ON ss.store_id = s.id
     WHERE s.id = $1
       AND ss.payment_status = 'paid'
       AND ss.valid_until > NOW()
     ORDER BY ss.valid_until DESC
     LIMIT 1`,
    [store_id]
  );

  if (!storeResult.rows[0]) {
    throw new Error('Store has no active subscription. Please publish your store first.');
  }

  const { publish_expires_at, is_trial } = storeResult.rows[0];
  const today = new Date();
  const expiry = new Date(publish_expires_at);
  const remaining_days = Math.max(0, Math.ceil((expiry - today) / (1000 * 60 * 60 * 24)));

  if (remaining_days === 0) {
    throw new Error('Store subscription has expired. Please renew your store first.');
  }

  // Trial stores get QR free for the trial duration
  if (is_trial) {
    return {
      is_trial: true,
      annual_price: 0,
      remaining_days,
      base_charge: 0,
      gst_rate: 0,
      gst_amount: 0,
      total: 0,
      currency: 'INR',
      expires_at: publish_expires_at
    };
  }

  // Paid stores — prorated charge
  const pricing = await getQRPricing();
  const { annual_price, gst_rate_percent } = pricing;

  const base_charge = Math.round((annual_price / 365) * remaining_days * 100) / 100;
  const gst_amount = Math.round(base_charge * (gst_rate_percent / 100) * 100) / 100;
  const total = Math.round((base_charge + gst_amount) * 100) / 100;

  return {
    is_trial: false,
    annual_price: Number(annual_price),
    remaining_days,
    base_charge,
    gst_rate: Number(gst_rate_percent),
    gst_amount,
    total,
    currency: 'INR',
    expires_at: publish_expires_at
  };
};

/**
 * Activate QR service for a store after successful payment.
 * For test tenants and trial stores — called directly without payment.
 */
const activateQRService = async ({ store_id, tenant_id, days_charged, amount_charged, gst_charged, payment_ref, cashfree_order_id, expires_at }) => {
  const result = await pool.query(
    `INSERT INTO qr_service_subscriptions
       (store_id, tenant_id, expires_at, days_charged, amount_charged, gst_charged, payment_ref, cashfree_order_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
     RETURNING *`,
    [store_id, tenant_id, expires_at, days_charged, amount_charged, gst_charged, payment_ref, cashfree_order_id]
  );
  return result.rows[0];
};

module.exports = {
  isTestTenant,
  isQRServiceActive,
  getActiveQRSubscription,
  getQRPricing,
  calculateQRCharge,
  activateQRService
};
