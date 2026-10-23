const pool = require('../config/database');

async function up() {
    await pool.query(`
        ALTER TABLE discount_codes
        ADD COLUMN IF NOT EXISTS applicable_to VARCHAR(20) DEFAULT 'both'
        CHECK (applicable_to IN ('dine_in', 'delivery', 'both'));
    `);
    console.log('✓ added applicable_to column to discount_codes');
}

up().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
