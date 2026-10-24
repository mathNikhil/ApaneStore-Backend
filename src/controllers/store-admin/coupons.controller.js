const pool = require('../../config/database');

// Derive real-time status from DB fields
function computeStatus(row) {
    if (row.status === 'disabled') return 'disabled';
    const now = new Date();
    if (new Date(row.start_at) > now) return 'scheduled';
    if (new Date(row.end_at) < now) return 'expired';
    if (row.max_uses !== null && row.current_uses >= row.max_uses) return 'expired';
    return 'active';
}

function autoCode(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

class CouponsController {

    // GET /api/store/:storeId/admin/coupons
    static async getAll(req, res) {
        try {
            const { storeId } = req.params;
            const { status, search } = req.query;

            let query = `
                SELECT id, name, type, code, unit, value, buy_x_get_y,
                       min_order_value, max_uses, current_uses, scope, scope_items, get_items,
                       start_at, end_at, status, created_at
                FROM discount_codes
                WHERE store_id = $1
            `;
            const params = [storeId];

            if (search) {
                query += ` AND (name ILIKE $${params.length + 1} OR code ILIKE $${params.length + 1})`;
                params.push(`%${search}%`);
            }

            query += ' ORDER BY created_at DESC';

            const result = await pool.query(query, params);

            // Compute live status and optionally filter
            let rows = result.rows.map(r => ({ ...r, status: computeStatus(r) }));
            if (status && status !== 'all') {
                rows = rows.filter(r => r.status === status);
            }

            return res.json({ success: true, data: rows });
        } catch (err) {
            console.error('[Coupons] getAll error:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch coupons' });
        }
    }

    // GET /api/store/:storeId/admin/coupons/:id
    static async getById(req, res) {
        try {
            const { storeId, id } = req.params;
            const result = await pool.query(
                'SELECT * FROM discount_codes WHERE id = $1 AND store_id = $2',
                [id, storeId]
            );
            if (!result.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
            const row = { ...result.rows[0], status: computeStatus(result.rows[0]) };
            return res.json({ success: true, data: row });
        } catch (err) {
            console.error('[Coupons] getById error:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch coupon' });
        }
    }

    // POST /api/store/:storeId/admin/coupons
    static async create(req, res) {
        try {
            const { storeId } = req.params;
            const {
                name, type, code: rawCode, unit, value = 0, buy_x_get_y = null,
                min_order_value = 0, max_uses = null, scope = 'full_store',
                scope_items = [], get_items = [], start_at, end_at, applicable_to = 'both'
            } = req.body;

            if (!name || !type || !unit || !start_at || !end_at) {
                return res.status(400).json({ success: false, error: 'name, type, unit, start_at, end_at are required' });
            }
            if (!['coupon', 'promo'].includes(type)) {
                return res.status(400).json({ success: false, error: 'type must be coupon or promo' });
            }

            // Auto-generate code for coupons if not provided; promos use their name as code
            let code;
            if (type === 'coupon') {
                code = rawCode ? rawCode.trim().toUpperCase() : autoCode();
            } else {
                code = rawCode ? rawCode.trim().toUpperCase() : name.trim().toUpperCase().replace(/\s+/g, '');
            }

            // Check uniqueness within store
            const dup = await pool.query(
                'SELECT id FROM discount_codes WHERE store_id = $1 AND code = $2',
                [storeId, code]
            );
            if (dup.rows.length) {
                return res.status(409).json({ success: false, error: `Code "${code}" already exists in your store` });
            }

            const result = await pool.query(`
                INSERT INTO discount_codes
                (store_id, name, type, code, unit, value, buy_x_get_y, min_order_value, max_uses, scope, scope_items, get_items, start_at, end_at, status, applicable_to)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'scheduled',$15)
                RETURNING *
            `, [
                storeId, name, type, code, unit, value,
                buy_x_get_y ? JSON.stringify(buy_x_get_y) : null,
                min_order_value, max_uses || null, scope,
                JSON.stringify(scope_items), JSON.stringify(get_items),
                start_at, end_at, applicable_to
            ]);

            const row = { ...result.rows[0], status: computeStatus(result.rows[0]) };
            return res.status(201).json({ success: true, data: row });
        } catch (err) {
            console.error('[Coupons] create error:', err);
            if (err.code === '23505') {
                return res.status(409).json({ success: false, error: 'This code already exists in your store' });
            }
            return res.status(500).json({ success: false, error: 'Failed to create coupon' });
        }
    }

    // PUT /api/store/:storeId/admin/coupons/:id
    static async update(req, res) {
        try {
            const { storeId, id } = req.params;
            const {
                name, unit, value, buy_x_get_y, min_order_value,
                max_uses, scope, scope_items, get_items, start_at, end_at, status, applicable_to
            } = req.body;

            // Fetch existing
            const existing = await pool.query(
                'SELECT * FROM discount_codes WHERE id = $1 AND store_id = $2',
                [id, storeId]
            );
            if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Not found' });

            const r = existing.rows[0];
            const result = await pool.query(`
                UPDATE discount_codes SET
                    name            = $1,
                    unit            = $2,
                    value           = $3,
                    buy_x_get_y     = $4,
                    min_order_value = $5,
                    max_uses        = $6,
                    scope           = $7,
                    scope_items     = $8,
                    get_items       = $9,
                    start_at        = $10,
                    end_at          = $11,
                    status          = $12,
                    applicable_to   = $13
                WHERE id = $14 AND store_id = $15
                RETURNING *
            `, [
                name          ?? r.name,
                unit          ?? r.unit,
                value         ?? r.value,
                buy_x_get_y   !== undefined ? JSON.stringify(buy_x_get_y) : r.buy_x_get_y,
                min_order_value ?? r.min_order_value,
                max_uses      !== undefined ? (max_uses || null) : r.max_uses,
                scope         ?? r.scope,
                scope_items   !== undefined ? JSON.stringify(scope_items) : r.scope_items,
                get_items     !== undefined ? JSON.stringify(get_items)   : (r.get_items ?? '[]'),
                start_at      ?? r.start_at,
                end_at        ?? r.end_at,
                status        ?? r.status,
                applicable_to ?? r.applicable_to ?? 'both',
                id, storeId
            ]);

            const updated = { ...result.rows[0], status: computeStatus(result.rows[0]) };
            return res.json({ success: true, data: updated });
        } catch (err) {
            console.error('[Coupons] update error:', err);
            return res.status(500).json({ success: false, error: 'Failed to update coupon' });
        }
    }

    // DELETE /api/store/:storeId/admin/coupons/:id
    static async remove(req, res) {
        try {
            const { storeId, id } = req.params;
            const result = await pool.query(
                'DELETE FROM discount_codes WHERE id = $1 AND store_id = $2 RETURNING id',
                [id, storeId]
            );
            if (!result.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
            return res.json({ success: true, message: 'Deleted' });
        } catch (err) {
            console.error('[Coupons] remove error:', err);
            return res.status(500).json({ success: false, error: 'Failed to delete coupon' });
        }
    }

    // POST /api/store/:storeId/admin/coupons/:id/disable
    static async disable(req, res) {
        try {
            const { storeId, id } = req.params;
            const result = await pool.query(
                "UPDATE discount_codes SET status = 'disabled' WHERE id = $1 AND store_id = $2 RETURNING *",
                [id, storeId]
            );
            if (!result.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
            return res.json({ success: true, data: result.rows[0] });
        } catch (err) {
            console.error('[Coupons] disable error:', err);
            return res.status(500).json({ success: false, error: 'Failed to disable coupon' });
        }
    }

    // POST /api/store/:storeId/admin/coupons/validate
    // Used by checkout to validate a code before applying
    static async validate(req, res) {
        try {
            const { storeId } = req.params;
            const { code, order_value = 0, product_ids = [], category_ids = [] } = req.body;

            if (!code) return res.status(400).json({ success: false, error: 'code is required' });

            const result = await pool.query(
                'SELECT * FROM discount_codes WHERE store_id = $1 AND code = $2',
                [storeId, code.trim().toUpperCase()]
            );

            if (!result.rows.length) return res.status(404).json({ success: false, error: 'Invalid coupon code' });

            const coupon = result.rows[0];
            const liveStatus = computeStatus(coupon);

            if (liveStatus === 'scheduled') return res.status(400).json({ success: false, error: 'This offer has not started yet' });
            if (liveStatus === 'expired')   return res.status(400).json({ success: false, error: 'This offer has expired' });
            if (liveStatus === 'disabled')  return res.status(400).json({ success: false, error: 'This offer is no longer active' });

            if (parseFloat(order_value) < parseFloat(coupon.min_order_value)) {
                return res.status(400).json({
                    success: false,
                    error: `Minimum order value ₹${coupon.min_order_value} required`
                });
            }

            // Scope check
            if (coupon.scope === 'product' && coupon.scope_items?.length) {
                const valid = coupon.scope_items.some(id => product_ids.includes(id));
                if (!valid) return res.status(400).json({ success: false, error: 'This offer is not applicable to your cart items' });
            }
            if (coupon.scope === 'category' && coupon.scope_items?.length) {
                const valid = coupon.scope_items.some(id => category_ids.includes(id));
                if (!valid) return res.status(400).json({ success: false, error: 'This offer is not applicable to your cart items' });
            }

            // Calculate discount amount
            let discount = 0;
            const val = parseFloat(coupon.value) || 0;
            const ov = parseFloat(order_value) || 0;
            if (coupon.unit === 'percent') discount = Math.round(ov * val / 100 * 100) / 100;
            else discount = Math.min(val, ov);

            return res.json({
                valid: true,
                success: true,
                discount,
                message: `₹${discount.toFixed(2)} discount applied`,
                coupon: {
                    id: coupon.id, code: coupon.code, name: coupon.name,
                    unit: coupon.unit, value: coupon.value, buy_x_get_y: coupon.buy_x_get_y,
                    scope: coupon.scope
                }
            });
        } catch (err) {
            console.error('[Coupons] validate error:', err);
            return res.status(500).json({ valid: false, success: false, error: 'Validation failed' });
        }
    }

    // GET /api/store/:storeId/coupons/available
    // Public — returns all active coupons eligible for the given cart (no auth needed)
    static async available(req, res) {
        try {
            const { storeId } = req.params;
            const { order_value = 0, product_ids = '', category_ids = '' } = req.query;
            const ov = parseFloat(order_value) || 0;
            const pids = product_ids ? product_ids.split(',').filter(Boolean) : [];
            const cids = category_ids ? category_ids.split(',').filter(Boolean) : [];

            const result = await pool.query(
                `SELECT id, name, type, code, unit, value, min_order_value, scope, scope_items
                 FROM discount_codes
                 WHERE store_id = $1 AND status != 'disabled'
                   AND start_at <= NOW() AND end_at >= NOW()
                   AND (max_uses IS NULL OR current_uses < max_uses)
                 ORDER BY value DESC`,
                [storeId]
            );

            const eligible = result.rows.filter(c => {
                // Scope check
                if (c.scope === 'product' && c.scope_items?.length) {
                    // scope_items now stores pid:vid:sid keys — extract product ids
                    const scopePids = c.scope_items.map(k => k.split(':')[0]);
                    if (!pids.some(p => scopePids.includes(String(p)))) return false;
                }
                if (c.scope === 'category' && c.scope_items?.length) {
                    if (!cids.some(cat => c.scope_items.includes(cat))) return false;
                }
                return true; // include all (even if min_order not met — frontend shows progress bar)
            });

            return res.json({
                success: true,
                coupons: eligible.map(c => ({
                    id: c.id, code: c.code, name: c.name, type: c.type,
                    unit: c.unit, value: parseFloat(c.value),
                    min_order_value: parseFloat(c.min_order_value) || 0,
                    scope: c.scope,
                }))
            });
        } catch (err) {
            console.error('[Coupons] available error:', err);
            return res.status(500).json({ success: false, coupons: [] });
        }
    }
}

module.exports = CouponsController;
