-- ============================================================
-- AapnaEstore — WhatsApp Market Add-on Plans
-- Migration: 002_create_addon_plans.sql
-- Run after: 001_create_market_tables.sql
-- ============================================================

-- Add-on plans configured by super admin
-- Separate from pricing_plans (store subscriptions)
CREATE TABLE IF NOT EXISTS addon_plans (
  id              SERIAL PRIMARY KEY,
  addon_type      TEXT NOT NULL DEFAULT 'whatsapp_market', -- extensible for future add-ons
  name            TEXT NOT NULL,           -- e.g. "Starter", "Growth"
  description     TEXT,
  price_monthly   INTEGER NOT NULL,        -- in paise (₹99 = 9900)
  price_yearly    INTEGER,                 -- optional yearly discount
  is_active       BOOLEAN DEFAULT true,    -- super admin can disable
  is_recommended  BOOLEAN DEFAULT false,   -- shows "recommended" badge
  sort_order      INTEGER DEFAULT 0,

  -- Feature limits for this plan
  daily_msg_limit    INTEGER DEFAULT 75,
  max_scheduled      INTEGER DEFAULT 10,   -- max scheduled messages at once
  image_retain_days  INTEGER DEFAULT 30,   -- auto-delete images after N days
  gap_seconds_min    INTEGER DEFAULT 2,    -- minimum gap (safety floor)
  allow_waba         BOOLEAN DEFAULT false,-- Phase 2: WABA support

  -- Metadata
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Track which plan each store is on
ALTER TABLE wa_subscriptions
  ADD COLUMN IF NOT EXISTS addon_plan_id INTEGER REFERENCES addon_plans(id),
  ADD COLUMN IF NOT EXISTS plan_name      TEXT,
  ADD COLUMN IF NOT EXISTS price_paid     INTEGER,
  ADD COLUMN IF NOT EXISTS billing_cycle  TEXT DEFAULT 'monthly';

-- Seed default plans (super admin can edit/delete these)
INSERT INTO addon_plans
  (addon_type, name, description, price_monthly, price_yearly,
   is_active, is_recommended, sort_order,
   daily_msg_limit, max_scheduled, image_retain_days, gap_seconds_min, allow_waba)
VALUES
  ('whatsapp_market', 'Starter',
   'Perfect for small stores. Schedule photo messages to up to 75 contacts per day.',
   9900, 99000,
   true, false, 1,
   75, 10, 30, 2, false),

  ('whatsapp_market', 'Growth',
   'More scheduling, longer image storage, and priority support.',
   19900, 199000,
   true, true, 2,
   75, 50, 90, 2, false)

ON CONFLICT DO NOTHING;
