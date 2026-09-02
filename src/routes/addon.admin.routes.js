// src/routes/addon.admin.routes.js
// Super admin routes for managing WhatsApp Market add-on plans
// Mount at: app.use('/api/admin/addon-plans', adminAuth, require('./routes/addon.admin.routes'))

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ─── GET all addon plans ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { addon_type = 'whatsapp_market' } = req.query;
    const { rows } = await db.query(
      `SELECT * FROM addon_plans
       WHERE addon_type = $1
       ORDER BY sort_order ASC, id ASC`,
      [addon_type]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET single plan ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM addon_plans WHERE id = $1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CREATE plan ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      addon_type = 'whatsapp_market',
      name, description,
      price_monthly, price_yearly,
      is_active = true, is_recommended = false, sort_order = 0,
      daily_msg_limit = 75, max_scheduled = 10,
      image_retain_days = 30, gap_seconds_min = 2,
      allow_waba = false,
    } = req.body;

    if (!name)          return res.status(400).json({ error: 'Plan name is required' });
    if (!price_monthly) return res.status(400).json({ error: 'Monthly price is required' });

    // If new plan is recommended, un-recommend others
    if (is_recommended) {
      await db.query(
        `UPDATE addon_plans SET is_recommended = false WHERE addon_type = $1`, [addon_type]
      );
    }

    const { rows } = await db.query(
      `INSERT INTO addon_plans
         (addon_type, name, description, price_monthly, price_yearly,
          is_active, is_recommended, sort_order,
          daily_msg_limit, max_scheduled, image_retain_days, gap_seconds_min, allow_waba)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [addon_type, name, description, price_monthly, price_yearly,
       is_active, is_recommended, sort_order,
       daily_msg_limit, max_scheduled, image_retain_days, gap_seconds_min, allow_waba]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE plan ─────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const {
      name, description,
      price_monthly, price_yearly,
      is_active, is_recommended, sort_order,
      daily_msg_limit, max_scheduled,
      image_retain_days, gap_seconds_min,
      allow_waba,
    } = req.body;

    // If this plan becoming recommended, un-recommend others first
    if (is_recommended) {
      const { rows: current } = await db.query(
        `SELECT addon_type FROM addon_plans WHERE id=$1`, [req.params.id]
      );
      if (current[0]) {
        await db.query(
          `UPDATE addon_plans SET is_recommended=false WHERE addon_type=$1 AND id != $2`,
          [current[0].addon_type, req.params.id]
        );
      }
    }

    const { rows } = await db.query(
      `UPDATE addon_plans SET
         name               = COALESCE($1,  name),
         description        = COALESCE($2,  description),
         price_monthly      = COALESCE($3,  price_monthly),
         price_yearly       = COALESCE($4,  price_yearly),
         is_active          = COALESCE($5,  is_active),
         is_recommended     = COALESCE($6,  is_recommended),
         sort_order         = COALESCE($7,  sort_order),
         daily_msg_limit    = COALESCE($8,  daily_msg_limit),
         max_scheduled      = COALESCE($9,  max_scheduled),
         image_retain_days  = COALESCE($10, image_retain_days),
         gap_seconds_min    = COALESCE($11, gap_seconds_min),
         allow_waba         = COALESCE($12, allow_waba),
         updated_at         = NOW()
       WHERE id = $13
       RETURNING *`,
      [name, description, price_monthly, price_yearly,
       is_active, is_recommended, sort_order,
       daily_msg_limit, max_scheduled, image_retain_days, gap_seconds_min,
       allow_waba, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TOGGLE active/inactive ───────────────────────────────────────────────────
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE addon_plans SET is_active = NOT is_active, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE plan ──────────────────────────────────────────────────────────────
// Only allowed if no active subscriptions on this plan
router.delete('/:id', async (req, res) => {
  try {
    const { rows: subs } = await db.query(
      `SELECT COUNT(*) AS cnt FROM wa_subscriptions
       WHERE addon_plan_id=$1 AND is_active=true`,
      [req.params.id]
    );
    if (parseInt(subs[0].cnt) > 0) {
      return res.status(400).json({
        error: `Cannot delete — ${subs[0].cnt} active subscriber(s) on this plan. Deactivate the plan instead.`
      });
    }
    await db.query(`DELETE FROM addon_plans WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET stats per plan (how many active subscribers) ────────────────────────
router.get('/:id/stats', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE is_active=true)  AS active_subscribers,
         COUNT(*) FILTER (WHERE is_active=false) AS inactive_subscribers,
         SUM(price_paid) FILTER (WHERE is_active=true) AS monthly_revenue_paise
       FROM wa_subscriptions
       WHERE addon_plan_id=$1`,
      [req.params.id]
    );
    const s = rows[0];
    res.json({
      active_subscribers:   parseInt(s.active_subscribers) || 0,
      inactive_subscribers: parseInt(s.inactive_subscribers) || 0,
      monthly_revenue:      Math.round((parseInt(s.monthly_revenue_paise) || 0) / 100),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET all market subscriptions (for super admin overview) ──────────────────
router.get('/subscriptions/all', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         ws.*, s.subdomain, t.business_name, t.mobile,
         ap.name AS plan_name_current, ap.price_monthly
       FROM wa_subscriptions ws
       JOIN stores s ON s.id = ws.store_id
       JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN addon_plans ap ON ap.id = ws.addon_plan_id
       ORDER BY ws.activated_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
