-- ============================================================
-- AapnaEstore — WhatsApp Market Feature
-- Migration: 001_create_market_tables.sql
-- Run on: psql -U apnaestore_app -d apnaestore -f this_file.sql
-- ============================================================

-- WhatsApp config per store (personal OR waba, not both active)
CREATE TABLE IF NOT EXISTS wa_config (
  id               SERIAL PRIMARY KEY,
  store_id         INTEGER REFERENCES stores(id) ON DELETE CASCADE UNIQUE,
  mode             TEXT NOT NULL DEFAULT 'personal', -- 'personal' | 'waba'
  is_active        BOOLEAN DEFAULT false,
  -- personal session
  session_exists   BOOLEAN DEFAULT false,
  session_phone    TEXT,
  -- waba credentials
  waba_id          TEXT,
  phone_number_id  TEXT,
  access_token     TEXT,          -- store encrypted in production
  display_name     TEXT,
  template_name    TEXT,
  template_lang    TEXT DEFAULT 'en_IN',
  environment      TEXT DEFAULT 'sandbox', -- 'sandbox' | 'production'
  webhook_token    TEXT,
  -- gap setting (personal only)
  gap_seconds      INTEGER DEFAULT 2,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Groups per store
CREATE TABLE IF NOT EXISTS wa_groups (
  id         SERIAL PRIMARY KEY,
  store_id   INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contacts per store
CREATE TABLE IF NOT EXISTS wa_contacts (
  id         SERIAL PRIMARY KEY,
  store_id   INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,   -- with country code, digits only: 919876543210
  group_id   INTEGER REFERENCES wa_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled messages
CREATE TABLE IF NOT EXISTS wa_messages (
  id           SERIAL PRIMARY KEY,
  store_id     INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL,               -- 'personal' | 'waba'
  recipients   JSONB NOT NULL,              -- [{type:'group'|'contact', id, label, count}]
  media_url    TEXT,                        -- public HTTPS URL of uploaded image
  caption      TEXT,                        -- personal: free text | waba: JSON of template vars
  scheduled_at TIMESTAMPTZ NOT NULL,
  repeat_type  TEXT DEFAULT 'none',         -- 'none' | 'weekly' | 'monthly'
  status       TEXT DEFAULT 'scheduled',    -- 'scheduled'|'sending'|'sent'|'failed'|'draft'
  total_recipients INTEGER DEFAULT 0,       -- expanded count at schedule time
  sent_count   INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  error_text   TEXT,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Per-message per-recipient log (for retry and audit)
CREATE TABLE IF NOT EXISTS wa_send_log (
  id         SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES wa_messages(id) ON DELETE CASCADE,
  store_id   INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  status     TEXT NOT NULL,  -- 'sent' | 'failed'
  error      TEXT,
  sent_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Daily usage counter (resets midnight)
CREATE TABLE IF NOT EXISTS wa_daily_usage (
  id         SERIAL PRIMARY KEY,
  store_id   INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  sent_count INTEGER DEFAULT 0,
  UNIQUE(store_id, date)
);

-- Premium subscription for Market feature
CREATE TABLE IF NOT EXISTS wa_subscriptions (
  id           SERIAL PRIMARY KEY,
  store_id     INTEGER REFERENCES stores(id) ON DELETE CASCADE UNIQUE,
  is_active    BOOLEAN DEFAULT false,
  plan         TEXT DEFAULT 'personal',   -- 'personal' | 'waba'
  activated_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wa_messages_store_status ON wa_messages(store_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_messages_scheduled    ON wa_messages(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_wa_contacts_store        ON wa_contacts(store_id);
CREATE INDEX IF NOT EXISTS idx_wa_send_log_message      ON wa_send_log(message_id);
CREATE INDEX IF NOT EXISTS idx_wa_daily_usage_store     ON wa_daily_usage(store_id, date);
