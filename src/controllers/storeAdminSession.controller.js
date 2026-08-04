const crypto = require('crypto');
const pool = require('../config/database');
const { decrypt } = require('../utils/encryption');

const IDLE_TIMEOUT_MS = (parseInt(process.env.STORE_ADMIN_SESSION_IDLE_MINUTES, 10) || 180) * 60 * 1000; // must match middleware/storeAdminAuth.js

// ✅ Public Store Admin login — no tenant OTP involved at all. Identifies
// the store by subdomain (works for draft stores too, not just published
// ones, since a tenant needs to test with real staff before publishing),
// checks the password, and enforces one active session at a time.
const StoreAdminSessionController = {
    // POST /api/store-admin/login   body: { subdomain, password }
    login: async (req, res) => {
        try {
            const { subdomain, password } = req.body;

            if (!subdomain || !password) {
                return res.status(400).json({ success: false, error: 'Subdomain and password are required' });
            }

            const storeResult = await pool.query(
                'SELECT id, store_name FROM stores WHERE subdomain = $1',
                [subdomain]
            );
            if (storeResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }
            const store = storeResult.rows[0];

            const credResult = await pool.query(
                'SELECT password_encrypted, active_session_token, session_last_active FROM store_admin_credentials WHERE store_id = $1',
                [store.id]
            );
            if (credResult.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    error: 'Store Admin access has not been set up for this store yet. Ask the store owner to generate a password from their dashboard.',
                });
            }
            const cred = credResult.rows[0];

            let actualPassword;
            try {
                actualPassword = decrypt(cred.password_encrypted);
            } catch (e) {
                console.error('❌ Failed to decrypt stored admin password:', e);
                return res.status(500).json({ success: false, error: 'Server configuration error' });
            }

            if (password !== actualPassword) {
                return res.status(401).json({ success: false, error: 'Invalid password' });
            }

            // Single-session enforcement: reject if a session is active AND
            // hasn't gone idle past the timeout. An idle/expired session is
            // treated as free and simply gets overwritten below.
            if (cred.active_session_token && cred.session_last_active) {
                const idleFor = Date.now() - new Date(cred.session_last_active).getTime();
                if (idleFor < IDLE_TIMEOUT_MS) {
                    return res.status(409).json({
                        success: false,
                        error: 'Another session is currently active for this store. Please try again later, or ask them to log out.',
                    });
                }
            }

            const sessionToken = crypto.randomBytes(32).toString('hex');
            await pool.query(
                'UPDATE store_admin_credentials SET active_session_token = $1, session_last_active = NOW() WHERE store_id = $2',
                [sessionToken, store.id]
            );

            res.json({
                success: true,
                data: { token: sessionToken, storeId: store.id, storeName: store.store_name },
            });
        } catch (error) {
            console.error('❌ Store Admin login error:', error);
            res.status(500).json({ success: false, error: error.message || 'Login failed' });
        }
    },

    // POST /api/store-admin/logout   body: { storeId, token? }   header: Bearer <token>?
    // Accepts the token from either the Authorization header (normal logout
    // button click) OR the request body (navigator.sendBeacon on tab/browser
    // close cannot set custom headers, only send a body).
    logout: async (req, res) => {
        try {
            // ✅ req.body is a string when it came from express.text()
            // (sendBeacon's text/plain path) and an already-parsed object
            // when it came from express.json() (the normal logout button).
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { storeId, token: bodyToken } = body;
            const authHeader = req.headers.authorization;
            const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
            const token = headerToken || bodyToken;

            if (!storeId || !token) {
                return res.status(400).json({ success: false, error: 'Store ID and session token are required' });
            }

            // Only clear the session if this token is actually the active
            // one — otherwise a stale/already-logged-out client couldn't
            // accidentally kick out someone else's newer session.
            await pool.query(
                'UPDATE store_admin_credentials SET active_session_token = NULL WHERE store_id = $1 AND active_session_token = $2',
                [storeId, token]
            );

            res.json({ success: true });
        } catch (error) {
            console.error('❌ Store Admin logout error:', error);
            res.status(500).json({ success: false, error: error.message || 'Logout failed' });
        }
    },
};

module.exports = StoreAdminSessionController;
