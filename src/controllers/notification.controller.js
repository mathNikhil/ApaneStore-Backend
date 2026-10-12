const pool = require('../config/database');

// GET /api/store/:storeId/admin/notification-status
// Returns: paid plan status + gmail connection status
const getNotificationStatus = async (req, res) => {
    try {
        const { storeId } = req.params;

        // Check paid subscription
        const subResult = await pool.query(
            `SELECT payment_status, is_trial, status, valid_until
             FROM store_subscriptions
             WHERE store_id = (SELECT id FROM stores WHERE store_id = $1)
               AND status = 'active'
             ORDER BY created_at DESC
             LIMIT 1`,
            [storeId]
        );

        const sub = subResult.rows[0];
        const isPaid = sub && sub.payment_status === 'paid' && sub.is_trial === false;

        // Check gmail connection
        const gmailResult = await pool.query(
            `SELECT notification_gmail_email, notification_gmail_connected_at
             FROM stores WHERE store_id = $1`,
            [storeId]
        );

        const store = gmailResult.rows[0];
        const gmailConnected = !!(store && store.notification_gmail_email);

        res.json({
            success: true,
            data: {
                isPaid,
                gmailConnected,
                gmailEmail: store?.notification_gmail_email || null,
                connectedAt: store?.notification_gmail_connected_at || null,
                subscription: sub || null
            }
        });
    } catch (error) {
        console.error('getNotificationStatus error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch notification status' });
    }
};

// POST /api/store/:storeId/admin/notification/disconnect-gmail
const disconnectGmail = async (req, res) => {
    try {
        const { storeId } = req.params;
        await pool.query(
            `UPDATE stores 
             SET notification_gmail_email = NULL,
                 notification_gmail_refresh_token = NULL,
                 notification_gmail_connected_at = NULL
             WHERE store_id = $1`,
            [storeId]
        );
        res.json({ success: true, message: 'Gmail disconnected' });
    } catch (error) {
        console.error('disconnectGmail error:', error);
        res.status(500).json({ success: false, error: 'Failed to disconnect Gmail' });
    }
};

module.exports = { getNotificationStatus, disconnectGmail };
