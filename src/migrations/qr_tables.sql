-- ============================================================
-- QR Scanner Feature — Database Migration
-- Run once on production DB
-- ============================================================

-- 1. QR service subscriptions per store
CREATE TABLE IF NOT EXISTS qr_service_subscriptions (
  id                SERIAL PRIMARY KEY,
  store_id          VARCHAR(64)    NOT NULL,
  tenant_id         INTEGER        NOT NULL REFERENCES tenants(id),
  activated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ    NOT NULL,
  days_charged      INTEGER        NOT NULL,
  amount_charged    NUMERIC(10,2)  NOT NULL DEFAULT 0,
  gst_charged       NUMERIC(10,2)  NOT NULL DEFAULT 0,
  payment_ref       VARCHAR(128),
  cashfree_order_id VARCHAR(128),
  status            VARCHAR(16)    NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','expired','cancelled')),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_subs_store   ON qr_service_subscriptions(store_id);
CREATE INDEX IF NOT EXISTS idx_qr_subs_status  ON qr_service_subscriptions(store_id, status);
CREATE INDEX IF NOT EXISTS idx_qr_subs_expires ON qr_service_subscriptions(expires_at, status);

-- 2. QR pricing config (super admin controlled)
CREATE TABLE IF NOT EXISTS qr_pricing_config (
  id                SERIAL PRIMARY KEY,
  annual_price      NUMERIC(10,2)  NOT NULL DEFAULT 6000.00,
  gst_rate_percent  NUMERIC(5,2)   NOT NULL DEFAULT 18.00,
  currency          VARCHAR(8)     NOT NULL DEFAULT 'INR',
  is_active         BOOLEAN        NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Seed default pricing (only if table is empty)
INSERT INTO qr_pricing_config (annual_price, gst_rate_percent)
SELECT 6000.00, 18.00
WHERE NOT EXISTS (SELECT 1 FROM qr_pricing_config);

-- 3. Ensure pending_payments table exists with required columns
--    (may already exist from addon/plan payment flows — IF NOT EXISTS is safe)
CREATE TABLE IF NOT EXISTS pending_payments (
  id            SERIAL PRIMARY KEY,
  order_id      VARCHAR(128)   NOT NULL UNIQUE,
  tenant_id     INTEGER        REFERENCES tenants(id),
  store_id      VARCHAR(64),
  amount        NUMERIC(10,2)  NOT NULL DEFAULT 0,
  payment_type  VARCHAR(64)    NOT NULL DEFAULT 'plan',
  meta          JSONB,
  status        VARCHAR(32)    NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Add columns if table already existed without them
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(64) NOT NULL DEFAULT 'plan';
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS store_id     VARCHAR(64);
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS meta         JSONB;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS amount       NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 4. Extend orders table for walk-in customer capture
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS walk_in_customer_name   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS walk_in_customer_mobile VARCHAR(15),
  ADD COLUMN IF NOT EXISTS is_scan_order           BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- ROLLBACK (keep for reference, do not run unless reverting)
-- ============================================================
-- DROP TABLE IF EXISTS qr_service_subscriptions;
-- DROP TABLE IF EXISTS qr_pricing_config;
-- ALTER TABLE orders DROP COLUMN IF EXISTS walk_in_customer_name;
-- ALTER TABLE orders DROP COLUMN IF EXISTS walk_in_customer_mobile;
-- ALTER TABLE orders DROP COLUMN IF EXISTS is_scan_order;
