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
        console.error('❌ Migration failed:', error.message);
    }
};

// Run migration on startup
runMigration();

module.exports = pool;