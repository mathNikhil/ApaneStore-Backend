// src/jobs/wa.scheduler.job.js
// Runs every minute — finds due messages and dispatches them

const cron = require('node-cron');
const db   = require('../config/database');
const { dispatchMessage } = require('../services/wa.sender.service');

let isRunning = false; // prevent overlapping runs

cron.schedule('* * * * *', async () => {
  if (isRunning) return;
  isRunning = true;

  try {
    // Fetch up to 20 due messages (both personal and waba)
    const { rows: dueMessages } = await db.query(`
      SELECT m.*
      FROM wa_messages m
      JOIN wa_subscriptions s ON s.store_id = m.store_id AND s.is_active = true
      WHERE m.status = 'scheduled'
        AND m.scheduled_at <= NOW()
      ORDER BY m.scheduled_at ASC
      LIMIT 20
    `);

    for (const message of dueMessages) {
      try {
        await dispatchMessage(message);
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

// After a successful send, schedule the next occurrence if repeat is set
async function handleRepeat(message) {
  if (message.repeat_type === 'none') return;

  const next = new Date(message.scheduled_at);
  if (message.repeat_type === 'weekly')  next.setDate(next.getDate() + 7);
  if (message.repeat_type === 'monthly') next.setMonth(next.getMonth() + 1);

  await db.query(
    `UPDATE wa_messages SET scheduled_at=$1, status='scheduled', sent_count=0, failed_count=0, sent_at=NULL
     WHERE id=$2`,
    [next, message.id]
  );
}

console.log('[WA-Scheduler] Started — checking every minute for due messages');
module.exports = {};
