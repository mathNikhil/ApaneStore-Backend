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
                productBanner,
                enableImageZoom,
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
                products: { categories, banner: productBanner, enableImageZoom },
                cart: cartSettings,
                payment: paymentSettings,
                address: addressSettings,
                order: orderSettings,
                profile: profileSettings,
                return: returnSettings,
                images,
            };

            const result = await pool.query(
                `INSERT INTO stores (store_id, tenant_id, store_name, subdomain, config, status, last_builder_step, created_at, updated_at, published_at)
                 VALUES ($1, $2, $3, $4, $5, 'draft', $6, NOW(), NOW(), NULL)
                 RETURNING id, store_id, store_name, subdomain, config, status, last_builder_step, created_at, updated_at, published_at`,
                [storeId, tenantId, storeName, subdomain, JSON.stringify(config), 1]
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

    // Update store (FIXED 409 Conflict)
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
                productBanner,
                enableImageZoom,
                cartSettings,
                paymentSettings,
                addressSettings,
                orderSettings,
                profileSettings,
                returnSettings,
                images,
                status,
                lastBuilderStep,
            } = req.body;

            // 1. Check if store exists
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

            const existingStore = checkResult.rows[0];

            // 2. VALIDATION: If the name changed, check for duplicates
            let finalStoreName = existingStore.store_name;
            let subdomain = existingStore.subdomain;

            if (storeName && storeName.trim() !== '' && storeName !== existingStore.store_name) {
                // Check if this new name is taken by ANOTHER store
                const duplicateCheck = await pool.query(
                    'SELECT id FROM stores WHERE store_name = $1 AND id != $2 AND tenant_id = $3',
                    [storeName, id, tenantId]
                );

                if (duplicateCheck.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        error: 'This store name is already taken. Please choose a different name.'
                    });
                }

                finalStoreName = storeName;
                
                // Regenerate subdomain
                subdomain = storeName
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
            }

            // 3. Build Config — merge with the EXISTING config rather than
            // rebuilding from scratch, so a partial update (like a
            // publish-status-only save) can't wipe out fields it didn't
            // send. Each field falls back to whatever's already saved.
            const existingConfig = existingStore.config || {};
            const existingBrand = existingConfig.brand || {};
            const existingProducts = existingConfig.products || {};

            const config = {
                brand: {
                    storeName: finalStoreName,
                    tagline: tagline !== undefined ? tagline : existingBrand.tagline,
                    logoUrl: logoUrl !== undefined ? logoUrl : existingBrand.logoUrl,
                    bannerUrl: bannerUrl !== undefined ? bannerUrl : existingBrand.bannerUrl,
                    brandColors: brandColors !== undefined ? brandColors : existingBrand.brandColors,
                    fonts: fonts !== undefined ? fonts : existingBrand.fonts,
                    baseFontSize: baseFontSize !== undefined ? baseFontSize : existingBrand.baseFontSize,
                },
                products: {
                    categories: categories !== undefined ? categories : existingProducts.categories,
                    banner: productBanner !== undefined ? productBanner : existingProducts.banner,
                    enableImageZoom: enableImageZoom !== undefined ? enableImageZoom : existingProducts.enableImageZoom,
                },
                cart: cartSettings !== undefined ? cartSettings : existingConfig.cart,
                payment: paymentSettings !== undefined ? paymentSettings : existingConfig.payment,
                address: addressSettings !== undefined ? addressSettings : existingConfig.address,
                order: orderSettings !== undefined ? orderSettings : existingConfig.order,
                profile: profileSettings !== undefined ? profileSettings : existingConfig.profile,
                return: returnSettings !== undefined ? returnSettings : existingConfig.return,
                images: images !== undefined ? images : existingConfig.images,
            };

            // 4. Execute update
            const result = await pool.query(
                `UPDATE stores
                 SET store_name = $1,
                     subdomain = $2,
                     config = $3,
                     status = COALESCE($4, status),
                     last_builder_step = COALESCE($5, last_builder_step, 1),
                     updated_at = NOW()
                 WHERE id = $6
                 RETURNING id, store_id, store_name, subdomain, status, config, last_builder_step, created_at, updated_at, published_at`,
                [finalStoreName, subdomain, JSON.stringify(config), status || null, lastBuilderStep || 1, id]
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

            const result = await pool.query(
                `SELECT id, store_id, store_name, subdomain, status, config, last_builder_step, created_at, updated_at, published_at
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

            const result = await pool.query(
                `SELECT id, tenant_id, store_id, store_name, subdomain, status, config, last_builder_step, created_at, updated_at, published_at
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