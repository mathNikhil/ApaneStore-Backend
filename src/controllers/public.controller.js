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
                `SELECT id, store_id, store_name, subdomain, status, config
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

            res.status(200).json({
                success: true,
                data: result.rows[0]
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
