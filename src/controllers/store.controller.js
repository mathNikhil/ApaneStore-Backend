const pool = require('../config/database');
const logger = require('../config/logger');

class StoreController {
    // Create store
    static async create(req, res) {
        try {
            const { storeName, subdomain, config = {} } = req.body;
            const tenantId = req.tenantId;

            if (!storeName || !subdomain) {
                return res.status(400).json({
                    success: false,
                    error: 'Store name and subdomain are required'
                });
            }

            // Check if subdomain is taken
            const existing = await pool.query(
                'SELECT id FROM stores WHERE subdomain = $1',
                [subdomain]
            );

            if (existing.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Subdomain already taken'
                });
            }

            // Generate store_id
            const timestamp = Date.now().toString().slice(-6);
            const storeId = `STR-${timestamp}-${Math.floor(Math.random() * 10000)}`;

            const result = await pool.query(
                `INSERT INTO stores (store_id, tenant_id, store_name, subdomain, config)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [storeId, tenantId, storeName, subdomain, config]
            );

            // Update tenant store count
            await pool.query(
                'UPDATE tenants SET store_count = store_count + 1 WHERE id = $1',
                [tenantId]
            );

            logger.info(`🏪 Store created: ${storeName} for tenant ${tenantId}`);

            res.status(201).json({
                success: true,
                message: 'Store created successfully',
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Create store error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create store'
            });
        }
    }

    // Get all stores for a tenant
    static async getAll(req, res) {
        try {
            const tenantId = req.tenantId;

            const result = await pool.query(
                'SELECT * FROM stores WHERE tenant_id = $1 ORDER BY created_at DESC',
                [tenantId]
            );

            res.status(200).json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            logger.error('❌ Get stores error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get stores'
            });
        }
    }

    // Get store by ID
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const result = await pool.query(
                'SELECT * FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Get store error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get store'
            });
        }
    }

    // Update store
    static async update(req, res) {
        try {
            const { id } = req.params;
            const { storeName, subdomain, config, status } = req.body;
            const tenantId = req.tenantId;

            const result = await pool.query(
                `UPDATE stores 
                 SET store_name = COALESCE($1, store_name),
                     subdomain = COALESCE($2, subdomain),
                     config = COALESCE($3, config),
                     status = COALESCE($4, status),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $5 AND tenant_id = $6
                 RETURNING *`,
                [storeName, subdomain, config, status, id, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            logger.info(`🏪 Store updated: ${id}`);

            res.status(200).json({
                success: true,
                message: 'Store updated successfully',
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Update store error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update store'
            });
        }
    }

    // Delete store
    static async delete(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const result = await pool.query(
                'DELETE FROM stores WHERE id = $1 AND tenant_id = $2 RETURNING id',
                [id, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            // Update tenant store count
            await pool.query(
                'UPDATE tenants SET store_count = store_count - 1 WHERE id = $1',
                [tenantId]
            );

            logger.info(`🏪 Store deleted: ${id}`);

            res.status(200).json({
                success: true,
                message: 'Store deleted successfully'
            });
        } catch (error) {
            logger.error('❌ Delete store error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete store'
            });
        }
    }
}

module.exports = StoreController;