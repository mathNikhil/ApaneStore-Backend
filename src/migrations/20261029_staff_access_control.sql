-- Migration: Staff Access Control
-- Run on production: psql $DATABASE_URL -f this_file.sql

-- Add google_email for Google OAuth-based staff login
ALTER TABLE service.staff_members
    ADD COLUMN IF NOT EXISTS google_email TEXT DEFAULT NULL;

-- permissions: JSONB array of {page, access} objects
-- null = no portal access
-- Example: [{"page":"orders","access":"edit"},{"page":"customers","access":"view"}]
ALTER TABLE service.staff_members
    ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL;

-- Staff portal sessions (created after Google OAuth verification)
CREATE TABLE IF NOT EXISTS service.staff_sessions (
    id          SERIAL PRIMARY KEY,
    staff_id    INTEGER NOT NULL REFERENCES service.staff_members(id) ON DELETE CASCADE,
    store_id    UUID NOT NULL,
    token       VARCHAR(64) NOT NULL UNIQUE,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_sessions_token  ON service.staff_sessions(token);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff  ON service.staff_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_store  ON service.staff_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_google_email
    ON service.staff_members(LOWER(google_email))
    WHERE google_email IS NOT NULL;
