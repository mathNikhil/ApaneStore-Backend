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

        const result = await pool.query(
            'SELECT store_id, active_session_token, session_last_active FROM store_admin_credentials WHERE store_id = $1',
            [storeId]
        );

        if (result.rows.length === 0 || result.rows[0].active_session_token !== token) {
            return res.status(401).json({ success: false, error: 'Session is invalid or has been logged out. Please login again.' });
        }

        const cred = result.rows[0];
        const lastActive = cred.session_last_active ? new Date(cred.session_last_active).getTime() : 0;
        if (Date.now() - lastActive > IDLE_TIMEOUT_MS) {
            await pool.query(
                'UPDATE store_admin_credentials SET active_session_token = NULL WHERE store_id = $1',
                [storeId]
            );
            return res.status(401).json({ success: false, error: 'Session expired due to inactivity. Please login again.' });
        }

        // Sliding window — every valid request refreshes the idle clock.
        await pool.query(
            'UPDATE store_admin_credentials SET session_last_active = NOW() WHERE store_id = $1',
            [storeId]
        );

        req.adminId = `store-admin:${storeId}`;
        next();
    } catch (error) {
        console.error('❌ Store Admin auth error:', error);
        res.status(500).json({ success: false, error: 'Authentication error' });
    }
};

module.exports = { storeAdminAuth };
