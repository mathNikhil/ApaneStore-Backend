const pool = require('../config/database');

// ✅ Validates a Store Admin session token for the store in the URL
// (req.params.storeId). This is completely separate from the tenant's own
// OTP-based `authenticate` middleware — a Store Admin session isn't tied
// to a tenant identity at all, just to one store's currently-active token.
//
// Also enforces the two things agreed for this feature:
//  - Single active session per store (a second login is rejected while
//    one is active — see the login endpoint for that check).
//  - Idle timeout: if this token hasn't been used in IDLE_TIMEOUT_MS, the
//    session is treated as expired and freed up, so a forgotten logout
//    doesn't lock everyone out indefinitely.
// ✅ Configurable via .env — defaults to 3 hours if not set. Lower this for
// faster iteration during testing (e.g. 15 minutes), raise it for real
// production use by real staff during a workday.
const IDLE_TIMEOUT_MS = (parseInt(process.env.STORE_ADMIN_SESSION_IDLE_MINUTES, 10) || 180) * 60 * 1000;

const storeAdminAuth = async (req, res, next) => {
    try {
        const { storeId } = req.params;
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!token) {
            return res.status(401).json({ success: false, error: 'No session token provided' });
        }

        // Resolve storeId (may be varchar 'STORE_...' or integer string) → integer PK
        const storeRow = await pool.query(
            `SELECT id FROM stores WHERE store_id = $1 OR (id::text = $1 AND $1 ~ '^[0-9]+$') LIMIT 1`,
            [String(storeId)]
        );
        if (!storeRow.rows.length) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }
        const storeIntId = storeRow.rows[0].id;

        // ── 1. Try owner session ──────────────────────────────────────────────
        const result = await pool.query(
            'SELECT store_id, active_session_token, session_last_active, branch_id FROM store_admin_credentials WHERE store_id = $1',
            [storeIntId]
        );

        if (result.rows.length > 0 && result.rows[0].active_session_token === token) {
            const cred = result.rows[0];
            const lastActive = cred.session_last_active ? new Date(cred.session_last_active).getTime() : Date.now();
            if (Date.now() - lastActive > IDLE_TIMEOUT_MS) {
                await pool.query(
                    'UPDATE store_admin_credentials SET active_session_token = NULL WHERE store_id = $1',
                    [storeIntId]
                );
                return res.status(401).json({ success: false, error: 'Session expired due to inactivity. Please login again.' });
            }
            // Sliding window — every valid request refreshes the idle clock.
            await pool.query(
                'UPDATE store_admin_credentials SET session_last_active = NOW() WHERE store_id = $1',
                [storeIntId]
            );
            req.adminId = `store-admin:${storeId}`;
            req.storeAdmin = {
                store_id: storeId,
                branch_id: cred.branch_id || null,
                role: 'owner',
                permissions: null,   // null = full access
            };
            return next();
        }

        // ── 2. Try staff session ──────────────────────────────────────────────
        // staff_sessions.store_id is INTEGER (= stores.id) after migration
        {
            const staffSess = await pool.query(
                `SELECT ss.id, ss.staff_id, ss.last_active, sm.permissions, sm.name AS staff_name
                 FROM service.staff_sessions ss
                 JOIN service.staff_members sm ON sm.id = ss.staff_id
                 WHERE ss.token = $1 AND ss.store_id = $2 AND sm.is_active = true
                 LIMIT 1`,
                [token, storeIntId]
            );
            if (staffSess.rows.length) {
                const sess = staffSess.rows[0];
                const lastActive = sess.last_active ? new Date(sess.last_active).getTime() : Date.now();
                if (Date.now() - lastActive > IDLE_TIMEOUT_MS) {
                    await pool.query('DELETE FROM service.staff_sessions WHERE id = $1', [sess.id]);
                    return res.status(401).json({ success: false, error: 'Session expired. Please login again.' });
                }
                await pool.query(
                    'UPDATE service.staff_sessions SET last_active = NOW() WHERE id = $1',
                    [sess.id]
                );
                req.adminId = `staff:${sess.staff_id}`;
                req.storeAdmin = {
                    store_id: storeId,
                    branch_id: null,
                    role: 'staff',
                    staffId: sess.staff_id,
                    staffName: sess.staff_name,
                    // permissions: [{page, access}] — JSONB returned as parsed object by pg
                    permissions: sess.permissions,
                };
                return next();
            }
        }

        return res.status(401).json({ success: false, error: 'Session is invalid or has been logged out. Please login again.' });
    } catch (error) {
        console.error('❌ Store Admin auth error:', error);
        res.status(500).json({ success: false, error: 'Authentication error' });
    }
};

module.exports = { storeAdminAuth };
