-- Create order tracking table
CREATE TABLE IF NOT EXISTS order_tracking (
    id SERIAL PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    
    -- Tracking details
    courier_name TEXT NOT NULL,
    tracking_number TEXT NOT NULL,
    tracking_url TEXT,
    courier_notes TEXT,
    
    -- Auto-updated fields
    last_status TEXT DEFAULT 'pending',
    last_status_message TEXT,
    last_checked TIMESTAMP DEFAULT NOW(),
    status_details JSONB DEFAULT '{"events": []}',
    estimated_delivery DATE,
    
    -- Auto-update settings
    auto_update BOOLEAN DEFAULT TRUE,
    update_frequency INTEGER DEFAULT 60,
    
    -- Metadata
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_order_tracking_order_id ON order_tracking(order_id);
CREATE INDEX idx_order_tracking_store_id ON order_tracking(store_id);
CREATE INDEX idx_order_tracking_tracking_number ON order_tracking(tracking_number);
CREATE INDEX idx_order_tracking_last_status ON order_tracking(last_status);

-- Create tracking history table
CREATE TABLE IF NOT EXISTS tracking_history (
    id SERIAL PRIMARY KEY,
    tracking_id INTEGER REFERENCES order_tracking(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    status_message TEXT,
    location TEXT,
    timestamp TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tracking_history_tracking_id ON tracking_history(tracking_id);