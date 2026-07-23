const pool = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function migrate() {
    try {
        console.log('📦 Starting database migration...');

        const schemaPath = path.join(__dirname, '../database/schema.sql');

        if (!fs.existsSync(schemaPath)) {
            console.error('❌ Schema file not found at:', schemaPath);
            process.exit(1);
        }

        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Split by semicolon and filter empty statements
        const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
        
        console.log(`📊 Found ${statements.length} SQL statements to execute`);
        
        let successCount = 0;
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i].trim();
            if (stmt.length > 0) {
                try {
                    await pool.query(stmt);
                    successCount++;
                    console.log(`✅ Executed statement ${i + 1}/${statements.length}`);
                } catch (stmtError) {
                    // Skip errors for "already exists"
                    if (stmtError.message.includes('already exists')) {
                        console.log(`⏭️ Statement ${i + 1} already exists, skipping`);
                        successCount++;
                    } else {
                        console.error(`❌ Error in statement ${i + 1}:`, stmtError.message);
                        console.log('Statement:', stmt.substring(0, 100));
                    }
                }
            }
        }

        console.log(`✅ Migration completed! ${successCount}/${statements.length} statements executed`);
        console.log('📊 Tables: tenants, stores, products, orders, sessions, otp_audit');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

migrate();