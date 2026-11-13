-- Speeds up the 24h repeat-COD lookup that runs on every new order (store_id + recent created_at).
CREATE INDEX IF NOT EXISTS idx_orders_store_created ON orders (store_id, created_at DESC);
