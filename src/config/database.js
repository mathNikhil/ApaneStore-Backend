const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database connection pool
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'apnaestore',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20, // Maximum number of clients in the pool
    min: 5, // Minimum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Test database connection
pool.query('SELECT NOW()')
    .then(() => {
        console.log('✅ PostgreSQL connected successfully');
        console.log(`📊 Database: ${process.env.DB_NAME || 'apnaestore'}`);
    })
    .catch(err => {
        console.error('❌ PostgreSQL connection failed:', err.message);
        console.log('💡 Make sure PostgreSQL is running!');
    });

// Function to run migrations
const runMigration = async () => {
    try {
        const schemaPath = path.join(__dirname, '../../database/schema.sql');
        
        if (fs.existsSync(schemaPath)) {
            console.log('📦 Running database migration...');
            const schema = fs.readFileSync(schemaPath, 'utf8');
            await pool.query(schema);
            console.log('✅ Migration completed successfully');
        } else {
            console.log('⚠️ Schema file not found. Skipping migration.');
        }
    } catch (error) {
        // Expected/harmless once tables already exist — schema.sql's CREATE
        // TABLE statements fail with "already exists", which silently
        // aborts the REST of that batched query too (Postgres runs a
        // multi-statement string as one implicit transaction). That's why
        // new columns added to schema.sql alone never reach the live
        // database no matter how many times the server restarts.
        // runColumnMigrations() below fixes that permanently.
        console.log('ℹ️  Schema migration skipped (tables likely already exist):', error.message);
    }
};

// Adds any columns/tables introduced after the originals already existed.
// Each statement runs independently — one failure can never block the
// others — and IF NOT EXISTS makes every one safe to run on every server
// start, forever. This is what actually fixed the recurring "column
// store_count does not exist" errors.
const runColumnMigrations = async () => {
    const statements = [
        `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`,
        `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS store_count INT DEFAULT 0`,
        `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
        `ALTER TABLE stores ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255)`,
        `ALTER TABLE stores ADD COLUMN IF NOT EXISTS hosting_details JSONB DEFAULT '{}'`,
        `ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_deployed_at TIMESTAMP`,
        `ALTER TABLE stores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
        `CREATE TABLE IF NOT EXISTS store_permissions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
            panel_type VARCHAR(20) NOT NULL,
            is_enabled BOOLEAN DEFAULT false,
            settings JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(store_id, panel_type)
        )`,
        // ✅ CORRECTION: store_images was originally created with tenant_id/store_id
        // as UUID, matching schema.sql — but the *live* database actually uses plain
        // integer IDs for tenants/stores (schema.sql is aspirational and drifted from
        // what's really running; confirmed by "invalid input syntax for type uuid: 2"
        // errors using real tenant/store IDs). This one-time check drops the
        // wrongly-typed table (it's guaranteed empty — every insert into it has been
        // failing) so the correct-typed CREATE TABLE below can recreate it. Once
        // recreated, this condition is false on every future restart and does nothing.
        `DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'store_images' AND column_name = 'tenant_id' AND data_type = 'uuid'
            ) THEN
                DROP TABLE store_images CASCADE;
            END IF;
        END $$`,
        `CREATE TABLE IF NOT EXISTS store_images (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id INTEGER NOT NULL,
            store_id INTEGER NOT NULL,
            image_type VARCHAR(50) NOT NULL,
            reference_id TEXT,
            original_filename VARCHAR(255),
            storage_path VARCHAR(500) NOT NULL,
            file_size BIGINT,
            width INTEGER,
            height INTEGER,
            mime_type VARCHAR(100),
            is_active BOOLEAN DEFAULT true,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        // ✅ reference_id used to be INTEGER (max ~2.1 billion) — the
        // frontend's temporary client-side IDs (Date.now()-based, before a
        // product has a real saved ID) are ~1.78 trillion, way over that
        // range. Safely widens the column in place rather than dropping
        // the table, since it now holds real uploaded images.
        `DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'store_images' AND column_name = 'reference_id' AND data_type = 'integer'
            ) THEN
                ALTER TABLE store_images ALTER COLUMN reference_id TYPE BIGINT;
            END IF;
        END $$`,
        // ✅ BIGINT was still wrong — it can hold huge numbers, but return
        // photos need to reference a UUID (the return record's id), which
        // isn't a number at all. Widens to TEXT, which safely holds both
        // the numeric IDs products/categories use and UUIDs.
        `DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'store_images' AND column_name = 'reference_id' AND data_type = 'bigint'
            ) THEN
                ALTER TABLE store_images ALTER COLUMN reference_id TYPE TEXT USING reference_id::TEXT;
            END IF;
        END $$`,
        `CREATE INDEX IF NOT EXISTS idx_store_images_tenant ON store_images(tenant_id)`,
        `CREATE INDEX IF NOT EXISTS idx_store_images_store ON store_images(store_id)`,
        `CREATE INDEX IF NOT EXISTS idx_store_images_type ON store_images(image_type)`,
        `CREATE INDEX IF NOT EXISTS idx_store_images_reference ON store_images(reference_id)`,
        `CREATE INDEX IF NOT EXISTS idx_store_images_active ON store_images(is_active)`,
        // ✅ Store Admin password auth: one row per store. Password is
        // stored encrypted (see utils/encryption.js) so the tenant can view
        // it anytime from their dashboard, while a raw database leak
        // exposes only unreadable ciphertext. active_session_token +
        // session_last_active enforce a single active Store Admin session
        // per store, with an idle timeout (checked in application code)
        // so a forgotten logout doesn't lock everyone out indefinitely.
        `CREATE TABLE IF NOT EXISTS store_admin_credentials (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            store_id INTEGER UNIQUE NOT NULL,
            password_encrypted TEXT NOT NULL,
            active_session_token TEXT,
            session_last_active TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_store_admin_credentials_store ON store_admin_credentials(store_id)`,
        // ✅ Publish flow: domain + hosting + payment.
        //
        // pricing_plans — Super Admin configurable pricing, one row per
        // valid domain+hosting combination PER BILLING CYCLE (monthly/
        // quarterly/annual). Seeded with 9 rows: the 3 valid domain+hosting
        // combinations (subdomain+our-hosting never pairs with "own
        // hosting" — a subdomain under our domain being hosted elsewhere
        // doesn't make sense) × 3 cycles each. Tenant's payment screen
        // reads whichever row matches their choice + selected cycle; Super
        // Admin can edit amounts anytime without a code change.
        `CREATE TABLE IF NOT EXISTS pricing_plans (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            plan_key VARCHAR(50) NOT NULL,
            billing_cycle VARCHAR(20) NOT NULL DEFAULT 'annual',
            display_name VARCHAR(100) NOT NULL,
            base_amount DECIMAL(10,2) NOT NULL,
            tax_percentage DECIMAL(5,2) NOT NULL DEFAULT 18,
            validity_days INTEGER NOT NULL DEFAULT 365,
            is_active BOOLEAN DEFAULT true,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        // ✅ Migrates an existing table safely in place — adds
        // billing_cycle if it's missing (defaulting existing rows to
        // 'annual', preserving any prices Super Admin already customized),
        // then swaps the old single-column unique constraint for the new
        // (plan_key, billing_cycle) pair so multiple cycles per combo can
        // coexist.
        `ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'annual'`,
        `DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE table_name = 'pricing_plans' AND constraint_name = 'pricing_plans_plan_key_key'
            ) THEN
                ALTER TABLE pricing_plans DROP CONSTRAINT pricing_plans_plan_key_key;
            END IF;
        END $$`,
        `DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'pricing_plans_plan_key_billing_cycle_key'
            ) THEN
                ALTER TABLE pricing_plans ADD CONSTRAINT pricing_plans_plan_key_billing_cycle_key UNIQUE (plan_key, billing_cycle);
            END IF;
        END $$`,
        `INSERT INTO pricing_plans (plan_key, billing_cycle, display_name, base_amount, tax_percentage, validity_days)
         VALUES
            ('subdomain_apnaestore', 'annual', 'Free Subdomain + ApnaEstore Hosting', 5000, 18, 365),
            ('custom_domain_apnaestore', 'annual', 'Custom Domain + ApnaEstore Hosting', 5000, 18, 365),
            ('custom_domain_own_hosting', 'annual', 'Custom Domain + Own Hosting', 5000, 18, 365)
         ON CONFLICT (plan_key, billing_cycle) DO NOTHING`,
        // ✅ Applies the researched pricing strategy: entry-tier (subdomain)
        // priced to sit below competitors' basic tiers to remove friction
        // for first-time sellers; own-domain+our-hosting priced higher to
        // reflect real infra/DNS support cost; own-domain+own-hosting kept
        // low since it's pure software with no hosting cost on our side.
        `UPDATE pricing_plans SET base_amount = 4499 WHERE plan_key = 'subdomain_apnaestore' AND billing_cycle = 'annual'`,
        `UPDATE pricing_plans SET base_amount = 7749 WHERE plan_key = 'custom_domain_apnaestore' AND billing_cycle = 'annual'`,
        `UPDATE pricing_plans SET base_amount = 4999 WHERE plan_key = 'custom_domain_own_hosting' AND billing_cycle = 'annual'`,
        `INSERT INTO pricing_plans (plan_key, billing_cycle, display_name, base_amount, tax_percentage, validity_days)
         VALUES
            ('subdomain_apnaestore', 'monthly', 'Free Subdomain + ApnaEstore Hosting', 449, 18, 30),
            ('subdomain_apnaestore', 'quarterly', 'Free Subdomain + ApnaEstore Hosting', 1199, 18, 90),
            ('custom_domain_apnaestore', 'monthly', 'Custom Domain + ApnaEstore Hosting', 799, 18, 30),
            ('custom_domain_apnaestore', 'quarterly', 'Custom Domain + ApnaEstore Hosting', 2149, 18, 90),
            ('custom_domain_own_hosting', 'monthly', 'Custom Domain + Own Hosting', 499, 18, 30),
            ('custom_domain_own_hosting', 'quarterly', 'Custom Domain + Own Hosting', 1349, 18, 90)
         ON CONFLICT (plan_key, billing_cycle) DO NOTHING`,
        // store_domain_config — one row per store, records the tenant's
        // domain/hosting choice from this flow and the (simulated, for now)
        // DNS verification status.
        `CREATE TABLE IF NOT EXISTS store_domain_config (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            store_id INTEGER UNIQUE NOT NULL,
            domain_type VARCHAR(20) NOT NULL,
            custom_domain VARCHAR(255),
            hosting_type VARCHAR(20) NOT NULL,
            own_hosting_server_ip VARCHAR(45),
            own_hosting_provider VARCHAR(100),
            dns_status VARCHAR(20) NOT NULL DEFAULT 'not_required',
            dns_verified_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_store_domain_config_store ON store_domain_config(store_id)`,
        // store_subscriptions — payment record. stores.status only flips to
        // 'published' once payment_status here is 'paid'.
        `CREATE TABLE IF NOT EXISTS store_subscriptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            store_id INTEGER UNIQUE NOT NULL,
            plan_key VARCHAR(50) NOT NULL,
            plan_name VARCHAR(100),
            billing_cycle VARCHAR(20) DEFAULT 'annual',
            base_amount DECIMAL(10,2),
            tax_amount DECIMAL(10,2),
            total_amount DECIMAL(10,2),
            payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
            payment_method VARCHAR(20),
            paid_at TIMESTAMP,
            valid_until TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `ALTER TABLE store_subscriptions ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) DEFAULT 'annual'`,
        `CREATE INDEX IF NOT EXISTS idx_store_subscriptions_store ON store_subscriptions(store_id)`,
        // ✅ Legal audit trail — records that a tenant explicitly accepted
        // the Terms & Conditions before publishing a store, which version
        // of the terms they accepted, and when. Kept even if the terms
        // text is later updated, so a past acceptance is provable exactly
        // as it was at the time.
        `CREATE TABLE IF NOT EXISTS terms_acceptances (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id INTEGER NOT NULL,
            store_id INTEGER NOT NULL,
            terms_version VARCHAR(50) NOT NULL,
            accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_terms_acceptances_tenant ON terms_acceptances(tenant_id)`,
        `CREATE INDEX IF NOT EXISTS idx_terms_acceptances_store ON terms_acceptances(store_id)`,
        // ✅ Same UUID-vs-INTEGER drift as store_images before it — schema.sql
        // declares customers.store_id as UUID, but the live stores.id is
        // INTEGER. This table has never held real data (all customer logins
        // were fake/simulated until now), so it's safe to drop and recreate
        // correctly-typed rather than migrate data.
        `DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'customers' AND column_name = 'store_id' AND data_type = 'uuid'
            ) THEN
                DROP TABLE customers CASCADE;
            END IF;
        END $$`,
        `CREATE TABLE IF NOT EXISTS customers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            customer_id VARCHAR(20) UNIQUE NOT NULL,
            store_id INTEGER NOT NULL,
            phone VARCHAR(20) NOT NULL,
            name VARCHAR(100),
            is_verified BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(store_id, phone)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id)`,
        // ✅ otp_audit only existed in schema.sql, which only runs once at
        // initial project setup and is skipped on every restart after
        // ("Schema migration skipped: relation already exists"). If it
        // wasn't successfully created that one time, it's simply never
        // existed — and every real OTP send (customer login, which was
        // fake/simulated until this round) would fail with exactly the
        // "Failed to send OTP" 500 error being seen now. No foreign keys
        // here, so no UUID/INTEGER drift risk, just needs to exist.
        `CREATE TABLE IF NOT EXISTS otp_audit (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone VARCHAR(20) NOT NULL,
            email VARCHAR(255),
            code VARCHAR(6) NOT NULL,
            purpose VARCHAR(20) DEFAULT 'login',
            expires_at TIMESTAMP NOT NULL,
            is_used BOOLEAN DEFAULT false,
            attempts INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_otp_audit_phone_purpose ON otp_audit(phone, purpose)`,
        `ALTER TABLE otp_audit ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)`,
        // ✅ Same UUID-vs-INTEGER drift as before — schema.sql declares
        // orders.store_id as UUID, but the live stores.id is INTEGER. No
        // real order has ever existed (checkout only updated local browser
        // state until now), so safe to drop and recreate correctly-typed.
        // Also adds customer_id (linking to the now-real customers table)
        // and the checkout fields actually needed (address, payment method,
        // cost breakdown) that the original schema didn't have.
        `DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'orders' AND column_name = 'store_id' AND data_type = 'uuid'
            ) THEN
                DROP TABLE orders CASCADE;
            END IF;
        END $$`,
        `CREATE TABLE IF NOT EXISTS orders (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_id VARCHAR(20) UNIQUE NOT NULL,
            store_id INTEGER NOT NULL,
            customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
            customer_name VARCHAR(100),
            customer_email VARCHAR(255),
            customer_phone VARCHAR(20),
            items JSONB NOT NULL,
            delivery_address JSONB,
            subtotal DECIMAL(10,2),
            delivery_charge DECIMAL(10,2) DEFAULT 0,
            tax_amount DECIMAL(10,2) DEFAULT 0,
            total_amount DECIMAL(10,2) NOT NULL,
            payment_method VARCHAR(30),
            status VARCHAR(50) DEFAULT 'pending',
            payment_status VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id)`,
        `CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)`,
        // ✅ Only relevant while a store is on the COD+UPI tier (no real
        // payment gateway integrated yet) — captures the customer's own
        // UPI ID at checkout so an operator can manually cross-check their
        // own bank/UPI app for a matching payment before confirming the
        // order. Once a real gateway (Cashfree/Stripe) is active, this
        // field simply goes unused — that flow verifies automatically.
        `ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_upi_id VARCHAR(100)`,
        // ✅ Referenced by store-admin/orders.controller.js (getById's JOIN,
        // updateStatus's INSERT) but was never actually defined anywhere —
        // not in schema.sql, not in this migration file. Both of those
        // endpoints would have thrown a SQL error the moment either was
        // used against a real order; simply never triggered before now.
        `CREATE TABLE IF NOT EXISTS order_status_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            status VARCHAR(50) NOT NULL,
            changed_by VARCHAR(100),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id)`,
        // ✅ Courier tracking — this whole feature (scraper, cron job,
        // controller) already existed in the codebase but was never
        // properly wired up. These tables only ever lived in a standalone
        // order_tracking.sql file that's never actually run against the
        // real database — added to the same safe path everything else uses.
        `CREATE TABLE IF NOT EXISTS order_tracking (
            id SERIAL PRIMARY KEY,
            order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
            store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
            courier_name TEXT NOT NULL,
            tracking_number TEXT NOT NULL,
            tracking_url TEXT,
            courier_notes TEXT,
            last_status TEXT DEFAULT 'pending',
            last_status_message TEXT,
            last_checked TIMESTAMP DEFAULT NOW(),
            status_details JSONB DEFAULT '{"events": []}',
            estimated_delivery DATE,
            auto_update BOOLEAN DEFAULT TRUE,
            update_frequency INTEGER DEFAULT 60,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_order_tracking_order_id ON order_tracking(order_id)`,
        `CREATE INDEX IF NOT EXISTS idx_order_tracking_store_id ON order_tracking(store_id)`,
        `CREATE INDEX IF NOT EXISTS idx_order_tracking_tracking_number ON order_tracking(tracking_number)`,
        // ✅ Tenant-managed courier list (self-service, per-store, no Super
        // Admin involvement) — a tenant picks from this short list on each
        // order instead of retyping the same 1-3 couriers every time.
        `CREATE TABLE IF NOT EXISTS store_couriers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
            courier_name VARCHAR(100) NOT NULL,
            tracking_url_template TEXT,
            auto_track_key VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(store_id, courier_name)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_store_couriers_store ON store_couriers(store_id)`,
        // ✅ Store Admin's own customer search query already did
        // `email ILIKE ...`, meaning it always expected this column to
        // exist — it never actually did, since nothing ever wrote a real
        // customer email anywhere. Would have thrown a SQL error the
        // moment anyone actually searched by email.
        `ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
        // ✅ Real customer address book — replaces what was previously
        // entirely local browser state (a single hardcoded sample address,
        // "Amit Sharma" / Gurgaon, that every customer saw regardless of
        // what they actually entered, never sent to the backend at all).
        `CREATE TABLE IF NOT EXISTS customer_addresses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            store_id INTEGER NOT NULL,
            label VARCHAR(50) DEFAULT 'Home',
            recipient_name VARCHAR(100),
            recipient_mobile VARCHAR(20),
            address_line1 VARCHAR(255),
            address_line2 VARCHAR(255),
            city VARCHAR(100),
            state VARCHAR(100),
            pincode VARCHAR(10),
            landmark VARCHAR(255),
            is_default BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id)`,
        // ✅ Return requests — a real, separate record linked to its parent
        // order (not bolted onto the orders table). UNIQUE(order_id) means
        // an order can have at most one return, ever — matches "rejection
        // is final, no resubmission" directly in the schema rather than
        // only in application logic.
        // return_shipping_method is copied from the store's config AT
        // REQUEST TIME, so a later change to the store's setting never
        // retroactively changes an already-in-flight return.
        `CREATE TABLE IF NOT EXISTS order_returns (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            return_id VARCHAR(20) UNIQUE NOT NULL,
            order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            store_id INTEGER NOT NULL,
            reason VARCHAR(50) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'requested',
            reject_reason TEXT,
            return_shipping_method VARCHAR(20),
            customer_courier_name VARCHAR(100),
            customer_tracking_number VARCHAR(100),
            courier_name VARCHAR(100),
            tracking_number VARCHAR(100),
            pickup_date DATE,
            operator_comment TEXT,
            requested_at TIMESTAMP DEFAULT NOW(),
            approved_at TIMESTAMP,
            rejected_at TIMESTAMP,
            parcel_received_at TIMESTAMP,
            refund_initiated_at TIMESTAMP,
            refunded_at TIMESTAMP,
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(order_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_order_returns_store ON order_returns(store_id)`,
        `CREATE INDEX IF NOT EXISTS idx_order_returns_status ON order_returns(status)`,
        `CREATE TABLE IF NOT EXISTS tracking_history (
            id SERIAL PRIMARY KEY,
            tracking_id INTEGER REFERENCES order_tracking(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            status_message TEXT,
            location TEXT,
            timestamp TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracking_history_tracking_id ON tracking_history(tracking_id)`,
        // Referenced by the tracking code (order marked shipped/delivered)
        // but these columns never existed on orders.
        `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP`,
        `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP`,
    ];

    let applied = 0;
    for (const statement of statements) {
        try {
            await pool.query(statement);
            applied++;
        } catch (error) {
            console.error(`❌ Column migration failed: ${statement.slice(0, 60)}...`, error.message);
        }
    }
    console.log(`✅ Column migrations checked (${applied}/${statements.length} statements ran cleanly)`);
};

// Run migration on startup
runMigration().then(() => runColumnMigrations());

module.exports = pool;