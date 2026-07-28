CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    store_id TEXT UNIQUE NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_name TEXT NOT NULL,
    subdomain TEXT UNIQUE,
    config JSONB DEFAULT '{}',
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    published_at TIMESTAMP  -- ✅ Add this column
);

CREATE INDEX idx_stores_tenant_id ON stores(tenant_id);
CREATE INDEX idx_stores_status ON stores(status);
CREATE INDEX idx_stores_store_id ON stores(store_id);
CREATE INDEX idx_stores_subdomain ON stores(subdomain);