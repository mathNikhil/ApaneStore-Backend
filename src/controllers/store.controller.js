const pool = require('../config/database');
const logger = require('../config/logger');

class StoreController {
    // Create a new store
    static async create(req, res) {
        try {
            const tenantId = req.tenantId;
            const {
                storeName,
                tagline,
                logoUrl,
                bannerUrl,
                brandColors,
                fonts,
                baseFontSize,
                categories,
                cartSettings,
                paymentSettings,
                addressSettings,
                orderSettings,
                profileSettings,
                returnSettings,
                images,
            } = req.body;

            if (!storeName || storeName.trim() === '') {
                return res.status(400).json({
                    success: false,
                    error: 'Store name is required'
                });
            }

            // Generate subdomain from store name
            const subdomain = storeName
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');

            const storeId = `STORE_${Date.now()}`;

            const config = {
                brand: { storeName, tagline, logoUrl, bannerUrl, brandColors, fonts, baseFontSize },
                products: { categories },
                cart: cartSettings,
                payment: paymentSettings,
                address: addressSettings,
                order: orderSettings,
                profile: profileSettings,
                return: returnSettings,
                images,
            };

            // ✅ Include published_at column
            const result = await pool.query(
                `INSERT INTO stores (store_id, tenant_id, store_name, subdomain, config, status, created_at, updated_at, published_at)
                 VALUES ($1, $2, $3, $4, $5, 'draft', NOW(), NOW(), NULL)
                 RETURNING id, store_id, store_name, subdomain, config, status, created_at, updated_at, published_at`,
                [storeId, tenantId, storeName, subdomain, JSON.stringify(config)]
            );

            logger.info(`✅ Store created: ${storeId} for tenant ${tenantId}`);

            res.status(201).json({
                success: true,
                message: 'Store created successfully',
                data: result.rows[0]
            });
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    error: 'This store name is already taken. Please choose a different name.'
                });
            }
            logger.error('❌ Create store error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to create store'
            });
        }
    }

    // Update store
    static async update(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;
            const {
                storeName,
                tagline,
                logoUrl,
                bannerUrl,
                brandColors,
                fonts,
                baseFontSize,
                categories,
                cartSettings,
                paymentSettings,
                addressSettings,
                orderSettings,
                profileSettings,
                returnSettings,
                images,
                status,
            } = req.body;

            const checkResult = await pool.query(
                'SELECT * FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );

            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            let subdomain = checkResult.rows[0].subdomain;
            if (storeName && storeName !== checkResult.rows[0].store_name) {
                subdomain = storeName
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
            }

            const config = {
                brand: { storeName, tagline, logoUrl, bannerUrl, brandColors, fonts, baseFontSize },
                products: { categories },
                cart: cartSettings,
                payment: paymentSettings,
                address: addressSettings,
                order: orderSettings,
                profile: profileSettings,
                return: returnSettings,
                images,
            };

            const result = await pool.query(
                `UPDATE stores
                 SET store_name = $1,
                     subdomain = $2,
                     config = $3,
                     status = COALESCE($4, status),
                     updated_at = NOW()
                 WHERE id = $5
                 RETURNING id, store_id, store_name, subdomain, status, config, created_at, updated_at, published_at`,
                [storeName || checkResult.rows[0].store_name, subdomain, JSON.stringify(config), status || 'draft', id]
            );

            logger.info(`✅ Store updated: ${id}`);

            res.json({
                success: true,
                message: 'Store updated successfully',
                data: result.rows[0]
            });
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    error: 'This store name is already taken. Please choose a different name.'
                });
            }
            logger.error('❌ Update store error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to update store'
            });
        }
    }

    // Get all stores for tenant
    static async getAll(req, res) {
        try {
            const tenantId = req.tenantId;

            // ✅ Include published_at column
            const result = await pool.query(
                `SELECT id, store_id, store_name, subdomain, status, config, created_at, updated_at, published_at
                 FROM stores
                 WHERE tenant_id = $1
                 ORDER BY created_at DESC`,
                [tenantId]
            );

            res.json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            logger.error('❌ Get stores error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get stores'
            });
        }
    }

    // Get store by ID
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            // ✅ Include published_at column
            const result = await pool.query(
                `SELECT id, store_id, store_name, subdomain, status, config, created_at, updated_at, published_at
                 FROM stores
                 WHERE id = $1 AND tenant_id = $2`,
                [id, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            res.json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Get store error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get store'
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

            logger.info(`✅ Store deleted: ${id}`);

            res.json({
                success: true,
                message: 'Store deleted successfully'
            });
        } catch (error) {
            logger.error('❌ Delete store error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to delete store'
            });
        }
    }
}

module.exports = StoreController;