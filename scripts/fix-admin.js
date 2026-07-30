const pool = require('../src/config/database');
const bcrypt = require('bcrypt');

const ADMIN_EMAIL = 'admin@apnaestore.com';
const ADMIN_PASSWORD = 'Admin@123';

async function fixAdmin() {
    try {
        console.log('🔍 Checking for existing admin account...');

        const existing = await pool.query(
            `SELECT id FROM tenants WHERE email = $1`,
            [ADMIN_EMAIL]
        );

        const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

        if (existing.rows.length > 0) {
            await pool.query(
                `UPDATE tenants
                 SET password_hash = $1,
                     business_type = 'admin',
                     is_verified = true
                 WHERE email = $2`,
                [passwordHash, ADMIN_EMAIL]
            );
            console.log('✅ Existing admin account found — password has been reset.');
        } else {
            await pool.query(
                `INSERT INTO tenants
                 (tenant_id, company_name, email, phone, password_hash, business_type, is_verified)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                ['ADMIN-001', 'ApnaEstore Admin', ADMIN_EMAIL, '9999999999', passwordHash, 'admin', true]
            );
            console.log('✅ New admin account created.');
        }

        console.log('');
        console.log('🎉 Done! You can now log in to the Super Admin panel with:');
        console.log(`   Email:    ${ADMIN_EMAIL}`);
        console.log(`   Password: ${ADMIN_PASSWORD}`);
        console.log('');
        process.exit(0);
    } catch (error) {
        console.error('❌ Something went wrong while fixing the admin account:');
        console.error(error.message);
        console.log('');
        console.log('💡 Make sure PostgreSQL is running and your Backend/.env file has the correct DB settings.');
        process.exit(1);
    }
}

fixAdmin();
