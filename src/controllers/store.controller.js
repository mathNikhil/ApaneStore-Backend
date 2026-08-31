const pool = require('../config/database');
const logger = require('../config/logger');
const { generateSlug } = require('../utils/slug');

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
                enableProductSearch,
                categoryImageShape,
                categoryImageSize,
                autoSlideProductImages,
                addToCartLabel,
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

            // Check global uniqueness of store name (case-insensitive)
            const nameCheck = await pool.query(
                'SELECT id FROM stores WHERE LOWER(store_name) = LOWER($1)',
                [storeName.trim()]
            );
            if (nameCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: 'This store name is already taken. Please choose a different name.'
                });
            }

            // Generate subdomain from store name — reserved words and the
            // empty-slug edge case are handled inside generateSlug().
            const subdomain = generateSlug(storeName);

            const storeId = `STORE_${Date.now()}`;

            const config = {
                brand: { storeName, tagline, logoUrl, bannerUrl, brandColors, fonts, baseFontSize },
                products: { categories, banner: productBanner, enableImageZoom, enableProductSearch, categoryImageShape, categoryImageSize, autoSlideProductImages, addToCartLabel },
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
                enableProductSearch,
                categoryImageShape,
                categoryImageSize,
                autoSlideProductImages,
                addToCartLabel,
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

            // 🐛 TEMP DEBUG — catches any request that explicitly sends a
            // status value, from any caller, anywhere in the app. If a
            // store mysteriously reverts to draft again, this line tells
            // you definitively whether THIS endpoint caused it, and what
            // value was sent. Remove once the mystery draft-reset is
            // confirmed fixed and hasn't recurred for a while.
            if (status !== undefined) {
                console.log(`🔍 store.update() received explicit status="${status}" for store ${id} (was "${existingStore.status}") at ${new Date().toISOString()}`);
            }

            // 2. VALIDATION: If the name changed, check for duplicates
            let finalStoreName = existingStore.store_name;
            let subdomain = existingStore.subdomain;

            if (storeName && storeName.trim() !== '' && storeName !== existingStore.store_name) {
                // Check if this new name is taken by ANOTHER store
                const duplicateCheck = await pool.query(
                    'SELECT id FROM stores WHERE LOWER(store_name) = LOWER($1) AND id != $2',
                    [storeName, id]
                );

                if (duplicateCheck.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        error: 'This store name is already taken. Please choose a different name.'
                    });
                }

                finalStoreName = storeName;

                // 🔒 Subdomain lock: once a store is published, its
                // subdomain must not change even if the tenant renames the
                // store — otherwise a live, already-shared URL would break
                // silently on a routine content edit. Renaming is still
                // allowed (finalStoreName updates above); only the
                // subdomain itself is frozen while live.
                if (existingStore.status !== 'published') {
                    subdomain = generateSlug(storeName);
                }
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
                    enableProductSearch: enableProductSearch !== undefined ? enableProductSearch : existingProducts.enableProductSearch,
                    categoryImageShape: categoryImageShape !== undefined ? categoryImageShape : existingProducts.categoryImageShape,
                    addToCartLabel: addToCartLabel !== undefined ? addToCartLabel : existingProducts.addToCartLabel,
                    categoryImageSize: categoryImageSize !== undefined ? categoryImageSize : existingProducts.categoryImageSize,
                    autoSlideProductImages: autoSlideProductImages !== undefined ? autoSlideProductImages : existingProducts.autoSlideProductImages,
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

            // If payment gateway disabled — delete keys from DB for security
            if (paymentSettings !== undefined) {
                if (!paymentSettings.cashfreeEnabled) {
                    await pool.query(
                        `DELETE FROM store_payment_gateway_accounts
                         WHERE store_id = $1 AND gateway_id = (
                             SELECT id FROM payment_gateways WHERE gateway_key = 'cashfree'
                         )`,
                        [id]
                    );
                    logger.info(`🗑️ Cashfree keys deleted for store ${id} (gateway disabled)`);
                }
                if (!paymentSettings.stripeEnabled) {
                    await pool.query(
                        `DELETE FROM store_payment_gateway_accounts
                         WHERE store_id = $1 AND gateway_id = (
                             SELECT id FROM payment_gateways WHERE gateway_key = 'stripe'
                         )`,
                        [id]
                    );
                }
                if (!paymentSettings.razorpayEnabled) {
                    await pool.query(
                        `DELETE FROM store_payment_gateway_accounts
                         WHERE store_id = $1 AND gateway_id = (
                             SELECT id FROM payment_gateways WHERE gateway_key = 'razorpay'
                         )`,
                        [id]
                    );
                }
            }

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
