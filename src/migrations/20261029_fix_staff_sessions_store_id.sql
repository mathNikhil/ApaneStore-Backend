-- Fix staff_sessions.store_id: change from UUID to INTEGER to match stores.id
-- Drop the index first, alter the column, recreate index

DROP INDEX IF EXISTS service.idx_staff_sessions_store;

ALTER TABLE service.staff_sessions
    ALTER COLUMN store_id TYPE INTEGER USING NULL;

-- Clear any existing bad rows (none in production yet since login was failing)
DELETE FROM service.staff_sessions;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_staff_sessions_store ON service.staff_sessions(store_id);
