-- Add columns for store cleanup tracking
ALTER TABLE stores 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS auto_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS expiry_warning_sent BOOLEAN DEFAULT FALSE;

-- Add index for cleanup queries
CREATE INDEX idx_stores_draft_cleanup ON stores(status, created_at) 
WHERE status = 'draft' AND deleted_at IS NULL;