/**
 * Migration: 20261027_staff_name_ci_constraint
 *
 * Replaces the plain UNIQUE (store_id, name) constraint on service.staff_members
 * with a case-insensitive functional unique index on (store_id, LOWER(TRIM(name))).
 *
 * Why:
 *   - The existing plain UNIQUE lets "Prakhar" and "prakhar" coexist as two rows
 *   - ON CONFLICT (store_id, LOWER(TRIM(name))) in the sync endpoint needs a
 *     matching functional index to work
 *   - This migration drops the old constraint (if present) and adds the new one
 *
 * Audit-safe: existing rows are not modified or deleted.
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

        // 1. Drop the old plain-name unique constraint if it still exists
        const { rows: oldConstraint } = await client.query(`
            SELECT 1 FROM pg_constraint
            WHERE conname = 'uq_staff_store_name'
              AND conrelid = 'service.staff_members'::regclass
        `);
        if (oldConstraint.length > 0) {
            await client.query(`
                ALTER TABLE service.staff_members
                DROP CONSTRAINT uq_staff_store_name
            `);
            console.log('✅  Dropped old constraint uq_staff_store_name');
        } else {
            console.log('ℹ️   Old constraint uq_staff_store_name not found — skipping drop');
        }

        // 2. Add case-insensitive functional unique index
        //    ON CONFLICT (store_id, LOWER(TRIM(name))) requires an index on that exact expression
        const { rows: idxExists } = await client.query(`
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'service'
              AND tablename  = 'staff_members'
              AND indexname  = 'uq_staff_store_name_ci'
        `);
        if (idxExists.length === 0) {
            await client.query(`
                CREATE UNIQUE INDEX uq_staff_store_name_ci
                ON service.staff_members (store_id, LOWER(TRIM(name)))
            `);
            console.log('✅  Created index uq_staff_store_name_ci');
        } else {
            console.log('ℹ️   Index uq_staff_store_name_ci already exists — skipping');
        }

        await client.query('COMMIT');
        console.log('✅  Migration 20261027_staff_name_ci_constraint complete');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌  Migration failed:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

up().then(() => process.exit(0)).catch(() => process.exit(1));
