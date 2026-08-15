const cron = require('node-cron');
const pool = require('../config/database');

// Runs every hour — checks for expired trial stores and reverts them to draft
cron.schedule('0 * * * *', async () => {
    console.log('🔄 Checking for expired trial stores...');
    try {
        // Find trial subscriptions that have expired
        const expired = await pool.query(`
            SELECT ss.*, s.id as store_db_id, s.store_name, s.tenant_id
            FROM store_subscriptions ss
            JOIN stores s ON s.id = ss.store_id
            WHERE ss.is_trial = true
            AND ss.trial_expires_at < NOW()
            AND ss.payment_status = 'paid'
            AND s.status = 'published'
        `);

        for (const sub of expired.rows) {
            // Revert store to draft — no grace period for trials
            await pool.query(`
                UPDATE stores 
                SET status = 'draft', updated_at = NOW() 
                WHERE id = $1
            `, [sub.store_db_id]);

            // Mark subscription as expired
            await pool.query(`
                UPDATE store_subscriptions 
                SET payment_status = 'expired', updated_at = NOW()
                WHERE store_id = $1 AND is_trial = true
            `, [sub.store_db_id]);

            console.log(`⏰ Trial expired: ${sub.store_name} → draft`);
        }

        if (expired.rows.length === 0) {
            console.log('✅ No expired trials found');
        } else {
            console.log(`✅ ${expired.rows.length} trial(s) expired and reverted to draft`);
        }
    } catch (error) {
        console.error('❌ Trial expiry job error:', error);
    }
});

console.log('🕐 Trial expiry job scheduled (hourly)');
module.exports = cron;
