// src/routes/wa.routes.js
// All /api/stores/:storeId/market/* routes

const express  = require('express');
const router   = express.Router({ mergeParams: true });
const db       = require('../config/database');
const { authenticate: auth } = require('../middleware/auth');
const {
  createSession, getQR, isConnected, disconnectSession,
} = require('../services/wa.session.service');
const { getTodayCount, DAILY_LIMIT } = require('../services/wa.sender.service');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

// ─── Media upload setup ──────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../public/uploads/market');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

// All routes require tenant auth
router.use(auth);

// ════════════════════════════════════════════════════════
// SUBSCRIPTION CHECK
// ════════════════════════════════════════════════════════
router.get('/subscription', async (req, res) => {
  const { storeId } = req.params;
  const { rows } = await db.query(
    `SELECT * FROM wa_subscriptions WHERE store_id=$1`, [storeId]
  );
  res.json(rows[0] || { is_active: false });
});

router.post('/subscription/activate', async (req, res) => {
  const { storeId } = req.params;
  await db.query(
    `INSERT INTO wa_subscriptions (store_id, is_active, activated_at)
     VALUES ($1, true, NOW())
     ON CONFLICT (store_id) DO UPDATE SET is_active=true, activated_at=NOW()`,
    [storeId]
  );
  // Create default config row
  await db.query(
    `INSERT INTO wa_config (store_id) VALUES ($1) ON CONFLICT (store_id) DO NOTHING`,
    [storeId]
  );
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// CONFIG (mode, credentials)
// ════════════════════════════════════════════════════════
router.get('/config', async (req, res) => {
  const { storeId } = req.params;
  const { rows } = await db.query(
    `SELECT id, store_id, mode, is_active, session_exists, session_phone,
            waba_id, phone_number_id, display_name, template_name, template_lang,
            environment, webhook_token, gap_seconds
     FROM wa_config WHERE store_id=$1`,
    [storeId]
  );
  if (!rows[0]) return res.json(null);
  // Add live connection status
  const cfg = rows[0];
  cfg.is_connected = cfg.mode === 'personal' ? isConnected(storeId) : !!cfg.phone_number_id;
  res.json(cfg);
});

router.put('/config', async (req, res) => {
  const { storeId } = req.params;
  const {
    mode, gap_seconds,
    waba_id, phone_number_id, access_token, display_name,
    template_name, template_lang, environment, webhook_token,
  } = req.body;

  await db.query(
    `UPDATE wa_config SET
       mode=$1, gap_seconds=$2,
       waba_id=$3, phone_number_id=$4,
       access_token=COALESCE(NULLIF($5,''), access_token),
       display_name=$6, template_name=$7, template_lang=$8,
       environment=$9, webhook_token=$10, updated_at=NOW()
     WHERE store_id=$11`,
    [mode, gap_seconds || 2, waba_id, phone_number_id, access_token,
     display_name, template_name, template_lang, environment, webhook_token, storeId]
  );
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// PERSONAL — QR / SESSION
// ════════════════════════════════════════════════════════

// Start QR session — returns QR image as base64 or 'already_connected'
router.post('/connect/qr', async (req, res) => {
  const { storeId } = req.params;
  if (isConnected(storeId)) return res.json({ status: 'already_connected' });

  let responded = false;

  await createSession(storeId, {
    onQR: (qrImage) => {
      if (!responded) {
        responded = true;
        res.json({ status: 'qr', qr: qrImage });
      }
    },
    onReady: (phone) => {
      if (!responded) {
        responded = true;
        res.json({ status: 'connected', phone });
      }
    },
    onDisconnect: () => {},
  });

  setTimeout(() => {
    if (!responded) { responded = true; res.status(408).json({ error: 'QR timeout — try again' }); }
  }, 20000);
});

// Poll status after QR scan
router.get('/connect/status', async (req, res) => {
  const { storeId } = req.params;
  const connected   = isConnected(storeId);
  const todayCount  = connected ? await getTodayCount(storeId) : 0;
  const { rows }    = await db.query(`SELECT session_phone FROM wa_config WHERE store_id=$1`, [storeId]);

  res.json({
    connected,
    phone:      rows[0]?.session_phone || null,
    todayCount,
    dailyLimit: DAILY_LIMIT,
    remaining:  Math.max(DAILY_LIMIT - todayCount, 0),
  });
});

router.post('/connect/disconnect', async (req, res) => {
  await disconnectSession(req.params.storeId);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// WABA — test connection
// ════════════════════════════════════════════════════════
router.post('/waba/test', async (req, res) => {
  const { phone_number_id, access_token } = req.body;
  try {
    const axios  = require('axios');
    const result = await axios.get(
      `https://graph.facebook.com/v20.0/${phone_number_id}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    res.json({ success: true, display_phone: result.data?.display_phone_number });
  } catch (err) {
    res.status(400).json({ success: false, error: err.response?.data?.error?.message || err.message });
  }
});

// ════════════════════════════════════════════════════════
// MEDIA UPLOAD
// ════════════════════════════════════════════════════════
router.post('/media/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `${process.env.API_BASE_URL}/uploads/market/${req.file.filename}`;
  res.json({ url });
});

// ════════════════════════════════════════════════════════
// GROUPS
// ════════════════════════════════════════════════════════
router.get('/groups', async (req, res) => {
  const { storeId } = req.params;
  const { rows: groups } = await db.query(
    `SELECT g.*, COUNT(c.id)::int AS member_count
     FROM wa_groups g
     LEFT JOIN wa_contacts c ON c.group_id = g.id
     WHERE g.store_id=$1 GROUP BY g.id ORDER BY g.name`,
    [storeId]
  );
  // Attach members
  for (const g of groups) {
    const { rows: members } = await db.query(
      `SELECT id, name, phone FROM wa_contacts WHERE group_id=$1`, [g.id]
    );
    g.members = members;
  }
  res.json(groups);
});

router.post('/groups', async (req, res) => {
  const { name } = req.body;
  const { rows } = await db.query(
    `INSERT INTO wa_groups (store_id, name) VALUES ($1,$2) RETURNING *`,
    [req.params.storeId, name]
  );
  res.json({ ...rows[0], members: [], member_count: 0 });
});

router.delete('/groups/:groupId', async (req, res) => {
  await db.query(
    `DELETE FROM wa_groups WHERE id=$1 AND store_id=$2`,
    [req.params.groupId, req.params.storeId]
  );
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// CONTACTS
// ════════════════════════════════════════════════════════
router.get('/contacts', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, g.name AS group_name
     FROM wa_contacts c
     LEFT JOIN wa_groups g ON g.id = c.group_id
     WHERE c.store_id=$1 ORDER BY c.name`,
    [req.params.storeId]
  );
  res.json(rows);
});

router.post('/contacts', async (req, res) => {
  const { name, phone, group_id } = req.body;
  // Sanitize phone — digits only
  const cleanPhone = phone.replace(/\D/g, '');
  const { rows } = await db.query(
    `INSERT INTO wa_contacts (store_id, name, phone, group_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.storeId, name, cleanPhone, group_id || null]
  );
  res.json(rows[0]);
});

router.delete('/contacts/:contactId', async (req, res) => {
  await db.query(
    `DELETE FROM wa_contacts WHERE id=$1 AND store_id=$2`,
    [req.params.contactId, req.params.storeId]
  );
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════
router.get('/messages', async (req, res) => {
  const { status } = req.query;
  let query = `SELECT * FROM wa_messages WHERE store_id=$1`;
  const params = [req.params.storeId];
  if (status) { query += ` AND status=$2`; params.push(status); }
  query += ` ORDER BY created_at DESC LIMIT 100`;
  const { rows } = await db.query(query, params);
  res.json(rows);
});

router.post('/messages', async (req, res) => {
  const { recipients, media_url, caption, scheduled_at, repeat_type, mode } = req.body;
  const { rows } = await db.query(
    `INSERT INTO wa_messages (store_id, mode, recipients, media_url, caption, scheduled_at, repeat_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
    [req.params.storeId, mode, JSON.stringify(recipients), media_url,
     typeof caption === 'object' ? JSON.stringify(caption) : caption,
     scheduled_at, repeat_type || 'none']
  );
  res.json(rows[0]);
});

router.post('/messages/draft', async (req, res) => {
  const { recipients, media_url, caption, scheduled_at, repeat_type, mode } = req.body;
  const { rows } = await db.query(
    `INSERT INTO wa_messages (store_id, mode, recipients, media_url, caption, scheduled_at, repeat_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft') RETURNING *`,
    [req.params.storeId, mode, JSON.stringify(recipients), media_url,
     typeof caption === 'object' ? JSON.stringify(caption) : caption,
     scheduled_at || null, repeat_type || 'none']
  );
  res.json(rows[0]);
});

router.put('/messages/:messageId', async (req, res) => {
  const { recipients, media_url, caption, scheduled_at, repeat_type } = req.body;
  const { rows } = await db.query(
    `UPDATE wa_messages SET recipients=$1, media_url=$2, caption=$3,
     scheduled_at=$4, repeat_type=$5, status='scheduled', updated_at=NOW()
     WHERE id=$6 AND store_id=$7 RETURNING *`,
    [JSON.stringify(recipients), media_url,
     typeof caption === 'object' ? JSON.stringify(caption) : caption,
     scheduled_at, repeat_type, req.params.messageId, req.params.storeId]
  );
  res.json(rows[0]);
});

router.delete('/messages/:messageId', async (req, res) => {
  await db.query(
    `DELETE FROM wa_messages WHERE id=$1 AND store_id=$2`,
    [req.params.messageId, req.params.storeId]
  );
  res.json({ success: true });
});

// Send log for a message
router.get('/messages/:messageId/log', async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM wa_send_log WHERE message_id=$1 ORDER BY sent_at`,
    [req.params.messageId]
  );
  res.json(rows);
});

module.exports = router;
