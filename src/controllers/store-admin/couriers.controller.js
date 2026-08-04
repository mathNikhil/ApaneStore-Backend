const pool = require('../../config/database');
const courierService = require('../../services/courierService');

// ✅ Tenant-managed courier list, self-service from Store Admin — no Super
// Admin involvement, matching the design discussion: a tenant realistically
// uses 1-3 couriers, so they set up their own short list once instead of
// retyping courier details on every single order.
const StoreAdminCouriersController = {
    // GET /api/store/:storeId/admin/couriers
    getAll: async (req, res) => {
        try {
            const { storeId } = req.params;
            const result = await pool.query(
                'SELECT * FROM store_couriers WHERE store_id = $1 ORDER BY courier_name',
                [storeId]
            );
            res.json({ success: true, data: result.rows });
        } catch (error) {
            console.error('❌ Get couriers error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get couriers' });
        }
    },

    // POST /api/store/:storeId/admin/couriers
    // body: { courierName, trackingUrlTemplate? }
    create: async (req, res) => {
        try {
            const { storeId } = req.params;
            const { courierName, trackingUrlTemplate } = req.body;

            if (!courierName || !courierName.trim()) {
                return res.status(400).json({ success: false, error: 'Courier name is required' });
            }

            // If this name matches one of the couriers we can actually
            // auto-track today, remember that key — otherwise it's saved
            // as a custom courier (still usable, just not auto-tracked yet
            // until a scraper exists for it).
            const knownKey = courierService.getCourierList()
                .find(c => c.name.toLowerCase() === courierName.trim().toLowerCase())?.value || null;

            const result = await pool.query(
                `INSERT INTO store_couriers (store_id, courier_name, tracking_url_template, auto_track_key)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (store_id, courier_name) DO UPDATE
                 SET tracking_url_template = $3, auto_track_key = $4
                 RETURNING *`,
                [storeId, courierName.trim(), trackingUrlTemplate || null, knownKey]
            );

            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Create courier error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to save courier' });
        }
    },

    // DELETE /api/store/:storeId/admin/couriers/:courierId
    delete: async (req, res) => {
        try {
            const { storeId, courierId } = req.params;
            await pool.query(
                'DELETE FROM store_couriers WHERE id = $1 AND store_id = $2',
                [courierId, storeId]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('❌ Delete courier error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to delete courier' });
        }
    },
};

module.exports = StoreAdminCouriersController;
