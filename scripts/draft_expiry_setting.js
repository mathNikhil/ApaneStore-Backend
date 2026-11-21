/**
 * Show or set the draft-store auto-delete window (admin_settings.draft_store_expiry_days).
 *   node scripts/draft_expiry_setting.js        -> shows current value
 *   node scripts/draft_expiry_setting.js 120    -> sets it to 120
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');

(async () => {
    const db = new Client({
        host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    });
    await db.connect();
    try {
        const arg = process.argv[2];
        const cur = await db.query(
            `SELECT setting_value, updated_by, updated_at FROM admin_settings WHERE setting_key = 'draft_store_expiry_days'`);
        console.log('Current setting:', cur.rows[0] || '(no row — code default of 120 applies)');

        if (arg !== undefined) {
            const days = parseInt(arg, 10);
            if (!Number.isFinite(days) || days < 1 || days > 3650) throw new Error('Give a number of days between 1 and 3650');
            await db.query(
                `INSERT INTO admin_settings (setting_key, setting_value, updated_at)
                 VALUES ('draft_store_expiry_days', $1, NOW())
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1, updated_at = NOW()`, [String(days)]);
            console.log(`✅ Set to ${days} days`);
        }
    } catch (e) { console.error('❌', e.message); process.exitCode = 1; }
    finally { await db.end(); }
})();
