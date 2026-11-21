/**
 * Adds stores.unpublished_at + trigger + backfill, using the app's own DB
 * connection (.env). Safe to re-run. Run ONCE, BEFORE restarting the backend
 * with the new storeCleanupService.js:
 *
 *   cd /home/ubuntu/apps/ApaneStore-Backend && node scripts/unpublished_at_migration.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');

// Own connection on purpose: requiring src/config/database.js would also kick
// off the app's 91 startup column-migrations inside this script.
const pool = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

(async () => {
    await pool.connect();
    const sql = fs.readFileSync(path.join(__dirname, 'unpublished_at_migration.sql'), 'utf8');
    try {
        const before = await pool.query(
            `SELECT COUNT(*)::int AS n FROM stores WHERE status = 'draft' AND deleted_at IS NULL`);
        console.log(`Draft stores before migration: ${before.rows[0].n}`);

        await pool.query(sql); // file contains its own BEGIN ... COMMIT

        const col = await pool.query(
            `SELECT 1 FROM information_schema.columns WHERE table_name='stores' AND column_name='unpublished_at'`);
        const trg = await pool.query(
            `SELECT 1 FROM pg_trigger WHERE tgname='trg_stores_unpublished_at'`);
        const stamped = await pool.query(
            `SELECT COUNT(*)::int AS n FROM stores WHERE unpublished_at IS NOT NULL`);

        console.log(`Column unpublished_at exists:  ${col.rowCount === 1}`);
        console.log(`Trigger installed:             ${trg.rowCount === 1}`);
        console.log(`Stores given a fresh 120-day window: ${stamped.rows[0].n}`);
        if (col.rowCount !== 1 || trg.rowCount !== 1) throw new Error('Verification failed');
        console.log('✅ Migration complete. Now restart: pm2 restart apnaestore-backend');
    } catch (e) {
        console.error('❌ Migration failed (transaction rolled back):', e.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
