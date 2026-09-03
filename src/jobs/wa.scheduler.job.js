const cron = require('node-cron');
const db   = require('../config/database');
const { dispatchMessage } = require('../services/wa.sender.service');
const { incrementQuota, deactivateSubscription } = require('../services/wa.subscription.service');

let isRunning = false;

// ─── Every minute — send due messages ────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    const { rows: dueMessages } = await db.query(`
      SELECT m.*
      FROM wa_messages m
      JOIN wa_subscriptions s ON s.tenant_id = m.tenant_id AND s.is_active = true
      WHERE m.status = 'scheduled'
        AND m.scheduled_at <= NOW()
      ORDER BY m.scheduled_at ASC
      LIMIT 20
    `);

    for (const message of dueMessages) {
      try {
        const result = await dispatchMessage(message);

        // Only increment quota on successful send
        if (result?.finalStatus === 'sent') {
          await incrementQuota(message.tenant_id);
        }

        await handleRepeat(message);
      } catch (err) {
        console.error(`[WA-Scheduler] Message ${message.id} failed:`, err.message);
        await db.query(
          `UPDATE wa_messages SET status='failed', error_text=$1 WHERE id=$2`,
          [err.message, message.id]
        );
      }
    }
  } catch (err) {
    console.error('[WA-Scheduler] Cron error:', err.message);
  } finally {
    isRunning = false;
  }
});

// ─── Every hour — check expired subscriptions ─────────────────────────────────
cron.schedule('0 * * * *', async () => {
  try {
    const { rows: expired } = await db.query(`
      SELECT tenant_id FROM wa_subscriptions
      WHERE is_active = true AND expires_at < NOW()
    `);

    for (const { tenant_id } of expired) {
      console.log(`[WA-Expiry] Tenant ${tenant_id} subscription expired`);
      await deactivateSubscription(tenant_id, 'expired');
    }

    if (expired.length > 0) {
      console.log(`[WA-Expiry] Deactivated ${expired.length} expired subscriptions`);
    }
  } catch (err) {
    console.error('[WA-Expiry] Error:', err.message);
  }
});

// ─── Every hour — cleanup old history ────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM wa_messages
       WHERE status IN ('sent','failed')
       AND sent_at < NOW() - INTERVAL '24 hours'`
    );
    if (rowCount > 0) console.log(`[WA-Cleanup] Deleted ${rowCount} old messages`);
  } catch (err) {
    console.error('[WA-Cleanup] Error:', err.message);
  }
});

// ─── Repeat logic ─────────────────────────────────────────────────────────────
async function handleRepeat(message) {
  if (message.repeat_type === 'none') return;
  const next = new Date(message.scheduled_at);
  if (message.repeat_type === 'weekly')  next.setDate(next.getDate() + 7);
  if (message.repeat_type === 'monthly') next.setMonth(next.getMonth() + 1);
  await db.query(
    `UPDATE wa_messages SET scheduled_at=$1, status='scheduled',
     sent_count=0, failed_count=0, sent_at=NULL WHERE id=$2`,
    [next, message.id]
  );
}

console.log('[WA-Scheduler] Started — checking every minute for due messages');
module.exports = {};
