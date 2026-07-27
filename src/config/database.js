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