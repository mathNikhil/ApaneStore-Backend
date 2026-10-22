-- ─── Abandoned cart recovery ─────────────────────────────────────────────────
-- Run once. Safe to re-run (IF NOT EXISTS / DO NOTHING guards).

-- 1. Last known cart state per customer per store
--    Upserted on every cart change; order_placed=TRUE when order is placed.
CREATE TABLE IF NOT EXISTS customer_carts (
    id               SERIAL PRIMARY KEY,
    store_id         INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_phone   VARCHAR(20) NOT NULL,
    customer_name    VARCHAR(120),
    items            JSONB NOT NULL DEFAULT '[]',
    cart_total       NUMERIC(10,2) DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    order_placed     BOOLEAN NOT NULL DEFAULT FALSE,
    -- reminder tracking (reminder_index = which reminder was last sent, 0-based)
    reminder_index   SMALLINT NOT NULL DEFAULT -1,   -- -1 = none sent yet
    last_reminded_at TIMESTAMPTZ,
    UNIQUE (store_id, customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_customer_carts_store
    ON customer_carts(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_carts_eligible
    ON customer_carts(store_id, order_placed, last_reminded_at)
    WHERE order_placed = FALSE;

-- 2. Queue for all outbound WA messages (cart recovery + overflow from marketing)
--    Processor runs at tenant's configured send_time, respects 75/day cap.
--    priority: 1=cart_recovery, 2=marketing (cart goes first if both are queued)
CREATE TABLE IF NOT EXISTS wa_send_queue (
    id            SERIAL PRIMARY KEY,
    store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    tenant_id     INTEGER NOT NULL,
    type          VARCHAR(20) NOT NULL CHECK (type IN ('cart_recovery', 'marketing')),
    customer_phone VARCHAR(20) NOT NULL,
    customer_name  VARCHAR(120),
    message        TEXT NOT NULL,
    image_url      TEXT,
    priority       SMALLINT NOT NULL DEFAULT 2,   -- 1=cart, 2=marketing
    scheduled_for  TIMESTAMPTZ NOT NULL,           -- when this was queued to send
    sent_at        TIMESTAMPTZ,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    error_msg      TEXT,
    cart_id        INTEGER REFERENCES customer_carts(id) ON DELETE SET NULL,
    reminder_index SMALLINT,                       -- which reminder template was used
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_queue_pending
    ON wa_send_queue(tenant_id, scheduled_for, priority)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wa_queue_store
    ON wa_send_queue(store_id, created_at DESC);

-- 3. Batch run log — one row per store per run
CREATE TABLE IF NOT EXISTS abandoned_cart_batch_log (
    id              SERIAL PRIMARY KEY,
    store_id        INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    ran_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    carts_eligible  INTEGER DEFAULT 0,
    carts_sent      INTEGER DEFAULT 0,
    carts_queued    INTEGER DEFAULT 0,   -- overflowed to next slot
    carts_skipped   INTEGER DEFAULT 0,  -- below min cart value threshold
    daily_limit_hit BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ac_batch_log_store
    ON abandoned_cart_batch_log(store_id, ran_at DESC);

-- 4. Cart recovery settings on stores table
--    Stored as a JSONB column so we can extend without migrations.
--    Shape:
--    {
--      "enabled": true,
--      "send_time": "12:00",          -- HH:MM in store's local time (IST assumed)
--      "min_cart_value": 0,           -- only remind if cart_total >= this
--      "reminders": [
--        { "delay_hours": 24, "message": "Hi {name}, you left {items} in your cart!" },
--        { "delay_hours": 48, "message": "Last chance! Your cart expires soon." }
--      ]
--    }
ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS cart_recovery_config JSONB NOT NULL DEFAULT '{
        "enabled": false,
        "send_time": "12:00",
        "min_cart_value": 0,
        "reminders": [
            {
                "delay_hours": 24,
                "message": "Hi {name}! You left items worth ₹{total} in your cart. Complete your order here: {link}"
            }
        ]
    }'::jsonb;
