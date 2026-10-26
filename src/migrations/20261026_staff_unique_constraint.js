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

        // Unique constraint so ON CONFLICT (store_id, name) works in upsert
        await client.query(`
            ALTER TABLE service.staff_members
            ADD CONSTRAINT IF NOT EXISTS uq_staff_store_name UNIQUE (store_id, name)
        `);

        await client.query('COMMIT');
        console.log('✅  Migration 20261026_staff_unique_constraint complete');
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
