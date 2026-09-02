// src/routes/addon.public.routes.js
// Tenant-facing routes — fetch active plans, initiate payment
// Mount at: app.use('/api/addon-plans', require('./routes/addon.public.routes'))

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authenticate: auth } = require('../middleware/auth');
const { createOrder } = require('../services/paymentGateway.service');
const { isTestTenant } = require('../services/paymentGateway.service');

// GET active plans for tenant plan picker
router.get('/', async (req, res) => {
  try {
    const { addon_type = 'whatsapp_market' } = req.query;
    const { rows } = await db.query(
      `SELECT id, name, description, price_monthly, price_yearly,
              is_recommended, sort_order,
              daily_msg_limit, max_scheduled, image_retain_days, allow_waba
       FROM addon_plans
       WHERE addon_type=$1 AND is_active=true
       ORDER BY sort_order ASC`,
      [addon_type]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST initiate payment for an add-on plan
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { store_id, addon_plan_id, billing_cycle = 'monthly' } = req.body;

    // Fetch plan
    const { rows: plans } = await db.query(
      `SELECT * FROM addon_plans WHERE id=$1 AND is_active=true`, [addon_plan_id]
    );
    if (!plans[0]) return res.status(404).json({ error: 'Plan not found or inactive' });
    const plan = plans[0];

    const amount = billing_cycle === 'yearly' && plan.price_yearly
      ? plan.price_yearly
      : plan.price_monthly;

    // Fetch tenant mobile for test bypass
    const { rows: stores } = await db.query(
      `SELECT t.mobile FROM stores s JOIN tenants t ON t.id=s.tenant_id WHERE s.id=$1`,
      [store_id]
    );
    const mobile = stores[0]?.mobile;

    // Test tenant bypass — activate immediately, no payment
    if (isTestTenant(mobile)) {
      await activateSubscription({ store_id, plan, billing_cycle, amount, pendingId: null });
      return res.json({ success: true, bypassed: true });
    }

    // Create pending_payment record
    const { rows: pending } = await db.query(
      `INSERT INTO pending_payments
         (store_id, amount, type, status, plan_details)
       VALUES ($1,$2,'market_addon','pending',$3)
       RETURNING id`,
      [store_id, amount, JSON.stringify({
        addon_plan_id,
        plan_name: plan.name,
        addon_type: plan.addon_type,
        billing_cycle,
      })]
    );
    const pendingId = pending[0].id;

    // Create Cashfree/Razorpay order using existing service
    const order = await createOrder({
      orderId:    `ADDON_${store_id}_${pendingId}`,
      amount,
      customerId: String(store_id),
      returnUrl:  `${process.env.FRONTEND_URL}/market?payment=success&pending=${pendingId}`,
      meta: {
        type:    'market_addon',
        pending: pendingId,
      },
    });

    res.json({
      payment_url:    order.payment_url,
      payment_session_id: order.payment_session_id, // Cashfree SDK field
      order_id:       order.order_id,
      pending_id:     pendingId,
      amount_display: `₹${Math.round(amount / 100)}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Called by webhook handler — exported so webhook can use it
async function activateSubscription({ store_id, plan, billing_cycle, amount, pendingId }) {
  const expiryInterval = billing_cycle === 'yearly' ? '1 year' : '1 month';

  await db.query(
    `INSERT INTO wa_subscriptions
       (store_id, is_active, addon_plan_id, plan_name, price_paid, billing_cycle, activated_at, expires_at)
     VALUES ($1, true, $2, $3, $4, $5, NOW(), NOW() + $6::interval)
     ON CONFLICT (store_id) DO UPDATE SET
       is_active      = true,
       addon_plan_id  = $2,
       plan_name      = $3,
       price_paid     = $4,
       billing_cycle  = $5,
       activated_at   = NOW(),
       expires_at     = NOW() + $6::interval`,
    [store_id, plan.id, plan.name, amount, billing_cycle, expiryInterval]
  );

  // Ensure wa_config row exists
  await db.query(
    `INSERT INTO wa_config (store_id) VALUES ($1) ON CONFLICT (store_id) DO NOTHING`,
    [store_id]
  );

  // Mark pending payment complete
  if (pendingId) {
    await db.query(
      `UPDATE pending_payments SET status='completed' WHERE id=$1`, [pendingId]
    );
  }
}

module.exports = router;
module.exports.activateSubscription = activateSubscription;
