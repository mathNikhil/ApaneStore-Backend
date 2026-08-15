const pool = require('../config/database');

class SubscriptionExpiryService {

    // Run daily — check all subscriptions and handle expiry + grace period
    async processExpiredSubscriptions() {
        console.log('⏰ Running subscription expiry check...');
        try {
            // 1. Find subscriptions that just expired (valid_until passed, grace not set yet)
            const justExpired = await pool.query(`
                SELECT ss.*, s.id as store_db_id, s.store_name, s.status as store_status
                FROM store_subscriptions ss
                JOIN stores s ON s.id = ss.store_id
                WHERE ss.payment_status = 'paid'
                AND ss.valid_until < NOW()
                AND ss.grace_period_end IS NULL
                AND s.status = 'published'
            `);

            for (const sub of justExpired.rows) {
                // Set 7-day grace period
                await pool.query(`
                    UPDATE store_subscriptions 
                    SET grace_period_end = NOW() + INTERVAL '7 days',
                        status = 'grace',
                        updated_at = NOW()
                    WHERE id = $1
                `, [sub.id]);
                console.log(`⚠️ Store ${sub.store_name} entered grace period`);
            }

            // 2. Find stores whose grace period has ended
            const graceExpired = await pool.query(`
                SELECT ss.*, s.id as store_db_id, s.store_name
                FROM store_subscriptions ss
                JOIN stores s ON s.id = ss.store_id
                WHERE ss.status = 'grace'
                AND ss.grace_period_end < NOW()
                AND s.status = 'published'
            `);

            for (const sub of graceExpired.rows) {
                // Move store to draft
                await pool.query(`
                    UPDATE stores 
                    SET status = 'draft', updated_at = NOW()
                    WHERE id = $1
                `, [sub.store_db_id]);

                await pool.query(`
                    UPDATE store_subscriptions 
                    SET status = 'expired', updated_at = NOW()
                    WHERE id = $1
                `, [sub.id]);

                console.log(`❌ Store ${sub.store_name} moved to draft — grace period ended`);
            }

            console.log(`✅ Expiry check done: ${justExpired.rows.length} entered grace, ${graceExpired.rows.length} moved to draft`);
        } catch (error) {
            console.error('❌ Subscription expiry check error:', error);
        }
    }

    // Get subscription status for a store — used by dashboard
    async getSubscriptionStatus(storeId) {
        try {
            const result = await pool.query(`
                SELECT *, 
                    EXTRACT(EPOCH FROM (valid_until - NOW())) / 86400 AS days_remaining,
                    EXTRACT(EPOCH FROM (grace_period_end - NOW())) / 86400 AS grace_days_remaining
                FROM store_subscriptions
                WHERE store_id = $1
                ORDER BY created_at DESC
                LIMIT 1
            `, [storeId]);

            if (result.rows.length === 0) return null;
            const sub = result.rows[0];

            const daysRemaining = Math.ceil(parseFloat(sub.days_remaining) || 0);
            const graceDaysRemaining = Math.ceil(parseFloat(sub.grace_days_remaining) || 0);

            let displayStatus = 'active';
            if (sub.status === 'grace') displayStatus = 'grace';
            else if (sub.status === 'expired') displayStatus = 'expired';
            else if (daysRemaining <= 0) displayStatus = 'grace';
            else if (daysRemaining <= 5) displayStatus = 'expiring_soon';
            else if (daysRemaining <= 30) displayStatus = 'expiring';

            return {
                ...sub,
                daysRemaining: Math.max(0, daysRemaining),
                graceDaysRemaining: Math.max(0, graceDaysRemaining),
                displayStatus,
                validUntilFormatted: new Date(sub.valid_until).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric'
                }),
            };
        } catch (error) {
            console.error('❌ Get subscription status error:', error);
            return null;
        }
    }
}

module.exports = new SubscriptionExpiryService();
