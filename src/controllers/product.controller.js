const pool = require('../config/database');
const logger = require('../config/logger');

class ProductController {
    // Create product
    static async create(req, res) {
        try {
            const { 
                storeId, name, description, price, comparePrice, 
                sku, category, images, inventoryCount 
            } = req.body;
            const tenantId = req.tenantId;

            // Verify store belongs to tenant
            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [storeId, tenantId]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found or does not belong to you'
                });
            }

            const result = await pool.query(
                `INSERT INTO products 
                 (store_id, name, description, price, compare_price, sku, category, images, inventory_count)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [storeId, name, description, price, comparePrice, sku, category, images || [], inventoryCount || 0]
            );

            logger.info(`📦 Product created: ${name} in store ${storeId}`);

            res.status(201).json({
                success: true,
                message: 'Product created successfully',
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Create product error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create product'
            });
        }
    }

    // Get all products for a store
    static async getAll(req, res) {
        try {
            const { storeId } = req.query;
            const tenantId = req.tenantId;

            let query = 'SELECT * FROM products';
            let params = [];

            if (storeId) {
                // Verify store belongs to tenant
                const storeCheck = await pool.query(
                    'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                    [storeId, tenantId]
                );

                if (storeCheck.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'Store not found or does not belong to you'
                    });
                }

                query += ' WHERE store_id = $1';
                params.push(storeId);
            }

            query += ' ORDER BY created_at DESC';

            const result = await pool.query(query, params);

            res.status(200).json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            logger.error('❌ Get products error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get products'
            });
        }
    }

    // Get product by ID
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const result = await pool.query(
                `SELECT p.* FROM products p
                 JOIN stores s ON p.store_id = s.id
                 WHERE p.id = $1 AND s.tenant_id = $2`,
                [id, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Get product error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get product'
            });
        }
    }

    // Update product
    static async update(req, res) {
        try {
            const { id } = req.params;
            const { 
                name, description, price, comparePrice, 
                sku, category, images, inventoryCount, isActive 
            } = req.body;
            const tenantId = req.tenantId;

            // Verify product belongs to tenant
            const check = await pool.query(
                `SELECT p.id FROM products p
                 JOIN stores s ON p.store_id = s.id
                 WHERE p.id = $1 AND s.tenant_id = $2`,
                [id, tenantId]
            );

            if (check.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }

            const result = await pool.query(
                `UPDATE products 
                 SET name = COALESCE($1, name),
                     description = COALESCE($2, description),
                     price = COALESCE($3, price),
                     compare_price = COALESCE($4, compare_price),
                     sku = COALESCE($5, sku),
                     category = COALESCE($6, category),
                     images = COALESCE($7, images),
                     inventory_count = COALESCE($8, inventory_count),
                     is_active = COALESCE($9, is_active),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $10
                 RETURNING *`,
                [name, description, price, comparePrice, sku, category, images, inventoryCount, isActive, id]
            );

            logger.info(`📦 Product updated: ${id}`);

            res.status(200).json({
                success: true,
                message: 'Product updated successfully',
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Update product error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update product'
            });
        }
    }

    // Delete product
    static async delete(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            // Verify product belongs to tenant
            const check = await pool.query(
                `SELECT p.id FROM products p
                 JOIN stores s ON p.store_id = s.id
                 WHERE p.id = $1 AND s.tenant_id = $2`,
                [id, tenantId]
            );

            if (check.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }

            await pool.query('DELETE FROM products WHERE id = $1', [id]);

            logger.info(`📦 Product deleted: ${id}`);

            res.status(200).json({
                success: true,
                message: 'Product deleted successfully'
            });
        } catch (error) {
            logger.error('❌ Delete product error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete product'
            });
        }
    }
}

module.exports = ProductController;