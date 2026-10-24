/**
 * Migration: add get_items column to discount_codes
 *
 * For Buy X Get Y coupons, scope_items = products customer must BUY,
 * get_items = products customer gets FREE. Both are optional; if get_items
 * is empty/null the same products as scope_items are treated as the "get" side.
 */

const pool = require('../config/database');

async function up() {
    await pool.query(`
        ALTER TABLE discount_codes
        ADD COLUMN IF NOT EXISTS get_items JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('✅ Added get_items column to discount_codes');
}

async function down() {
    await pool.query(`
        ALTER TABLE discount_codes
        DROP COLUMN IF EXISTS get_items;
    `);
    console.log('✅ Dropped get_items column from discount_codes');
}

module.exports = { up, down };
