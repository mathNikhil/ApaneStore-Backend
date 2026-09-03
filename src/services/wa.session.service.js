// src/services/wa.session.service.js
// Manages per-store WhatsApp personal sessions via Baileys

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');
const qrcode   = require('qrcode');
const path     = require('path');
const fs       = require('fs');
const db       = require('../config/database');

const SESSION_DIR = path.join(__dirname, '../../sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// In-memory socket map  storeId → socket
const sockets = new Map();
// In-memory QR map  storeId → base64 qr image (latest)
const qrCache = new Map();

// ─── Create / restore a session ─────────────────────────────────────────────
async function createSession(storeId, { onQR, onReady, onDisconnect } = {}) {
  const sessionPath = path.join(SESSION_DIR, `tenant_${storeId}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['AapnaEstore', 'Chrome', '24.0'],
    connectTimeoutMs: 20000,
  });

  sockets.set(String(storeId), sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      const qrImage = await qrcode.toDataURL(qr);
      qrCache.set(String(storeId), qrImage);
      onQR && onQR(qrImage);
    }

    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] || null;
      await db.query(
        `UPDATE wa_config SET session_exists=true, session_phone=$1, is_active=true, updated_at=NOW()
         WHERE tenant_id=$2`,
        [phone, storeId]
      );
      qrCache.delete(String(storeId));
      onReady && onReady(phone);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      sockets.delete(String(storeId));

      if (loggedOut) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        await db.query(
          `UPDATE wa_config SET session_exists=false, session_phone=NULL, is_active=false, updated_at=NOW()
           WHERE tenant_id=$1`,
          [storeId]
        );
        onDisconnect && onDisconnect('logged_out');
      } else {
        // Network drop — reconnect after 5s
        setTimeout(() => createSession(storeId, { onQR, onReady, onDisconnect }), 5000);
      }
    }
  });

  return sock;
}

// ─── Get active socket ───────────────────────────────────────────────────────
function getSocket(storeId) {
  return sockets.get(String(storeId)) || null;
}

function getQR(storeId) {
  return qrCache.get(String(storeId)) || null;
}

function isConnected(storeId) {
  const sock = sockets.get(String(storeId));
  if (!sock) return false;
  // Check if socket has an authenticated user — more reliable than WS readyState
  return !!(sock.user || sock.authState?.creds?.me);
}

// ─── Disconnect and wipe session ────────────────────────────────────────────
async function disconnectSession(storeId) {
  const sock = sockets.get(String(storeId));
  if (sock) {
    try { await sock.logout(); } catch (_) {}
    sockets.delete(String(storeId));
  }
  const sessionPath = path.join(SESSION_DIR, `tenant_${storeId}`);
  fs.rmSync(sessionPath, { recursive: true, force: true });
  await db.query(
    `UPDATE wa_config SET session_exists=false, session_phone=NULL, is_active=false, updated_at=NOW()
     WHERE tenant_id=$1`,
    [storeId]
  );
}

// ─── On server restart: restore all saved sessions ──────────────────────────
async function restoreAllSessions() {
  if (!fs.existsSync(SESSION_DIR)) return;
  const dirs = fs.readdirSync(SESSION_DIR).filter(d => d.startsWith('tenant_'));
  for (const dir of dirs) {
    const storeId = dir.replace('tenant_', '');
    console.log(`[WA-Session] Restoring store ${storeId}`);
    await createSession(storeId, {
      onReady: (phone) => console.log(`[WA-Session] Store ${storeId} restored — ${phone}`),
    });
  }
}

module.exports = { createSession, getSocket, getQR, isConnected, disconnectSession, restoreAllSessions };
