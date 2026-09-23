const pool = require('../config/database');
const logger = require('../config/logger');

class PublicStoreController {
    // Returns published stores by subdomain OR custom domain.
    // Custom domain path: hostname = 'apanestore.com' → look up store_domain_config
    static async getBySubdomain(req, res) {
        try {
            const { subdomain } = req.params;

            // First try subdomain match (e.g. test2.aapnaestore.com → 'test2')
            let result = await pool.query(
                `SELECT id, store_id, store_name, subdomain, status, config, store_type
                 FROM stores
                 WHERE subdomain = $1 AND status = 'published'`,
                [subdomain]
            );

            // If not found by subdomain, try custom domain match
            // e.g. hostname = 'apanestore.com' or 'www.apanestore.com'
            if (result.rows.length === 0) {
                const cleanDomain = subdomain
                    .replace(/^www\./, '')
                    .toLowerCase()
                    .trim();

                result = await pool.query(
                    `SELECT s.id, s.store_id, s.store_name, s.subdomain, s.status, s.config
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
            }

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found or not published'
                });
            }

            const store = result.rows[0];

            // Fetch inventory stock for this store
            const inventoryResult = await pool.query(
                `SELECT inv.product_id, inv.variation_id, inv.size_id, 
                    inv.stock_quantity,
                    COALESCE(s.total_sold, 0) AS total_sold,
                    COALESCE(r.total_returned, 0) AS total_returned,
                    (inv.stock_quantity - COALESCE(s.total_sold, 0) + COALESCE(r.total_returned, 0)) AS current_stock
                FROM inventory inv
                LEFT JOIN (
                    SELECT o.store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                        item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_sold
                    FROM orders o, jsonb_array_elements(o.items::jsonb) AS item
                    WHERE o.store_id=$1 AND (
                        (o.order_type = 'dine_in' AND o.status IN ('confirmed','processing','delivered'))
                        OR (o.order_type != 'dine_in' AND o.status = 'delivered')
                        OR (o.order_type IS NULL AND o.status = 'delivered')
                    )
                    GROUP BY o.store_id, item->>'productId', item->>'variationId', item->>'sizeId'
                ) s ON inv.store_id=s.store_id AND inv.product_id=s.product_id AND inv.variation_id=s.variation_id AND inv.size_id=s.size_id
                LEFT JOIN (
                    SELECT o.store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                        item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_returned
                    FROM orders o, jsonb_array_elements(o.items::jsonb) AS item
                    WHERE o.store_id=$1 AND o.status='returned'
                    GROUP BY o.store_id, item->>'productId', item->>'variationId', item->>'sizeId'
                ) r ON inv.store_id=r.store_id AND inv.product_id=r.product_id AND inv.variation_id=r.variation_id AND inv.size_id=r.size_id
                WHERE inv.store_id=$1 AND inv.is_archived=FALSE`,
                [store.id]
            );

            // Build stock map: { sizeId: current_stock }
            const stockMap = {};
            inventoryResult.rows.forEach(row => {
                stockMap[row.size_id] = parseInt(row.current_stock || 0);
            });

            res.status(200).json({
                success: true,
                data: { ...store, stockMap }
            });
        } catch (error) {
            logger.error('❌ Public store fetch error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to load store'
            });
        }
    }
}

module.exports = PublicStoreController;
