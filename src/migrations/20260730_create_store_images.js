const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function up() {
    const client = await pool.connect();
    try {
        // Create store_images table
        await client.query(`
            CREATE TABLE IF NOT EXISTS store_images (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL,
                store_id UUID NOT NULL,
                image_type VARCHAR(50) NOT NULL,
                reference_id UUID,
                original_filename VARCHAR(255),
                storage_path VARCHAR(500) NOT NULL,
                file_size BIGINT,
                width INTEGER,
                height INTEGER,
                mime_type VARCHAR(100),
                is_active BOOLEAN DEFAULT true,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create indexes for performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_store_images_tenant ON store_images(tenant_id);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_store_images_store ON store_images(store_id);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_store_images_type ON store_images(image_type);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_store_images_reference ON store_images(reference_id);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_store_images_active ON store_images(is_active);
        `);

        console.log('✅ store_images table created successfully');

        // Add status column to stores table if not exists
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'stores' AND column_name = 'status'
                ) THEN
                    ALTER TABLE stores ADD COLUMN status VARCHAR(20) DEFAULT 'DRAFT';
                END IF;
            END $$;
        `);

        console.log('✅ stores table updated with status column');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function down() {
    const client = await pool.connect();
    try {
        await client.query(`DROP TABLE IF EXISTS store_images;`);
        console.log('✅ store_images table dropped');
    } catch (error) {
        console.error('❌ Rollback failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { up, down };