/**
 * Migration: Staff Access Control
 * Adds pin (4-digit login code) and permissions (allowed page keys)
 * to service.staff_members so individual staff can log into the store
 * admin panel with restricted page access.
 *
 * Run: node src/migrations/20261029_staff_access_control.js
 */
const pool = require('../config/database');

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Add 'pin' column — 4-digit numeric string, optional
        await client.query(`
            ALTER TABLE service.staff_members
            ADD COLUMN IF NOT EXISTS pin VARCHAR(4) DEFAULT NULL
        `);

        // 2. Add 'permissions' column — array of page keys staff can access
        //    NULL means no restriction (owner-level). Empty array means no access.
        //    For new staff, default NULL = no portal access yet.
        await client.query(`
            ALTER TABLE service.staff_members
            ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT NULL
        `);

        // 3. Add 'role' column to distinguish owner vs staff sessions
        //    in store_admin_credentials (already exists for owner login)
        //    We need a separate session table for per-staff sessions.
        await client.query(`
            CREATE TABLE IF NOT EXISTS service.staff_sessions (
                id          SERIAL PRIMARY KEY,
                staff_id    INTEGER NOT NULL REFERENCES service.staff_members(id) ON DELETE CASCADE,
                store_id    UUID NOT NULL,
                token       VARCHAR(64) NOT NULL UNIQUE,
                last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_staff_sessions_token
            ON service.staff_sessions(token)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff
            ON service.staff_sessions(staff_id)
        `);

        await client.query('COMMIT');
        console.log('✅ Staff access control migration complete');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
        throw err;
    } finally {
        client.release();
        pool.end();
    }
}

run().catch(process.exit.bind(process, 1));
