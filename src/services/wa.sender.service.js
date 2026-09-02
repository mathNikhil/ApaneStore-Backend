// src/services/wa.sender.service.js
// Handles actual message sending for both Personal and WABA modes

const axios   = require('axios');
const db      = require('../db');
const { getSocket } = require('./wa.session.service');

const DAILY_LIMIT = 75; // personal only

// ─── Delay helper ────────────────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Get today's sent count for a store (personal mode only) ────────────────
async function getTodayCount(storeId) {
  const { rows } = await db.query(
    `SELECT COALESCE(sent_count, 0) AS count FROM wa_daily_usage
     WHERE store_id=$1 AND date=CURRENT_DATE`,
    [storeId]
  );
  return rows[0] ? parseInt(rows[0].count) : 0;
}

// ─── Increment daily counter ─────────────────────────────────────────────────
async function incrementDailyCount(storeId, by = 1) {
  await db.query(
    `INSERT INTO wa_daily_usage (store_id, date, sent_count)
     VALUES ($1, CURRENT_DATE, $2)
     ON CONFLICT (store_id, date) DO UPDATE
     SET sent_count = wa_daily_usage.sent_count + $2`,
    [storeId, by]
  );
}

// ─── Resolve recipients → flat phone list ────────────────────────────────────
async function resolvePhones(storeId, recipients) {
  const phones = [];
  for (const r of recipients) {
    if (r.type === 'group') {
      const { rows } = await db.query(
        `SELECT phone FROM wa_contacts WHERE group_id=$1 AND store_id=$2`,
        [r.id, storeId]
      );
      phones.push(...rows.map((x) => x.phone));
    } else {
      const { rows } = await db.query(
        `SELECT phone FROM wa_contacts WHERE id=$1 AND store_id=$2`,
        [r.id, storeId]
      );
      if (rows[0]) phones.push(rows[0].phone);
    }
  }
  // Deduplicate
  return [...new Set(phones)];
}

// ─── Send one image message — PERSONAL ──────────────────────────────────────
async function sendPersonal({ storeId, phone, mediaUrl, caption, gapSeconds = 2 }) {
  const sock = getSocket(storeId);
  if (!sock) throw new Error('WhatsApp not connected. Scan QR to reconnect.');

  // JID format WhatsApp expects
  const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

  // Fetch image as buffer
  const imgRes  = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
  const buffer  = Buffer.from(imgRes.data);
  const mime    = imgRes.headers['content-type'] || 'image/jpeg';

  await sock.sendMessage(jid, {
    image: buffer,
    caption: caption || '',
    mimetype: mime,
  });

  await delay(gapSeconds * 1000); // 2-second human-like gap
}

// ─── Send one image message — WABA ───────────────────────────────────────────
async function sendWaba({ phone, mediaUrl, templateVars, config }) {
  const { phone_number_id, access_token, template_name, template_lang, environment } = config;

  const baseUrl = environment === 'production'
    ? 'https://graph.facebook.com/v20.0'
    : 'https://graph.facebook.com/v20.0'; // same endpoint; sandbox uses test numbers

  // templateVars is an object: { "1": "Priya", "2": "Fashion Hub", "3": "50% off!" }
  const components = [
    {
      type: 'header',
      parameters: [{ type: 'image', image: { link: mediaUrl } }],
    },
    {
      type: 'body',
      parameters: Object.values(templateVars || {}).map((val) => ({
        type: 'text',
        text: String(val),
      })),
    },
  ];

  await axios.post(
    `${baseUrl}/${phone_number_id}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone.replace(/\D/g, ''),
      type: 'template',
      template: {
        name: template_name,
        language: { code: template_lang || 'en_IN' },
        components,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  await delay(500); // WABA: smaller gap — API handles throttling
}

// ─── Main dispatch: send a full scheduled message to all recipients ──────────
async function dispatchMessage(message) {
  const { id: messageId, store_id, mode, recipients, media_url, caption, status } = message;

  if (status !== 'scheduled') return;

  // Get config
  const { rows: cfgRows } = await db.query(
    `SELECT * FROM wa_config WHERE store_id=$1`, [store_id]
  );
  const config = cfgRows[0];
  if (!config) throw new Error('No WhatsApp config found for store.');

  // Daily limit check (personal only)
  if (mode === 'personal') {
    const todayCount = await getTodayCount(store_id);
    if (todayCount >= DAILY_LIMIT) {
      await db.query(
        `UPDATE wa_messages SET status='failed', error_text=$1 WHERE id=$2`,
        ['Daily limit of 75 messages reached. Message will not be resent.', messageId]
      );
      return;
    }
  }

  // Resolve phones
  const phones = await resolvePhones(store_id, recipients);
  if (!phones.length) {
    await db.query(`UPDATE wa_messages SET status='failed', error_text='No valid contacts found.' WHERE id=$1`, [messageId]);
    return;
  }

  // Mark as sending
  await db.query(`UPDATE wa_messages SET status='sending', total_recipients=$1 WHERE id=$2`, [phones.length, messageId]);

  let sentCount   = 0;
  let failedCount = 0;

  for (const phone of phones) {
    try {
      if (mode === 'personal') {
        const templateVars = tryParseJSON(caption) || {};
        await sendPersonal({
          storeId:    store_id,
          phone,
          mediaUrl:   media_url,
          caption:    typeof caption === 'string' && !caption.startsWith('{') ? caption : templateVars?.caption || '',
          gapSeconds: config.gap_seconds || 2,
        });
      } else {
        await sendWaba({
          phone,
          mediaUrl:     media_url,
          templateVars: tryParseJSON(caption) || {},
          config,
        });
      }

      await db.query(
        `INSERT INTO wa_send_log (message_id, store_id, phone, status) VALUES ($1,$2,$3,'sent')`,
        [messageId, store_id, phone]
      );
      sentCount++;

      if (mode === 'personal') await incrementDailyCount(store_id, 1);

    } catch (err) {
      console.error(`[WA-Sender] Store ${store_id} phone ${phone}:`, err.message);
      await db.query(
        `INSERT INTO wa_send_log (message_id, store_id, phone, status, error) VALUES ($1,$2,$3,'failed',$4)`,
        [messageId, store_id, phone, err.message]
      );
      failedCount++;

      // Stop if daily limit hit mid-batch
      if (mode === 'personal' && err.message.includes('Daily limit')) break;
    }
  }

  // Final status
  const finalStatus = failedCount === phones.length ? 'failed' : 'sent';
  await db.query(
    `UPDATE wa_messages SET status=$1, sent_count=$2, failed_count=$3, sent_at=NOW() WHERE id=$4`,
    [finalStatus, sentCount, failedCount, messageId]
  );
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

module.exports = { dispatchMessage, getTodayCount, resolvePhones, DAILY_LIMIT };
