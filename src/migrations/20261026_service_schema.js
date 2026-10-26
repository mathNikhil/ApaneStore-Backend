const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function up() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ─────────────────────────────────────────────────────────
        // 1. Create service schema
        // ─────────────────────────────────────────────────────────
        await client.query(`CREATE SCHEMA IF NOT EXISTS service`);

        // ─────────────────────────────────────────────────────────
        // 2. staff_members
        //    Named staff for a service store.
        //    work_start/end/break/working_days are nullable —
        //    when null, the slot engine inherits store-level config.
        //    premium_percent is added on top of service base price.
        // ─────────────────────────────────────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS service.staff_members (
                id              SERIAL PRIMARY KEY,
                store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
                name            VARCHAR(100) NOT NULL,
                phone           VARCHAR(20),
                avatar_url      TEXT,
                premium_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
                work_start      TIME,
                work_end        TIME,
                break_start     TIME,
                break_end       TIME,
                working_days    TEXT[],
                is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_staff_members_store
            ON service.staff_members(store_id)
        `);

        // ─────────────────────────────────────────────────────────
        // 3. staff_services — expertise mapping
        //    Which staff member is qualified for which service (product).
        //    A staff member with no rows here can do ALL services
        //    (store owner hasn't restricted them yet).
        //    Once at least one row exists for a staff member, only
        //    those products are shown for them.
        // ─────────────────────────────────────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS service.staff_services (
                id          SERIAL PRIMARY KEY,
                staff_id    INT NOT NULL REFERENCES service.staff_members(id) ON DELETE CASCADE,
                product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                UNIQUE(staff_id, product_id)
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_staff_services_staff
            ON service.staff_services(staff_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_staff_services_product
            ON service.staff_services(product_id)
        `);

        // ─────────────────────────────────────────────────────────
        // 4. bookings — replaces public.service_bookings
        //    One row per slot per order item.
        //    staff_id nullable = "any available" (assigned by owner later).
        //    computed_price = base_price + (base_price * premium_percent/100)
        //    at time of booking, so price is locked even if staff premium changes.
        // ─────────────────────────────────────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS service.bookings (
                id               SERIAL PRIMARY KEY,
                store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
                order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
                order_item_id    UUID REFERENCES order_items(id) ON DELETE SET NULL,
                staff_id         INT REFERENCES service.staff_members(id) ON DELETE SET NULL,
                product_id       UUID REFERENCES products(id) ON DELETE SET NULL,

                booking_date     DATE NOT NULL,
                booking_time     TIME NOT NULL,
                duration_mins    INT NOT NULL DEFAULT 60,

                service_type     VARCHAR(20) NOT NULL DEFAULT 'inshop'
                                 CHECK (service_type IN ('inshop', 'homevisit')),
                customer_address TEXT,

                computed_price   DECIMAL(10,2),

                status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled','no_show')),

                notes            TEXT,
                cancellation_reason TEXT,
                cancelled_by     VARCHAR(20) CHECK (cancelled_by IN ('customer','store','system')),

                created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bookings_store
            ON service.bookings(store_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bookings_staff_date
            ON service.bookings(staff_id, booking_date)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bookings_order
            ON service.bookings(order_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bookings_date_store
            ON service.bookings(store_id, booking_date)
        `);

        // ─────────────────────────────────────────────────────────
        // 5. Add duration_mins to products table
        //    Replaces the "60 min" size-field hack.
        //    Only meaningful for service store products.
        // ─────────────────────────────────────────────────────────
        await client.query(`
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS duration_mins INT DEFAULT NULL
        `);

        // ─────────────────────────────────────────────────────────
        // 6. Migrate existing public.service_bookings → service.bookings
        //    Only if the old table exists and has rows.
        // ─────────────────────────────────────────────────────────
        const { rows: oldTableExists } = await client.query(`
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'service_bookings'
            LIMIT 1
        `);

        if (oldTableExists.length > 0) {
            await client.query(`
                INSERT INTO service.bookings
                    (store_id, order_id, booking_date, booking_time, duration_mins, status, created_at, updated_at)
                SELECT
                    store_id, order_id, booking_date, booking_time,
                    COALESCE(duration_mins, 60),
                    COALESCE(status, 'pending'),
                    COALESCE(created_at, NOW()),
                    COALESCE(updated_at, NOW())
                FROM public.service_bookings
                ON CONFLICT DO NOTHING
            `);
            console.log('Migrated rows from public.service_bookings → service.bookings');
        }

        await client.query('COMMIT');
        console.log('✅  Migration 20261026_service_schema complete');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌  Migration failed:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

async function down() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Restore old table from new one before dropping schema
        await client.query(`
            INSERT INTO public.service_bookings
                (store_id, order_id, booking_date, booking_time, duration_mins, status, created_at, updated_at)
            SELECT store_id, order_id, booking_date, booking_time, duration_mins, status, created_at, updated_at
            FROM service.bookings
            ON CONFLICT DO NOTHING
        `).catch(() => console.log('Old table not present, skipping restore'));

        await client.query(`DROP SCHEMA IF EXISTS service CASCADE`);
        await client.query(`ALTER TABLE products DROP COLUMN IF EXISTS duration_mins`);

        await client.query('COMMIT');
        console.log('✅  Rollback 20261026_service_schema complete');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

const command = process.argv[2];
if (command === 'down') {
    down().then(() => process.exit(0)).catch(() => process.exit(1));
} else {
    up().then(() => process.exit(0)).catch(() => process.exit(1));
}
