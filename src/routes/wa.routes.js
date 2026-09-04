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
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Get tenantId from authenticated user
    const tenantId = req.tenantId || 'unknown';
    const uploadDir = path.join(__dirname, `../../public/uploads/market/${tenantId}`);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
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
  const storeId = req.tenantId;
  const { rows } = await db.query(
    `SELECT s.*, p.max_scheduled, p.name as plan_name_full,
            EXTRACT(DAY FROM s.expires_at - NOW()) as days_remaining
     FROM wa_subscriptions s
     LEFT JOIN addon_plans p ON p.id = s.addon_plan_id
     WHERE s.tenant_id=$1`, [storeId]
  );
  if (!rows[0]) return res.json({ is_active: false });
  const sub = rows[0];
  res.json({
    ...sub,
    quota_remaining: (sub.max_scheduled || 0) - (sub.quota_used || 0),
    expiry_warning: sub.days_remaining <= 3 && sub.days_remaining > 0,
    days_remaining: Math.max(0, Math.floor(sub.days_remaining || 0)),
  });
});

router.post('/subscription/activate', async (req, res) => {
  const storeId = req.tenantId; // tenant-level
  await db.query(
    `INSERT INTO wa_subscriptions (tenant_id, is_active, activated_at)
     VALUES ($1, true, NOW())
     ON CONFLICT (store_id) DO UPDATE SET is_active=true, activated_at=NOW()`,
    [storeId]
  );
  // Create default config row
  await db.query(
    `INSERT INTO wa_config (tenant_id) VALUES ($1) ON CONFLICT (store_id) DO NOTHING`,
    [storeId]
  );
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// CONFIG (mode, credentials)
// ════════════════════════════════════════════════════════
router.get('/config', async (req, res) => {
  const storeId = req.tenantId; // tenant-level
  const { rows } = await db.query(
    `SELECT id, store_id, mode, is_active, session_exists, session_phone,
            waba_id, phone_number_id, display_name, template_name, template_lang,
            environment, webhook_token, gap_seconds
     FROM wa_config WHERE tenant_id=$1`,
    [storeId]
  );
  if (!rows[0]) return res.json(null);
  // Add live connection status
  const cfg = rows[0];
  cfg.is_connected = cfg.mode === 'personal' ? isConnected(storeId) : !!cfg.phone_number_id;
  res.json(cfg);
});

router.put('/config', async (req, res) => {
  const storeId = req.tenantId; // tenant-level
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
     WHERE tenant_id=$11`,
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
  const storeId = req.tenantId; // tenant-level
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
  const storeId = req.tenantId; // tenant-level
  const connected   = isConnected(storeId);
  const todayCount  = connected ? await getTodayCount(storeId) : 0;
  const { rows }    = await db.query(`SELECT session_phone FROM wa_config WHERE tenant_id=$1`, [storeId]);

  res.json({
    connected,
    phone:      rows[0]?.session_phone || null,
    todayCount,
    dailyLimit: DAILY_LIMIT,
    remaining:  Math.max(DAILY_LIMIT - todayCount, 0),
  });
});

router.post('/connect/disconnect', async (req, res) => {
  await disconnectSession(req.tenantId);
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
router.post('/media/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const sharp     = require('sharp');
    const tenantId  = req.tenantId || 'unknown';
    const baseUrl   = process.env.API_BASE_URL || 'https://api.aapnaestore.com';
    const uploadDir = path.join(__dirname, `../../public/uploads/market/${tenantId}`);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filename  = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const outPath   = path.join(uploadDir, filename);

    // Compress with sharp — same as store builder (82% quality, max 1200px wide)
    await sharp(req.file.buffer || req.file.path)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true })
      .toFile(outPath);

    // Delete original multer temp file if it exists
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    const url = `${baseUrl}/uploads/market/${tenantId}/${filename}`;
    res.json({ url });
  } catch (err) {
    console.error('[WA Upload]', err);
    res.status(500).json({ error: 'Image processing failed' });
  }
});

// ════════════════════════════════════════════════════════
// GROUPS
// ════════════════════════════════════════════════════════
router.get('/groups', async (req, res) => {
  const storeId = req.tenantId; // tenant-level
  const { rows: groups } = await db.query(
    `SELECT g.*, COUNT(c.id)::int AS member_count
     FROM wa_groups g
     LEFT JOIN wa_contacts c ON c.group_id = g.id
     WHERE g.tenant_id=$1 GROUP BY g.id ORDER BY g.name`,
    [storeId]
  );
  // Attach members
  for (const g of groups) {
    const { rows: members } = await db.query(
      `SELECT c.id, c.name, c.phone
       FROM wa_contacts c
       JOIN wa_contact_groups cg ON cg.contact_id = c.id
       WHERE cg.group_id=$1
       ORDER BY c.name`, [g.id]
    );
    g.members = members;
    g.member_count = members.length;
  }
  res.json(groups);
});

router.post('/groups', async (req, res) => {
  const { name } = req.body;
  const { rows } = await db.query(
    `INSERT INTO wa_groups (tenant_id, name) VALUES ($1,$2) RETURNING *`,
    [req.tenantId, name]
  );
  res.json({ ...rows[0], members: [], member_count: 0 });
});

router.delete('/groups/:groupId', async (req, res) => {
  await db.query(
    `DELETE FROM wa_groups WHERE id=$1 AND store_id=$2`,
    [req.params.groupId, req.tenantId]
  );
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// CONTACTS
// ════════════════════════════════════════════════════════
router.get('/contacts', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*,
       COALESCE(
         json_agg(json_build_object('id', g.id, 'name', g.name))
         FILTER (WHERE g.id IS NOT NULL), '[]'
       ) AS groups
     FROM wa_contacts c
     LEFT JOIN wa_contact_groups cg ON cg.contact_id = c.id
     LEFT JOIN wa_groups g ON g.id = cg.group_id
     WHERE c.tenant_id=$1
     GROUP BY c.id
     ORDER BY c.name`,
    [req.tenantId]
  );
  res.json(rows);
});

router.post('/contacts', async (req, res) => {
  try {
    const { name, phone, group_ids, group_id } = req.body;
    const cleanPhone = phone.replace(/\D/g, '');

    // Create contact
    const { rows } = await db.query(
      `INSERT INTO wa_contacts (tenant_id, name, phone, group_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.tenantId, name, cleanPhone, group_id || null]
    );
    const contact = rows[0];

    // Save group assignments to join table
    // Support both group_ids (array) and group_id (single)
    const gids = group_ids?.length ? group_ids : (group_id ? [group_id] : []);
    for (const gid of gids) {
      await db.query(
        `INSERT INTO wa_contact_groups (contact_id, group_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [contact.id, gid]
      ).catch(() => {});
    }

    res.json(contact);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/contacts/:contactId', async (req, res) => {
  try {
    const { name, phone, group_ids } = req.body;
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const { rows } = await db.query(
      `UPDATE wa_contacts SET name=$1, phone=$2 WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [name, cleanPhone, req.params.contactId, req.tenantId]
    );
    if (group_ids !== undefined) {
      await db.query(`DELETE FROM wa_contact_groups WHERE contact_id=$1`, [req.params.contactId]);
      for (const gid of (group_ids || [])) {
        await db.query(
          `INSERT INTO wa_contact_groups (contact_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.params.contactId, gid]
        ).catch(() => {});
      }
    }
    res.json(rows[0] || { success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/contacts/:contactId', async (req, res) => {
  await db.query(
    `DELETE FROM wa_contacts WHERE id=$1 AND tenant_id=$2`,
    [req.params.contactId, req.tenantId]
  );
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════
router.get('/messages', async (req, res) => {
  const { status } = req.query;
  let query = `SELECT * FROM wa_messages WHERE tenant_id=$1`;
  const params = [req.tenantId];
  if (status) { query += ` AND status=$2`; params.push(status); }
  query += ` ORDER BY created_at DESC LIMIT 100`;
  const { rows } = await db.query(query, params);
  res.json(rows);
});

router.post('/messages', async (req, res) => {
  const { recipients, media_url, caption, scheduled_at, repeat_type, mode } = req.body;
  const { rows } = await db.query(
    `INSERT INTO wa_messages (tenant_id, mode, recipients, media_url, caption, scheduled_at, repeat_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
    [req.tenantId, mode, JSON.stringify(recipients), media_url,
     typeof caption === 'object' ? JSON.stringify(caption) : caption,
     scheduled_at, repeat_type || 'none']
  );
  res.json(rows[0]);
});

// POST /messages/batch — auto-split large groups into batches of 75
router.post('/messages/batch', async (req, res) => {
  try {
    const { recipients, media_url, caption, scheduled_at, repeat_type, mode, gap_seconds = 2 } = req.body;
    const tenantId = req.tenantId;
    const BATCH_SIZE = 75;

    // Resolve all contacts for splitting
    const allContacts = [];
    for (const r of recipients) {
      if (r.type === 'group') {
        const { rows } = await db.query(
          `SELECT c.id, c.phone, c.name FROM wa_contacts c
           JOIN wa_contact_groups cg ON cg.contact_id = c.id
           WHERE cg.group_id=$1 AND c.tenant_id=$2`,
          [r.id, tenantId]
        );
        rows.forEach(c => allContacts.push(c));
      } else {
        const { rows } = await db.query(
          `SELECT id, phone, name FROM wa_contacts WHERE id=$1 AND tenant_id=$2`,
          [r.id, tenantId]
        );
        if (rows[0]) allContacts.push(rows[0]);
      }
    }

    // Deduplicate by phone
    const seen = new Set();
    const unique = allContacts.filter(c => {
      if (seen.has(c.phone)) return false;
      seen.add(c.phone); return true;
    });

    // Split into batches of 75
    const batches = [];
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      batches.push(unique.slice(i, i + BATCH_SIZE));
    }

    const baseTime = new Date(scheduled_at);
    const createdMessages = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      // Each batch starts after previous batch finishes (75 contacts × gap_seconds)
      const batchTime = new Date(baseTime.getTime() + i * BATCH_SIZE * gap_seconds * 1000);

      const batchRecipients = batch.map(c => ({
        type: 'contact', id: c.id, label: c.name, count: 1, phone: c.phone,
      }));

      const batchCaption = typeof caption === 'object' ? JSON.stringify(caption) : caption;

      const { rows } = await db.query(
        `INSERT INTO wa_messages
           (tenant_id, mode, recipients, media_url, caption, scheduled_at, repeat_type, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
        [tenantId, mode, JSON.stringify(batchRecipients), media_url,
         batchCaption, batchTime.toISOString(), repeat_type || 'none']
      );
      createdMessages.push(rows[0]);
    }

    res.json({ success: true, batches: batches.length, total_contacts: unique.length, messages: createdMessages });
  } catch (err) {
    console.error('[Batch]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/messages/draft', async (req, res) => {
  const { recipients, media_url, caption, scheduled_at, repeat_type, mode } = req.body;
  const { rows } = await db.query(
    `INSERT INTO wa_messages (tenant_id, mode, recipients, media_url, caption, scheduled_at, repeat_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft') RETURNING *`,
    [req.tenantId, mode, JSON.stringify(recipients), media_url,
     typeof caption === 'object' ? JSON.stringify(caption) : caption,
     scheduled_at || null, repeat_type || 'none']
  );
  res.json(rows[0]);
});

router.put('/messages/:messageId', async (req, res) => {
  const { recipients, media_url, caption, scheduled_at, repeat_type } = req.body;
  const status = scheduled_at ? 'scheduled' : 'draft';
  const { rows } = await db.query(
    `UPDATE wa_messages SET recipients=$1, media_url=$2, caption=$3,
     scheduled_at=$4, repeat_type=$5, status=$6
     WHERE id=$7 AND tenant_id=$8 RETURNING *`,
    [JSON.stringify(recipients), media_url,
     typeof caption === 'object' ? JSON.stringify(caption) : caption,
     scheduled_at || null, repeat_type, status, req.params.messageId, req.tenantId]
  );
  res.json(rows[0]);
});

router.delete('/messages/:messageId', async (req, res) => {
  await db.query(
    `DELETE FROM wa_messages WHERE id=$1 AND tenant_id=$2`,
    [req.params.messageId, req.tenantId]
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

// ════════════════════════════════════════════════════════
// MANUAL DEACTIVATION
// ════════════════════════════════════════════════════════
router.post('/deactivate', async (req, res) => {
  try {
    const { deactivateSubscription } = require('../services/wa.subscription.service');
    await deactivateSubscription(req.tenantId, 'manual');
    res.json({ success: true, message: 'Subscription deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// PUBLIC — ADDON PLANS (no auth needed)
// ════════════════════════════════════════════════════════
router.get('/plans', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, description, price_monthly, price_yearly,
              daily_msg_limit, max_scheduled, image_retain_days,
              gap_seconds_min, is_recommended, is_active
       FROM addon_plans
       WHERE is_active = true AND addon_type = 'whatsapp_market'
       ORDER BY sort_order ASC, price_monthly ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// MARKET SUBSCRIPTION PAYMENT
// ════════════════════════════════════════════════════════

// POST /market/subscribe — create Cashfree order for market plan
router.post('/subscribe', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { plan_id } = req.body;

    // Get tenant info
    const { rows: tenants } = await db.query(
      `SELECT id, email, mobile, company_name FROM tenants WHERE id=$1`, [tenantId]
    );
    if (!tenants[0]) return res.status(404).json({ error: 'Tenant not found' });
    const tenant = tenants[0];

    // Get plan details
    const { rows: plans } = await db.query(
      `SELECT * FROM addon_plans WHERE id=$1 AND is_active=true`, [plan_id]
    );
    if (!plans[0]) return res.status(404).json({ error: 'Plan not found' });
    const plan = plans[0];

    // Create Cashfree order using existing payment service
    const { createOrder } = require('../services/paymentGateway.service');
    const orderId = `WA_${tenantId}_${plan_id}_${Date.now()}`;

    const amountRupees = plan.price_monthly / 100; // stored in paise
    const result = await createOrder({
      orderId,
      amount: amountRupees,
      currency: 'INR',
      customerName: tenant.company_name || 'Tenant',
      customerEmail: tenant.email || 'tenant@aapnaestore.com',
      customerPhone: tenant.mobile || '9999999999',
      returnUrl: `https://aapnaestore.com/market?order_id=${orderId}`,
    });

    // Store pending order in DB
    await db.query(
      `INSERT INTO cashfree_pending_orders (order_id, store_id, order_data, amount, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())
       ON CONFLICT (order_id) DO NOTHING`,
      [orderId, tenantId, JSON.stringify({ tenant_id: tenantId, plan_id, type: 'market_subscription' }), amountRupees]
    );

    res.json({ success: true, data: { paymentSessionId: result.paymentSessionId, orderId, plan } });
  } catch (err) {
    console.error('[Market Subscribe]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /market/subscription/status — check if payment succeeded
router.get('/subscription/status', async (req, res) => {
  try {
    const { order_id } = req.query;
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    const { rows } = await db.query(
      `SELECT status, order_data FROM cashfree_pending_orders WHERE order_id=$1`, [order_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    // If paid, activate subscription
    if (rows[0].status === 'paid') {
      const orderData = rows[0].order_data;
      const tenantId = orderData.tenant_id;
      const planId = orderData.plan_id;

      const { rows: plans } = await db.query(`SELECT * FROM addon_plans WHERE id=$1`, [planId]);
      const plan = plans[0];

      await db.query(
        `INSERT INTO wa_subscriptions (tenant_id, addon_plan_id, plan_name, price_paid, is_active, activated_at, expires_at)
         VALUES ($1,$2,$3,$4,true,NOW(), NOW() + INTERVAL '30 days')
         ON CONFLICT (tenant_id) DO UPDATE SET
           addon_plan_id=$2, plan_name=$3, price_paid=$4,
           is_active=true, activated_at=NOW(),
           expires_at=NOW() + INTERVAL '30 days'`,
        [tenantId, planId, plan?.plan_name, plan?.price]
      );
    }

    res.json({ success: true, status: rows[0].status, order_data: rows[0].order_data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
