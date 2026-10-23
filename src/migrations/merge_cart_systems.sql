-- ─── Merge cart systems: add recovery columns to System A ─────────────────────
-- Run once. Safe to re-run (IF NOT EXISTS / DO NOTHING guards).
--
-- System A (customerCart.controller.js) stores carts by customer_id.
-- We add the columns the recovery job needs so we don't need a separate table.

-- 1. Add customer_id column (System A's key — may already exist from original schema)
ALTER TABLE customer_carts ADD COLUMN IF NOT EXISTS customer_id VARCHAR(50);

-- 2. Add phone/name/total for recovery job
ALTER TABLE customer_carts ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20);
ALTER TABLE customer_carts ADD COLUMN IF NOT EXISTS customer_name  VARCHAR(120);
ALTER TABLE customer_carts ADD COLUMN IF NOT EXISTS cart_total     NUMERIC(10,2) DEFAULT 0;

-- 3. Recovery tracking columns (may already exist from abandoned_cart.sql)
ALTER TABLE customer_carts ADD COLUMN IF NOT EXISTS order_placed     BOOLEAN   NOT NULL DEFAULT FALSE;
ALTER TABLE customer_carts ADD COLUMN IF NOT EXISTS reminder_index   SMALLINT  NOT NULL DEFAULT -1;
ALTER TABLE customer_carts ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

-- 4. Drop old expiry column (no longer needed — we use order_placed instead)
ALTER TABLE customer_carts DROP COLUMN IF EXISTS expires_at;

-- 5. Add UNIQUE constraint on (store_id, customer_id) so upsert works.
--    customer_phone unique constraint from abandoned_cart.sql may conflict —
--    drop it first since customer_id is now the primary upsert key.
ALTER TABLE customer_carts DROP CONSTRAINT IF EXISTS customer_carts_store_id_customer_phone_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_carts_store_id_customer_id_key'
    ) THEN
        ALTER TABLE customer_carts ADD CONSTRAINT customer_carts_store_id_customer_id_key
            UNIQUE (store_id, customer_id);
    END IF;
END $$;

-- 6. Index for recovery job (unchanged from abandoned_cart.sql)
CREATE INDEX IF NOT EXISTS idx_customer_carts_eligible
    ON customer_carts(store_id, order_placed, last_reminded_at)
    WHERE order_placed = FALSE;

CREATE INDEX IF NOT EXISTS idx_customer_carts_store
    ON customer_carts(store_id);
