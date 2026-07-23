CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(20) UNIQUE NOT NULL,
    company_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    business_type VARCHAR(50),
    subscription_tier VARCHAR(20) DEFAULT 'trial',
    is_verified BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'active',
    store_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id VARCHAR(20) UNIQUE NOT NULL,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    name VARCHAR(100),
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_id, phone)
);

CREATE TABLE otp_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(20) DEFAULT 'login',
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT false,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    refresh_token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id VARCHAR(20) UNIQUE NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    store_name VARCHAR(100) NOT NULL,
    subdomain VARCHAR(50) UNIQUE,
    custom_domain VARCHAR(255),
    status VARCHAR(20) DEFAULT 'draft',
    config JSONB DEFAULT '{}',
    hosting_details JSONB DEFAULT '{}',
    last_deployed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    compare_price DECIMAL(10,2),
    sku VARCHAR(100) UNIQUE,
    category VARCHAR(100),
    images JSONB DEFAULT '[]',
    inventory_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(20) UNIQUE NOT NULL,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    customer_name VARCHAR(100),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    items JSONB NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    payment_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- STORE PERMISSIONS TABLE (Super Admin Controls)
-- ============================================================
CREATE TABLE IF NOT EXISTS store_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    panel_type VARCHAR(50) NOT NULL, -- 'admin', 'production', 'delivery'
    is_enabled BOOLEAN DEFAULT false,
    settings JSONB DEFAULT '{}',
    updated_by UUID REFERENCES tenants(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_id, panel_type)
);

-- ============================================================
-- TENANT STATUS (for Hide/Unhide)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'; -- active, hidden, suspended
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- ============================================================
-- STORE ADDITIONAL FIELDS
-- ============================================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS hosting_details JSONB DEFAULT '{}';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_deployed_at TIMESTAMP;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- ============================================================
-- DEFAULT PERMISSIONS: Admin Panel is enabled for all stores
-- ============================================================
INSERT INTO store_permissions (store_id, panel_type, is_enabled)
SELECT id, 'admin', true FROM stores
ON CONFLICT (store_id, panel_type) DO NOTHING;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_store_permissions_store_id ON store_permissions(store_id);
CREATE INDEX IF NOT EXISTS idx_store_permissions_panel_type ON store_permissions(panel_type);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_email ON tenants(email);
CREATE INDEX idx_tenants_phone ON tenants(phone);
CREATE INDEX idx_stores_tenant_id ON stores(tenant_id);
CREATE INDEX idx_products_store_id ON products(store_id);
CREATE INDEX idx_orders_store_id ON orders(store_id);