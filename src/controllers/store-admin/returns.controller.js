const pool = require('../../config/database');
const ImageService = require('../../services/imageService');

// ✅ Store Admin's side of returns — the queue, detail view, and the full
// status progression: requested -> approved/rejected -> parcel_received ->
// refund_initiated -> refunded. Rejection is terminal (enforced by the
// order_returns.UNIQUE(order_id) constraint — no resubmission is possible
// at the schema level, not just here).
const STATUS_ORDER = ['requested', 'approved', 'parcel_received', 'refund_initiated', 'refunded'];

const StoreAdminReturnsController = {
    // GET /api/store/:storeId/admin/returns
    getAll: async (req, res) => {
        try {
            const { storeId } = req.params;
            const result = await pool.query(
                `SELECT r.*, o.order_id AS order_number, o.customer_name, o.total_amount, o.items
                 FROM order_returns r
                 JOIN orders o ON o.id = r.order_id
                 WHERE r.store_id = $1
                 ORDER BY r.requested_at DESC`,
                [storeId]
            );
            res.json({ success: true, data: result.rows });
        } catch (error) {
            console.error('❌ Get returns error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get returns' });
        }
    },

    // GET /api/store/:storeId/admin/returns/stats
    getStats: async (req, res) => {
        try {
            const { storeId } = req.params;
            const result = await pool.query(
                `SELECT COUNT(*) FROM order_returns WHERE store_id = $1 AND status = 'requested'`,
                [storeId]
            );
            res.json({ success: true, data: { pending: parseInt(result.rows[0].count, 10) } });
        } catch (error) {
            console.error('❌ Get return stats error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get return stats' });
        }
    },

    // GET /api/store/:storeId/admin/returns/:returnId
    getById: async (req, res) => {
        try {
            const { storeId, returnId } = req.params;
            const result = await pool.query(
                `SELECT r.*, o.order_id AS order_number, o.customer_name, o.customer_phone,
                        o.total_amount, o.items, o.delivery_address, o.delivered_at
                 FROM order_returns r
                 JOIN orders o ON o.id = r.order_id
                 WHERE r.id = $1 AND r.store_id = $2`,
                [returnId, storeId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Return not found' });
            }
            const returnRecord = result.rows[0];

            const photos = await pool.query(
                'SELECT id, storage_path FROM store_images WHERE image_type = $1 AND reference_id = $2 AND is_active = true',
                ['RETURN', returnRecord.id]
            );
            const photosWithUrls = photos.rows.map((p) => ({ id: p.id, url: ImageService.getImageUrl(storeId, p.storage_path) }));

            res.json({ success: true, data: { ...returnRecord, photos: photosWithUrls } });
        } catch (error) {
            console.error('❌ Get return detail error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get return detail' });
        }
    },

    // PUT /api/store/:storeId/admin/returns/:returnId/approve
    // body: { operatorComment?, courierName?, trackingNumber?, pickupDate? }
    // courier fields are for the merchant-pays flow — ignored (harmless if
    // sent) for customer-pays, where the customer submits their own later.
    approve: async (req, res) => {
        try {
            const { storeId, returnId } = req.params;
            const { operatorComment, courierName, trackingNumber, pickupDate } = req.body;

            const existing = await pool.query('SELECT * FROM order_returns WHERE id = $1 AND store_id = $2', [returnId, storeId]);
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Return not found' });
            }
            const returnRecord = existing.rows[0];
            if (returnRecord.status !== 'requested') {
                return res.status(400).json({ success: false, error: 'Only a pending return can be approved' });
            }

            if (returnRecord.return_shipping_method === 'merchant-pays' && (!courierName || !trackingNumber)) {
                return res.status(400).json({ success: false, error: 'Courier name and tracking number are required for a merchant-arranged pickup' });
            }

            const result = await pool.query(
                `UPDATE order_returns
                 SET status = 'approved', approved_at = NOW(), operator_comment = $1,
                     courier_name = $2, tracking_number = $3, pickup_date = $4, updated_at = NOW()
                 WHERE id = $5
                 RETURNING *`,
                [operatorComment || null, courierName || null, trackingNumber || null, pickupDate || null, returnId]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Approve return error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to approve return' });
        }
    },

    // PUT /api/store/:storeId/admin/returns/:returnId/reject
    // body: { rejectReason }
    reject: async (req, res) => {
        try {
            const { storeId, returnId } = req.params;
            const { rejectReason } = req.body;

            if (!rejectReason || !rejectReason.trim()) {
                return res.status(400).json({ success: false, error: 'Please provide a reason for rejecting this return' });
            }

            const existing = await pool.query('SELECT * FROM order_returns WHERE id = $1 AND store_id = $2', [returnId, storeId]);
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Return not found' });
            }
            if (existing.rows[0].status !== 'requested') {
                return res.status(400).json({ success: false, error: 'Only a pending return can be rejected' });
            }

            const result = await pool.query(
                `UPDATE order_returns SET status = 'rejected', rejected_at = NOW(), reject_reason = $1, updated_at = NOW()
                 WHERE id = $2 RETURNING *`,
                [rejectReason.trim(), returnId]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Reject return error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to reject return' });
        }
    },

    // PUT /api/store/:storeId/admin/returns/:returnId/status
    // body: { status } — one of parcel_received, refund_initiated, refunded.
    // Enforces the linear order: each step can only move to the very next
    // one, never skipped or reversed.
    updateStatus: async (req, res) => {
        try {
            const { storeId, returnId } = req.params;
            const { status } = req.body;

            const validNextSteps = ['parcel_received', 'refund_initiated', 'refunded'];
            if (!validNextSteps.includes(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }

            const existing = await pool.query('SELECT * FROM order_returns WHERE id = $1 AND store_id = $2', [returnId, storeId]);
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Return not found' });
            }
            const current = existing.rows[0].status;
            const currentIndex = STATUS_ORDER.indexOf(current);
            const targetIndex = STATUS_ORDER.indexOf(status);

            if (targetIndex !== currentIndex + 1) {
                return res.status(400).json({
                    success: false,
                    error: `Can't move to "${status}" from "${current}" — steps must happen in order`,
                });
            }

            const timestampColumn = {
                parcel_received: 'parcel_received_at',
                refund_initiated: 'refund_initiated_at',
                refunded: 'refunded_at',
            }[status];

            const result = await pool.query(
                `UPDATE order_returns SET status = $1, ${timestampColumn} = NOW(), updated_at = NOW()
                 WHERE id = $2 RETURNING *`,
                [status, returnId]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Update return status error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to update return status' });
        }
    },
};

module.exports = StoreAdminReturnsController;
