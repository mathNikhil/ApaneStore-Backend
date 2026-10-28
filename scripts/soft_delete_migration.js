/**
 * Migration: Add soft delete support to tenants table
 * Adds deleted_at TIMESTAMPTZ column
 * Run once: node scripts/soft_delete_migration.js
 */
const pool = require('../src/config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running soft delete migration...');

    await client.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL
    `);
    console.log('✅ Added deleted_at column to tenants');

    // Create index for fast filtering of live tenants
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at
      ON tenants (deleted_at)
      WHERE deleted_at IS NULL
    `);
    console.log('✅ Created partial index on tenants(deleted_at)');

    console.log('Migration complete!');
  } catch (e) {
    console.error('Migration failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
