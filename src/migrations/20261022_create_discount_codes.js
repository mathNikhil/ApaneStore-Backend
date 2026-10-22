const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function up() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS discount_codes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

                name VARCHAR(255) NOT NULL,
                type VARCHAR(20) NOT NULL CHECK (type IN ('coupon', 'promo')),

                -- Code: auto-generated for coupons, same as name for promos
                code VARCHAR(100) NOT NULL,

                -- Discount unit and value
                unit VARCHAR(30) NOT NULL CHECK (unit IN ('percent', 'flat', 'free_shipping', 'buy_x_get_y')),
                value NUMERIC(12,2) DEFAULT 0,

                -- Buy X Get Y config (stored as JSON)
                buy_x_get_y JSONB DEFAULT NULL,

                -- Order limit (minimum order value to use)
                min_order_value NUMERIC(12,2) DEFAULT 0,

                -- Usage cap (NULL = unlimited)
                max_uses INTEGER DEFAULT NULL,
                current_uses INTEGER DEFAULT 0,

                -- Scope
                scope VARCHAR(20) NOT NULL DEFAULT 'full_store' CHECK (scope IN ('full_store', 'product', 'category')),
                -- JSON array of product_ids or category_ids
                scope_items JSONB DEFAULT '[]',

                -- Validity window
                start_at TIMESTAMP WITH TIME ZONE NOT NULL,
                end_at   TIMESTAMP WITH TIME ZONE NOT NULL,

                -- Status: derived via trigger / cron, but also manually settable
                status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'expired', 'disabled')),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                -- Two stores can use the same code independently
                UNIQUE (store_id, code)
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_discount_codes_store ON discount_codes(store_id);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_discount_codes_status ON discount_codes(store_id, status);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(store_id, code);
        `);

        // Auto-update updated_at on every row change
        await client.query(`
            CREATE OR REPLACE FUNCTION update_discount_codes_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        await client.query(`
            DROP TRIGGER IF EXISTS trg_discount_codes_updated_at ON discount_codes;
            CREATE TRIGGER trg_discount_codes_updated_at
            BEFORE UPDATE ON discount_codes
            FOR EACH ROW EXECUTE FUNCTION update_discount_codes_updated_at();
        `);

        console.log('✅  discount_codes table created');
    } catch (err) {
        console.error('Migration failed:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

async function down() {
    const client = await pool.connect();
    try {
        await client.query('DROP TABLE IF EXISTS discount_codes CASCADE;');
        await client.query('DROP FUNCTION IF EXISTS update_discount_codes_updated_at CASCADE;');
        console.log('✅  discount_codes table dropped');
    } finally {
        client.release();
        await pool.end();
    }
}

up().catch(err => { console.error(err); process.exit(1); });
