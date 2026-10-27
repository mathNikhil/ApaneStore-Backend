/**
 * Migration: add requested_staff_name to service.bookings
 *
 * Problem: when the staff_id lookup fails at order-create time (case mismatch,
 * trim difference, etc.) staff_id is stored as NULL.  The appointments query
 * does a LEFT JOIN on staff_members by id, so it also gets NULL for sm.name.
 * The frontend normalisation can't recover the column assignment because it has
 * no name to work with.
 *
 * Fix: store the raw staffName string the storefront sent in a dedicated text
 * column so it is always available, regardless of whether the id lookup
 * succeeded.  The appointments query then uses COALESCE(sm.name, requested_staff_name)
 * so the scheduler grid can place the booking in the correct column.
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
    process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host:     process.env.DB_HOST     || 'localhost',
            port:     parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME,
            user:     process.env.DB_USER,
            password: process.env.DB_PASSWORD,
          }
);

async function up() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Add the column — safe to run multiple times
        await client.query(`
            ALTER TABLE service.bookings
            ADD COLUMN IF NOT EXISTS requested_staff_name TEXT
        `);

        // Back-fill existing rows: for bookings that have staff_id set,
        // copy the staff member's name so the column is consistent.
        // Rows with staff_id = NULL and no requested_staff_name remain NULL
        // (those were genuinely unassigned or the name was lost).
        await client.query(`
            UPDATE service.bookings b
            SET    requested_staff_name = sm.name
            FROM   service.staff_members sm
            WHERE  b.staff_id = sm.id
              AND  b.requested_staff_name IS NULL
        `);

        await client.query('COMMIT');
        console.log('✅  Migration 20261027_bookings_staff_name complete');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌  Migration failed:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

async function down() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            ALTER TABLE service.bookings
            DROP COLUMN IF EXISTS requested_staff_name
        `);
        await client.query('COMMIT');
        console.log('✅  Rollback 20261027_bookings_staff_name complete');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

const command = process.argv[2];
if (command === 'down') {
    down().then(() => process.exit(0)).catch(() => process.exit(1));
} else {
    up().then(() => process.exit(0)).catch(() => process.exit(1));
}
