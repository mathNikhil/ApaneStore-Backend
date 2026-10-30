const pool = require('../config/database');
const logger = require('../config/logger');

class PublicStoreController {
    // ─────────────────────────────────────────────────────────────────────────
    // Shared helper: resolve a store row by subdomain OR custom domain.
    // Returns the raw DB row, or null if not found.
    // ─────────────────────────────────────────────────────────────────────────
    static async _resolveStore(subdomain) {
        // 1. Try subdomain match first (fast path)
        let result = await pool.query(
            `SELECT id, store_id, store_name, subdomain, status, config, store_type
             FROM stores
             WHERE subdomain = $1 AND status = 'published'`,
            [subdomain]
        );

        if (result.rows.length > 0) return result.rows[0];

        // 2. Fall back to custom domain lookup
        const cleanDomain = subdomain.replace(/^www\./, '').toLowerCase().trim();

        result = await pool.query(
            `SELECT s.id, s.store_id, s.store_name, s.subdomain, s.status, s.config, s.store_type
             FROM stores s
             JOIN store_domain_config sdc ON sdc.store_id = s.id
             WHERE (
                 sdc.custom_domain = $1
                 OR sdc.custom_domain = $2
                 OR sdc.custom_domain = $3
             )
             AND sdc.dns_status = 'verified'
             AND s.status = 'published'
             LIMIT 1`,
            [subdomain, cleanDomain, `www.${cleanDomain}`]
        );

        return result.rows.length > 0 ? result.rows[0] : null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/public/store/:subdomain
    //
    // FAST shell response — only what's needed to paint the storefront UI:
    //   • Store identity  (name, subdomain, store_type)
    //   • Brand / theme   (config.theme, config.logo, config.banner, config.seo)
    //   • Payment config  (config.payment)
    //   • Cart config     (config.cart — delivery zones, charges)
    //   • Contact info    (config.contactInfo, config.socialLinks)
    //   • About / policy  (config.about, config.returnPolicy)
    //   • Store features  (config.features, config.orderTypes, config.tableConfig)
    //
    // NOT included: products, categories, inventory stockMap.
    // Those are fetched lazily via GET /api/public/store/:subdomain/catalog
    // ─────────────────────────────────────────────────────────────────────────
    static async getBySubdomain(req, res) {
        try {
            const { subdomain } = req.params;
            const store = await PublicStoreController._resolveStore(subdomain);

            if (!store) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found or not published'
                });
            }

            const config = store.config || {};

            // Extract only the keys needed for the initial render.
            // Products and categories are deliberately excluded here.
            const shellConfig = {
                theme:         config.theme         || null,
                logo:          config.logo          || null,
                banner:        config.banner        || null,
                seo:           config.seo           || null,
                payment:       config.payment       || null,
                cart:          config.cart          || null,
                contactInfo:   config.contactInfo   || null,
                socialLinks:   config.socialLinks   || null,
                about:         config.about         || null,
                returnPolicy:  config.returnPolicy  || null,
                features:      config.features      || null,
                orderTypes:    config.orderTypes    || null,
                tableConfig:   config.tableConfig   || null,
                storeTimings:  config.storeTimings  || null,
                announcement:  config.announcement  || null,
            };

            res.status(200).json({
                success: true,
                data: {
                    id:         store.id,
                    store_id:   store.store_id,
                    store_name: store.store_name,
                    subdomain:  store.subdomain,
                    status:     store.status,
                    store_type: store.store_type,
                    config:     shellConfig,
                    // Signal to the frontend that catalog must be loaded separately
                    catalogUrl: `/api/public/store/${store.subdomain}/catalog`,
                }
            });
        } catch (error) {
            logger.error('❌ Public store shell fetch error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to load store'
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/public/store/:subdomain/catalog
    //
    // Lazy-loaded catalog — fetched AFTER the storefront shell has painted:
    //   • products     (from config.products)
    //   • categories   (from config.categories)
    //   • stockMap     (live from inventory table — heavy 3-way join)
    //
    // Frontend calls this in the background after the initial render.
    // ─────────────────────────────────────────────────────────────────────────
    static async getCatalog(req, res) {
        try {
            const { subdomain } = req.params;
            const store = await PublicStoreController._resolveStore(subdomain);

            if (!store) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found or not published'
                });
            }

            const config = store.config || {};

            // Heavy inventory join — only runs on catalog fetch, not on page load
            const inventoryResult = await pool.query(
                `SELECT inv.product_id, inv.variation_id, inv.size_id,
                    inv.stock_quantity,
                    COALESCE(s.total_sold, 0)     AS total_sold,
                    COALESCE(r.total_returned, 0) AS total_returned,
                    (inv.stock_quantity - COALESCE(s.total_sold, 0) + COALESCE(r.total_returned, 0)) AS current_stock
                FROM inventory inv
                LEFT JOIN (
                    SELECT o.store_id,
                           item->>'productId'   AS product_id,
                           item->>'variationId' AS variation_id,
                           item->>'sizeId'      AS size_id,
                           SUM((item->>'quantity')::INTEGER) AS total_sold
                    FROM orders o, jsonb_array_elements(o.items::jsonb) AS item
                    WHERE o.store_id = $1
                      AND (
                          (o.order_type = 'dine_in' AND o.status IN ('confirmed','processing','delivered'))
                          OR (o.order_type != 'dine_in' AND o.status = 'delivered')
                          OR (o.order_type IS NULL AND o.status = 'delivered')
                      )
                    GROUP BY o.store_id, item->>'productId', item->>'variationId', item->>'sizeId'
                ) s ON inv.store_id = s.store_id
                    AND inv.product_id   = s.product_id
                    AND inv.variation_id = s.variation_id
                    AND inv.size_id      = s.size_id
                LEFT JOIN (
                    SELECT o.store_id,
                           item->>'productId'   AS product_id,
                           item->>'variationId' AS variation_id,
                           item->>'sizeId'      AS size_id,
                           SUM((item->>'quantity')::INTEGER) AS total_returned
                    FROM orders o, jsonb_array_elements(o.items::jsonb) AS item
                    WHERE o.store_id = $1 AND o.status = 'returned'
                    GROUP BY o.store_id, item->>'productId', item->>'variationId', item->>'sizeId'
                ) r ON inv.store_id = r.store_id
                    AND inv.product_id   = r.product_id
                    AND inv.variation_id = r.variation_id
                    AND inv.size_id      = r.size_id
                WHERE inv.store_id = $1 AND inv.is_archived = FALSE`,
                [store.id]
            );

            const stockMap = {};
            inventoryResult.rows.forEach(row => {
                stockMap[row.size_id] = parseInt(row.current_stock || 0);
            });

            res.status(200).json({
                success: true,
                data: {
                    products:   config.products   || [],
                    categories: config.categories || [],
                    stockMap,
                }
            });
        } catch (error) {
            logger.error('❌ Public catalog fetch error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to load catalog'
            });
        }
    }
}

module.exports = PublicStoreController;
