/**
 * DB Migration: Add coupon columns to store_subscriptions & platform_coupons
 * Run with: node scripts/run_migration.js
 */
const pool = require('../src/config/database');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Starting migration...');

    await client.query(`
      ALTER TABLE store_subscriptions
        ADD COLUMN IF NOT EXISTS platform_coupon_code VARCHAR(50),
        ADD COLUMN IF NOT EXISTS platform_coupon_discount NUMERIC(10,2);
    `);
    console.log('✅ store_subscriptions columns added');

    await client.query(`
      ALTER TABLE platform_coupons
        ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;
    `);
    console.log('✅ platform_coupons columns added');

    // Verify
    const res = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name IN ('store_subscriptions', 'platform_coupons')
        AND column_name IN ('platform_coupon_code','platform_coupon_discount','start_at','end_at')
      ORDER BY table_name, column_name;
    `);
    console.log('Verified columns:', res.rows.map(r => r.column_name));
    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

runMigration();
