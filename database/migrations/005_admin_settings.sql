-- Admin settings table for configurable values
CREATE TABLE IF NOT EXISTS admin_settings (
    id SERIAL PRIMARY KEY,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by UUID REFERENCES tenants(id)
);

-- Insert default draft store expiry setting
INSERT INTO admin_settings (setting_key, setting_value, description)
VALUES ('draft_store_expiry_days', '120', 'Number of days draft stores can exist before auto-deletion')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = '120';