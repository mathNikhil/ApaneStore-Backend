const { Pool } = require('pg');
const pool = require('../config/database');

class StoreImage {
    // Create a new image record
    static async create(imageData) {
        const {
            tenant_id,
            store_id,
            image_type,
            reference_id = null,
            original_filename,
            storage_path,
            file_size,
            width,
            height,
            mime_type
        } = imageData;

        const result = await pool.query(
            `INSERT INTO store_images (
                tenant_id, store_id, image_type, reference_id,
                original_filename, storage_path, file_size,
                width, height, mime_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [tenant_id, store_id, image_type, reference_id,
             original_filename, storage_path, file_size,
             width, height, mime_type]
        );

        return result.rows[0];
    }

    // Get image by ID
    static async findById(id) {
        const result = await pool.query(
            `SELECT * FROM store_images WHERE id = $1 AND is_active = true`,
            [id]
        );
        return result.rows[0] || null;
    }

    // Get all images for a store
    static async findByStore(storeId) {
        const result = await pool.query(
            `SELECT * FROM store_images 
             WHERE store_id = $1 AND is_active = true 
             ORDER BY uploaded_at DESC`,
            [storeId]
        );
        return result.rows;
    }

    // Get images by type for a store
    static async findByStoreAndType(storeId, imageType) {
        const result = await pool.query(
            `SELECT * FROM store_images 
             WHERE store_id = $1 AND image_type = $2 AND is_active = true 
             ORDER BY uploaded_at DESC`,
            [storeId, imageType]
        );
        return result.rows;
    }

    // Get images by reference (product, variant, category)
    static async findByReference(referenceId, imageType = null) {
        let query = `SELECT * FROM store_images 
                     WHERE reference_id = $1 AND is_active = true`;
        let params = [referenceId];

        if (imageType) {
            query += ` AND image_type = $2`;
            params.push(imageType);
        }

        query += ` ORDER BY uploaded_at DESC`;
        const result = await pool.query(query, params);
        return result.rows;
    }

    // Get branding images (logo, hero) for a store
    static async findBrandingImages(storeId) {
        const result = await pool.query(
            `SELECT * FROM store_images 
             WHERE store_id = $1 
             AND image_type IN ('LOGO', 'HERO') 
             AND is_active = true`,
            [storeId]
        );
        return result.rows;
    }

    // Get product images (main + gallery) for a product
    static async findProductImages(productId) {
        const result = await pool.query(
            `SELECT * FROM store_images 
             WHERE reference_id = $1 
             AND image_type IN ('PRODUCT_MAIN', 'PRODUCT_GALLERY') 
             AND is_active = true
             ORDER BY 
               CASE image_type 
                 WHEN 'PRODUCT_MAIN' THEN 1 
                 WHEN 'PRODUCT_GALLERY' THEN 2 
               END,
               uploaded_at ASC`,
            [productId]
        );
        return result.rows;
    }

    // Soft delete an image
    static async softDelete(id) {
        const result = await pool.query(
            `UPDATE store_images 
             SET is_active = false, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1 
             RETURNING *`,
            [id]
        );
        return result.rows[0] || null;
    }

    // Hard delete an image (permanent)
    static async hardDelete(id) {
        const result = await pool.query(
            `DELETE FROM store_images WHERE id = $1 RETURNING *`,
            [id]
        );
        return result.rows[0] || null;
    }

    // Hard delete all images for a store
    static async hardDeleteByStore(storeId) {
        const result = await pool.query(
            `DELETE FROM store_images WHERE store_id = $1 RETURNING *`,
            [storeId]
        );
        return result.rows;
    }

    // Hard delete all images for a reference (product, variant, category)
    static async hardDeleteByReference(referenceId) {
        const result = await pool.query(
            `DELETE FROM store_images WHERE reference_id = $1 RETURNING *`,
            [referenceId]
        );
        return result.rows;
    }

    // Get all draft store images (for cleanup)
    static async getDraftStoreImages() {
        const result = await pool.query(
            `SELECT si.* FROM store_images si
             INNER JOIN stores s ON si.store_id = s.id
             WHERE s.status = 'DRAFT' 
             AND si.is_active = true
             AND s.created_at < NOW() - INTERVAL '120 days'`
        );
        return result.rows;
    }

    // Count images by store
    static async countByStore(storeId) {
        const result = await pool.query(
            `SELECT COUNT(*) as count FROM store_images 
             WHERE store_id = $1 AND is_active = true`,
            [storeId]
        );
        return parseInt(result.rows[0].count);
    }

    // Get total storage used by a store
    static async getStoreStorageUsage(storeId) {
        const result = await pool.query(
            `SELECT COALESCE(SUM(file_size), 0) as total_bytes 
             FROM store_images 
             WHERE store_id = $1 AND is_active = true`,
            [storeId]
        );
        return parseInt(result.rows[0].total_bytes);
    }
}

module.exports = StoreImage;