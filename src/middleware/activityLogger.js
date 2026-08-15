const pool = require('../config/database');

// Create activity_logs table if not exists
const initTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id SERIAL PRIMARY KEY,
            event_type VARCHAR(50) NOT NULL,
            ip_address VARCHAR(50),
            user_agent TEXT,
            identifier TEXT,
            success BOOLEAN,
            details TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
};
initTable().catch(console.error);

const logActivity = async (eventType, req, success, identifier = null, details = null) => {
    try {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        await pool.query(
            `INSERT INTO activity_logs (event_type, ip_address, user_agent, identifier, success, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [eventType, ip, userAgent, identifier, success, details]
        );
    } catch (e) {
        console.error('Activity log error:', e.message);
    }
};

module.exports = { logActivity };

const checkSuspiciousActivity = async (req) => {
    try {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const result = await pool.query(
            `SELECT COUNT(*) FROM activity_logs 
             WHERE ip_address = $1 
             AND success = false 
             AND created_at > NOW() - INTERVAL '15 minutes'`,
            [ip]
        );
        const failedAttempts = parseInt(result.rows[0].count);
        if (failedAttempts >= 3) {
            console.error(`🚨 SUSPICIOUS: ${failedAttempts} failed logins from IP ${ip} in 15 mins`);
            await pool.query(
                `INSERT INTO activity_logs (event_type, ip_address, success, details)
                 VALUES ($1, $2, $3, $4)`,
                ['suspicious_activity_detected', ip, false, `${failedAttempts} failed attempts in 15 minutes`]
            );
        }
    } catch (e) {
        console.error('Suspicious activity check error:', e.message);
    }
};

module.exports = { logActivity, checkSuspiciousActivity };
