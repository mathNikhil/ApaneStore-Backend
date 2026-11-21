-- Run ONCE, BEFORE deploying the new storeCleanupService.js.
BEGIN;

ALTER TABLE stores ADD COLUMN IF NOT EXISTS unpublished_at TIMESTAMP;

-- Stamp the time a store goes back to draft; clear it when it leaves draft.
-- Catches every code path: trial job, subscription job, manual unpublish, admin.
CREATE OR REPLACE FUNCTION set_store_unpublished_at() RETURNS trigger AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'draft' AND OLD.status IS DISTINCT FROM 'draft' THEN
            NEW.unpublished_at := NOW();
        ELSIF NEW.status IS DISTINCT FROM 'draft' THEN
            NEW.unpublished_at := NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stores_unpublished_at ON stores;
CREATE TRIGGER trg_stores_unpublished_at
    BEFORE UPDATE OF status ON stores
    FOR EACH ROW EXECUTE FUNCTION set_store_unpublished_at();

-- Backfill: stores that were live before and are draft right now get a fresh
-- full window starting today, so nothing is deleted the night you deploy.
UPDATE stores s SET unpublished_at = NOW()
WHERE s.status = 'draft' AND s.deleted_at IS NULL AND s.unpublished_at IS NULL
  AND (s.published_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM store_subscriptions ss WHERE ss.store_id = s.id));

COMMIT;
