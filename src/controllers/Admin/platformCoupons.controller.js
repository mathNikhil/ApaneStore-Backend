const pool = require('../../config/database');
const logger = require('../../config/logger');

class PlatformCouponsController {

    // GET /api/admin/platform-coupons
    static async getAll(req, res) {
        try {
            const result = await pool.query(`
                SELECT
                    pc.*,
                    COUNT(pcc.id)::int AS claimed_count_live
                FROM platform_coupons pc
                LEFT JOIN platform_coupon_claims pcc ON pcc.coupon_id = pc.id
                GROUP BY pc.id
                ORDER BY pc.created_at DESC
            `);
            res.json({ success: true, data: result.rows });
        } catch (err) {
            logger.error('❌ platform coupons getAll:', err);
            res.status(500).json({ success: false, error: 'Failed to fetch platform coupons' });
        }
    }

    // POST /api/admin/platform-coupons
    static async create(req, res) {
        try {
            const {
                name, code, unit, value,
                min_order_value = 0,
                max_stores = null,
                start_at,
                end_at,
                trigger_type = 'store_publish',
            } = req.body;

            if (!name || !code || !unit || value === undefined) {
                return res.status(400).json({ success: false, error: 'name, code, unit, value are required' });
            }
            if (!start_at || !end_at) {
                return res.status(400).json({ success: false, error: 'start_at and end_at are required' });
            }
            if (new Date(end_at) <= new Date(start_at)) {
                return res.status(400).json({ success: false, error: 'end_at must be after start_at' });
            }

            const upper = code.trim().toUpperCase();

            const result = await pool.query(`
                INSERT INTO platform_coupons
                    (name, code, unit, value, min_order_value, max_stores, start_at, end_at, trigger_type)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                RETURNING *
            `, [name, upper, unit, value, min_order_value, max_stores, start_at, end_at, trigger_type]);

            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ success: false, error: 'Coupon code already exists' });
            }
            logger.error('❌ platform coupons create:', err);
            res.status(500).json({ success: false, error: 'Failed to create platform coupon' });
        }
    }

    // PATCH /api/admin/platform-coupons/:id/disable
    static async disable(req, res) {
        try {
            const { id } = req.params;
            await pool.query(
                `UPDATE platform_coupons SET status = 'disabled' WHERE id = $1`,
                [id]
            );
            res.json({ success: true, message: 'Platform coupon disabled' });
        } catch (err) {
            logger.error('❌ platform coupons disable:', err);
            res.status(500).json({ success: false, error: 'Failed to disable' });
        }
    }

    // DELETE /api/admin/platform-coupons/:id
    static async remove(req, res) {
        try {
            const { id } = req.params;
            // Only allow delete if no claims yet
            const claims = await pool.query(
                'SELECT COUNT(*) FROM platform_coupon_claims WHERE coupon_id = $1',
                [id]
            );
            if (parseInt(claims.rows[0].count) > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete a coupon that has already been claimed by stores. Disable it instead.'
                });
            }
            await pool.query('DELETE FROM platform_coupons WHERE id = $1', [id]);
            res.json({ success: true, message: 'Deleted' });
        } catch (err) {
            logger.error('❌ platform coupons delete:', err);
            res.status(500).json({ success: false, error: 'Failed to delete' });
        }
    }

    /**
     * Claim all active platform coupons for a store (called when store is published).
     * Idempotent — safe to call multiple times, skips already-claimed coupons.
     * POST /api/admin/platform-coupons/claim-for-store/:storeId
     */
    static async claimForStore(req, res) {
        const { storeId } = req.params;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Get store details
            const storeRes = await client.query(
                'SELECT id, store_id, store_name FROM stores WHERE id = $1',
                [storeId]
            );
            if (!storeRes.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Store not found' });
            }
            const store = storeRes.rows[0];

            // Find active platform coupons this store hasn't claimed yet
            const couponsRes = await client.query(`
                SELECT pc.*
                FROM platform_coupons pc
                WHERE pc.status = 'active'
                  AND (pc.max_stores IS NULL OR pc.claimed_count < pc.max_stores)
                  AND NOT EXISTS (
                      SELECT 1 FROM platform_coupon_claims pcc
                      WHERE pcc.coupon_id = pc.id AND pcc.store_id = $1
                  )
            `, [storeId]);

            const claimed = [];

            for (const pc of couponsRes.rows) {
                // Clone into store's discount_codes
                const startAt = new Date();
                const endAt = new Date();
                endAt.setDate(endAt.getDate() + pc.validity_days);

                const dcRes = await client.query(`
                    INSERT INTO discount_codes
                        (store_id, name, type, code, unit, value,
                         min_order_value, max_uses, scope, start_at, end_at, status)
                    VALUES ($1,$2,'coupon',$3,$4,$5,$6,$7,'full_store',$8,$9,'active')
                    ON CONFLICT (store_id, code) DO NOTHING
                    RETURNING id
                `, [
                    storeId,
                    pc.name,
                    pc.code,
                    pc.unit,
                    pc.value,
                    pc.min_order_value,
                    pc.max_uses_per_store,
                    startAt,
                    endAt
                ]);

                const discountCodeId = dcRes.rows[0]?.id || null;

                // Record claim
                await client.query(`
                    INSERT INTO platform_coupon_claims (coupon_id, store_id, discount_code_id)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (coupon_id, store_id) DO NOTHING
                `, [pc.id, storeId, discountCodeId]);

                // Increment claimed_count + mark exhausted if needed
                await client.query(`
                    UPDATE platform_coupons
                    SET claimed_count = claimed_count + 1,
                        status = CASE
                            WHEN max_stores IS NOT NULL AND claimed_count + 1 >= max_stores THEN 'exhausted'
                            ELSE status
                        END
                    WHERE id = $1
                `, [pc.id]);

                claimed.push(pc.code);
            }

            await client.query('COMMIT');
            logger.info(`[PLATFORM COUPONS] Store ${store.store_name} claimed: ${claimed.join(', ') || 'none'}`);
            res.json({ success: true, claimed });
        } catch (err) {
            await client.query('ROLLBACK');
            logger.error('❌ platform coupons claimForStore:', err);
            res.status(500).json({ success: false, error: 'Failed to claim coupons for store' });
        } finally {
            client.release();
        }
    }

    // GET /api/admin/platform-coupons/:id/claims — who claimed it
    static async getClaims(req, res) {
        try {
            const { id } = req.params;
            const result = await pool.query(`
                SELECT
                    pcc.id, pcc.claimed_at,
                    s.store_name, s.subdomain,
                    dc.status AS coupon_status,
                    dc.current_uses
                FROM platform_coupon_claims pcc
                JOIN stores s ON s.id = pcc.store_id
                LEFT JOIN discount_codes dc ON dc.id = pcc.discount_code_id
                WHERE pcc.coupon_id = $1
                ORDER BY pcc.claimed_at DESC
            `, [id]);
            res.json({ success: true, data: result.rows });
        } catch (err) {
            logger.error('❌ platform coupons getClaims:', err);
            res.status(500).json({ success: false, error: 'Failed to get claims' });
        }
    }
}

module.exports = PlatformCouponsController;
