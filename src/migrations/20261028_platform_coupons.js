const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
    const client = await pool.connect();
    try {
        // Platform coupons created by super admin, distributed to tenant stores
        await client.query(`
            CREATE TABLE IF NOT EXISTS platform_coupons (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                name        VARCHAR(255) NOT NULL,
                code        VARCHAR(100) NOT NULL UNIQUE,

                -- Discount
                unit        VARCHAR(30) NOT NULL CHECK (unit IN ('percent', 'flat', 'free_shipping')),
                value       NUMERIC(12,2) DEFAULT 0,

                -- Order constraint
                min_order_value NUMERIC(12,2) DEFAULT 0,

                -- How many stores can claim this coupon (NULL = unlimited)
                max_stores      INTEGER DEFAULT NULL,
                claimed_count   INTEGER DEFAULT 0,

                -- How long the coupon stays valid in the store after being claimed (days)
                validity_days   INTEGER NOT NULL DEFAULT 30,

                -- Max redemptions per store (NULL = unlimited within that store)
                max_uses_per_store INTEGER DEFAULT NULL,

                -- Platform coupon status
                status VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled', 'exhausted')),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tracks which store claimed which platform coupon
        await client.query(`
            CREATE TABLE IF NOT EXISTS platform_coupon_claims (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                coupon_id   UUID NOT NULL REFERENCES platform_coupons(id) ON DELETE CASCADE,
                store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

                -- The discount_codes row created in that store
                discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL,

                claimed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                -- One store can only claim each platform coupon once
                UNIQUE (coupon_id, store_id)
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_platform_coupon_claims_coupon ON platform_coupon_claims(coupon_id);
            CREATE INDEX IF NOT EXISTS idx_platform_coupon_claims_store  ON platform_coupon_claims(store_id);
        `);

        // Auto-update updated_at
        await client.query(`
            CREATE OR REPLACE FUNCTION update_platform_coupons_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_platform_coupons_updated_at ON platform_coupons;
            CREATE TRIGGER trg_platform_coupons_updated_at
            BEFORE UPDATE ON platform_coupons
            FOR EACH ROW EXECUTE FUNCTION update_platform_coupons_updated_at();
        `);

        console.log('✅  platform_coupons + platform_coupon_claims tables created');
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
        await client.query('DROP TABLE IF EXISTS platform_coupon_claims CASCADE;');
        await client.query('DROP TABLE IF EXISTS platform_coupons CASCADE;');
        await client.query('DROP FUNCTION IF EXISTS update_platform_coupons_updated_at CASCADE;');
        console.log('✅  platform_coupons tables dropped');
    } finally {
        client.release();
        await pool.end();
    }
}

up().catch(err => { console.error(err); process.exit(1); });
