const pool = require('../config/database');

// ✅ Checks for stores whose paid subscription period has ended and reverts
// them to draft. A tenant returning to publish afterward is routed straight
// back to the payment step (their existing domain/hosting choice is kept —
// see PublishFlowRouter's resume logic, which already handles this
// correctly once payment_status is no longer 'paid').
const subscriptionExpiryService = {
    processExpiredSubscriptions: async () => {
        const client = await pool.connect();
        try {
            const expiredResult = await client.query(
                `SELECT s.id AS subscription_id, s.store_id, st.store_name, st.subdomain
                 FROM store_subscriptions s
                 JOIN stores st ON st.id = s.store_id
                 WHERE s.payment_status = 'paid'
                   AND s.valid_until IS NOT NULL
                   AND s.valid_until < NOW()
                   AND st.status = 'published'`
            );

            if (expiredResult.rows.length === 0) {
                return { success: true, processed: 0 };
            }

            let processed = 0;
            for (const row of expiredResult.rows) {
                try {
                    await client.query('BEGIN');

                    await client.query(
                        `UPDATE stores SET status = 'draft', updated_at = NOW() WHERE id = $1`,
                        [row.store_id]
                    );
                    await client.query(
                        `UPDATE store_subscriptions SET payment_status = 'expired', updated_at = NOW() WHERE id = $1`,
                        [row.subscription_id]
                    );

                    await client.query('COMMIT');
                    processed++;
                    console.log(`⏳ Subscription expired — store ${row.store_id} (${row.store_name || row.subdomain}) reverted to draft`);
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`❌ Failed to expire subscription for store ${row.store_id}:`, err.message);
                }
            }

            return { success: true, processed };
        } catch (error) {
            console.error('❌ Subscription expiry check failed:', error.message);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    },
};

module.exports = subscriptionExpiryService;
