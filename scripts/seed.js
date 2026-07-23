const pool = require('../src/config/database');
const bcrypt = require('bcrypt');

async function seed() {
    try {
        console.log('🌱 Seeding database...');
        
        // Check if admin exists
        const adminCheck = await pool.query(
            `SELECT id FROM tenants WHERE email = 'admin@apnaestore.com'`
        );
        
        if (adminCheck.rows.length === 0) {
            const passwordHash = await bcrypt.hash('Admin@123', 12);
            
            await pool.query(
                `INSERT INTO tenants 
                 (tenant_id, company_name, email, phone, password_hash, business_type, is_verified) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                ['ADMIN-001', 'ApnaEstore Admin', 'admin@apnaestore.com', '9999999999', passwordHash, 'admin', true]
            );
            
            console.log('✅ Admin user created');
        }
        
        console.log('✅ Seeding completed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

seed();