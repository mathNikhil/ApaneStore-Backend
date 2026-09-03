// wa.subscription.service.js
const db       = require('../config/database');
const path     = require('path');
const fs       = require('fs');
const { disconnectSession } = require('./wa.session.service');

const SESSION_DIR = path.join(__dirname, '../../sessions');

// ─── DEACTIVATE ───────────────────────────────────────────────────────────────
async function deactivateSubscription(tenantId, reason = 'manual') {
  console.log(`[WA-Sub] Deactivating tenant ${tenantId} — reason: ${reason}`);
  try {
    // 1. Disconnect WhatsApp + delete session files
    await disconnectSession(tenantId).catch(() => {});
    const sessionPath = path.join(SESSION_DIR, `tenant_${tenantId}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`[WA-Sub] Session files deleted for tenant ${tenantId}`);
    }

    // 2. Deactivate subscription
    await db.query(
      `UPDATE wa_subscriptions
       SET is_active=false, deactivated_at=NOW(), deactivation_reason=$2
       WHERE tenant_id=$1`,
      [tenantId, reason]
    );

    // 3. Deactivate wa_config
    await db.query(
      `UPDATE wa_config
       SET is_active=false, session_exists=false, session_phone=NULL, updated_at=NOW()
       WHERE tenant_id=$1`,
      [tenantId]
    );

    // 4. Move scheduled messages to draft
    const { rowCount } = await db.query(
      `UPDATE wa_messages SET status='draft'
       WHERE tenant_id=$1 AND status='scheduled'`,
      [tenantId]
    );
    console.log(`[WA-Sub] ${rowCount} scheduled messages moved to draft`);

    console.log(`[WA-Sub] Tenant ${tenantId} deactivated successfully`);
    return { success: true };
  } catch (err) {
    console.error(`[WA-Sub] Deactivation error for tenant ${tenantId}:`, err.message);
    throw err;
  }
}

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
async function activateSubscription(tenantId, planId) {
  console.log(`[WA-Sub] Activating tenant ${tenantId} — plan ${planId}`);
  try {
    // Get plan details
    const { rows: plans } = await db.query(
      `SELECT * FROM addon_plans WHERE id=$1`, [planId]
    );
    if (!plans[0]) throw new Error(`Plan ${planId} not found`);
    const plan = plans[0];

    // Upsert subscription — reset quota, new 30 day period
    await db.query(
      `INSERT INTO wa_subscriptions
         (tenant_id, addon_plan_id, plan_name, price_paid, is_active,
          activated_at, expires_at, quota_used, deactivated_at, deactivation_reason)
       VALUES ($1,$2,$3,$4,true,NOW(),NOW()+($5 || ' days')::INTERVAL,0,NULL,NULL)
       ON CONFLICT (tenant_id) DO UPDATE SET
         addon_plan_id=$2, plan_name=$3, price_paid=$4,
         is_active=true, activated_at=NOW(),
         expires_at=NOW()+($5 || ' days')::INTERVAL,
         quota_used=0, deactivated_at=NULL, deactivation_reason=NULL`,
      [tenantId, planId, plan.name, plan.price_monthly, plan.validity_days || 30]
    );

    // Upsert wa_config — tenant must scan QR again
    await db.query(
      `INSERT INTO wa_config (tenant_id, mode, is_active, session_exists, gap_seconds)
       VALUES ($1,'personal',true,false,2)
       ON CONFLICT (tenant_id) DO UPDATE SET
         is_active=true, session_exists=false, session_phone=NULL, updated_at=NOW()`,
      [tenantId]
    );

    console.log(`[WA-Sub] Tenant ${tenantId} activated — plan: ${plan.name}, quota: ${plan.max_scheduled}`);
    return { success: true, plan };
  } catch (err) {
    console.error(`[WA-Sub] Activation error for tenant ${tenantId}:`, err.message);
    throw err;
  }
}

// ─── INCREMENT QUOTA (call after successful send) ─────────────────────────────
async function incrementQuota(tenantId) {
  try {
    // Increment quota_used
    const { rows } = await db.query(
      `UPDATE wa_subscriptions
       SET quota_used = quota_used + 1
       WHERE tenant_id=$1 AND is_active=true
       RETURNING quota_used, addon_plan_id`,
      [tenantId]
    );
    if (!rows[0]) return;

    const { quota_used, addon_plan_id } = rows[0];

    // Check if quota exhausted
    const { rows: plans } = await db.query(
      `SELECT max_scheduled FROM addon_plans WHERE id=$1`, [addon_plan_id]
    );
    const maxScheduled = plans[0]?.max_scheduled || 10;

    if (quota_used >= maxScheduled) {
      console.log(`[WA-Sub] Tenant ${tenantId} quota exhausted (${quota_used}/${maxScheduled})`);
      await deactivateSubscription(tenantId, 'quota_exhausted');
    }
  } catch (err) {
    console.error(`[WA-Sub] incrementQuota error:`, err.message);
  }
}

// ─── CHECK QUOTA before scheduling ───────────────────────────────────────────
async function checkQuota(tenantId) {
  const { rows } = await db.query(
    `SELECT s.quota_used, s.is_active, s.expires_at, p.max_scheduled
     FROM wa_subscriptions s
     JOIN addon_plans p ON p.id = s.addon_plan_id
     WHERE s.tenant_id=$1`,
    [tenantId]
  );
  if (!rows[0]) return { allowed: false, reason: 'no_subscription' };

  const { quota_used, is_active, expires_at, max_scheduled } = rows[0];

  if (!is_active) return { allowed: false, reason: 'inactive' };
  if (new Date(expires_at) < new Date()) return { allowed: false, reason: 'expired' };
  if (quota_used >= max_scheduled) return { allowed: false, reason: 'quota_exhausted' };

  return {
    allowed: true,
    quota_used,
    max_scheduled,
    quota_remaining: max_scheduled - quota_used,
  };
}

module.exports = { deactivateSubscription, activateSubscription, incrementQuota, checkQuota };
