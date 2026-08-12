-- ============================================================
-- EXTENSIBLE PAYMENT GATEWAY SCHEMA
-- Replaces the flat cashfree_merchant_id / stripe_account_id columns
-- from the earlier migration — those don't scale past 2-3 gateways.
-- This design lets you add gateway #4, #5, etc. with an INSERT,
-- never another ALTER TABLE.
-- ============================================================

-- If the earlier flat-column migration was already run, undo it —
-- safe no-ops if it wasn't.
ALTER TABLE stores DROP COLUMN IF EXISTS payment_gateway;
ALTER TABLE stores DROP COLUMN IF EXISTS cashfree_merchant_id;
ALTER TABLE stores DROP COLUMN IF EXISTS cashfree_kyc_status;
ALTER TABLE stores DROP COLUMN IF EXISTS cashfree_kyc_details;
ALTER TABLE stores DROP COLUMN IF EXISTS stripe_account_id;
ALTER TABLE stores DROP COLUMN IF EXISTS stripe_onboarding_status;


-- 1. MASTER LIST OF SUPPORTED GATEWAYS
-- Adding a new gateway later = one INSERT here. No app-wide schema change.
CREATE TABLE IF NOT EXISTS payment_gateways (
    id SERIAL PRIMARY KEY,
    gateway_key VARCHAR(50) UNIQUE NOT NULL,   -- 'upi' | 'cashfree' | 'stripe' | future: 'razorpay', 'paypal'...
    display_name VARCHAR(100) NOT NULL,
    requires_kyc BOOLEAN DEFAULT false,        -- UPI = false (just an ID string), Cashfree/Stripe = true
    is_active BOOLEAN DEFAULT true,            -- lets you disable a gateway platform-wide without deleting history
    phase VARCHAR(20),                         -- your own roadmap tag: 'phase1' | 'phase2' | 'phase3'
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO payment_gateways (gateway_key, display_name, requires_kyc, phase)
VALUES
    ('upi', 'UPI QR Code', false, 'phase1'),
    ('cashfree', 'Cashfree', true, 'phase2'),
    ('stripe', 'Stripe Connect', true, 'phase3')
ON CONFLICT (gateway_key) DO NOTHING;


-- 2. PER-STORE GATEWAY ACCOUNTS
-- One row per (store, gateway) pair. A store CAN have multiple gateways
-- configured at once (e.g. both UPI and Cashfree active) — each tracked
-- independently. This is where the "store, not tenant" linkage lives,
-- explicitly, via store_id.
CREATE TABLE IF NOT EXISTS store_payment_gateway_accounts (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    gateway_id INTEGER NOT NULL REFERENCES payment_gateways(id),

    -- One shared column for "the ID that identifies THIS store's account
    -- on THIS gateway" — merchant_id (Cashfree), account_id (Stripe),
    -- upi_id (UPI). Works for any future gateway without new columns.
    account_identifier VARCHAR(255),

    kyc_status VARCHAR(50) DEFAULT 'not_required',
    -- 'not_required' (UPI, always) | 'not_started' | 'pending' | 'approved' | 'rejected'

    -- Flexible bucket for anything gateway-specific: bank details, business
    -- name, UPI app name, extra onboarding fields — future-proofs against
    -- gateways needing different extra data without more ALTER TABLEs.
    gateway_details JSONB,

    is_enabled BOOLEAN DEFAULT true,   -- tenant's own toggle for this gateway
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(store_id, gateway_id)  -- one config per store per gateway, no duplicates
);

CREATE INDEX IF NOT EXISTS idx_store_payment_gateway_accounts_store
    ON store_payment_gateway_accounts(store_id);


-- 3. WHICH GATEWAY IS DEFAULT/PRE-SELECTED AT CHECKOUT
ALTER TABLE stores ADD COLUMN IF NOT EXISTS default_payment_gateway_id
    INTEGER REFERENCES payment_gateways(id);


-- 4. ORDERS — trace each order back to exactly which store-gateway-account
-- actually processed it. Assumes `orders` already has store_id and
-- customer_id columns from your existing checkout flow — this only adds
-- the payment-gateway trace.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_payment_gateway_account_id
    INTEGER REFERENCES store_payment_gateway_accounts(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_transaction_id VARCHAR(255);
