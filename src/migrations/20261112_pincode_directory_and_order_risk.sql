-- Pincode reference table (loaded from data.gov.in by scripts/loadPincodeDirectory.js)
-- source = 'datagov' rows are replaced on every reload; source = 'manual' rows are yours
-- (add newly created pincodes here, the loader never touches them).
CREATE TABLE IF NOT EXISTS pincode_directory (
    pincode  CHAR(6)     NOT NULL,
    state    TEXT        NOT NULL,          -- canonical name, same spelling as the storefront state dropdown
    places   TEXT        NOT NULL DEFAULT '', -- normalized districts + post office names, '|' separated
    source   VARCHAR(10) NOT NULL DEFAULT 'datagov',
    PRIMARY KEY (pincode, state)
);
CREATE INDEX IF NOT EXISTS idx_pincode_directory_source ON pincode_directory (source);

-- Risk tagging on orders. Tag only: nothing here blocks or cancels an order.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_status        VARCHAR(20);   -- passed | flagged | not_checked | NULL (never checked)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_flags         JSONB DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_rules_version INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_checked_at    TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_orders_risk_status ON orders (store_id, risk_status);
