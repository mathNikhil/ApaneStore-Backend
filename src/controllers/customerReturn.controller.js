const pool = require('../config/database');
const ImageService = require('../services/imageService');

// ✅ Real return requests — replaces the fake alert('Return request
// submitted!') on the storefront. Enforces the actual policy the tenant
// configured in Step 8 (enabled, window, allowed reasons, photo
// requirement) rather than the hardcoded defaults the storefront was
// silently running on before that screen's save bug was fixed.
//
// ✅ FIX: every lookup here now matches on orders.order_id (the string
// "ORD-..." the frontend actually identifies orders by) instead of
// orders.id (the UUID primary key) — the frontend never sends the UUID at
// all, so `WHERE id = $1` was throwing "invalid input syntax for type
// uuid" the moment a customer tried to submit a real return. Once the
// order row is found, its real UUID (order.id) is what's used for
// anything that needs the actual foreign key, like order_returns.order_id.
const CustomerReturnController = {
    // POST /api/store/:storeId/orders/:orderId/return
    // body: { reason }
    create: async (req, res) => {
        try {
            const { storeId, orderId } = req.params; // orderId here is the string order_id (ORD-...)
            const { customerId } = req.customer;
            const { reason } = req.body;

            if (!reason) {
                return res.status(400).json({ success: false, error: 'A return reason is required' });
            }

            const orderResult = await pool.query(
                'SELECT * FROM orders WHERE order_id = $1 AND store_id = $2 AND customer_id = $3',
                [orderId, storeId, customerId]
            );
            if (orderResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }
            const order = orderResult.rows[0];

            if (order.status !== 'delivered') {
                return res.status(400).json({ success: false, error: 'Only delivered orders can be returned' });
            }

            const storeResult = await pool.query('SELECT config FROM stores WHERE id = $1', [storeId]);
            const returnConfig = storeResult.rows[0]?.config?.return || {};

            if (returnConfig.isEnabled === false) {
                return res.status(400).json({ success: false, error: 'Returns are not enabled for this store' });
            }

            const windowDays = returnConfig.returnWindowDays || 7;
            if (!order.delivered_at) {
                return res.status(400).json({ success: false, error: 'This order cannot be returned yet' });
            }
            const daysSinceDelivery = (Date.now() - new Date(order.delivered_at).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceDelivery > windowDays) {
                return res.status(400).json({ success: false, error: `The ${windowDays}-day return window for this order has passed` });
            }

            if (Array.isArray(returnConfig.allowedReasons) && returnConfig.allowedReasons.length > 0 && !returnConfig.allowedReasons.includes(reason)) {
                return res.status(400).json({ success: false, error: 'Please select a valid return reason' });
            }

            const existing = await pool.query('SELECT id FROM order_returns WHERE order_id = $1', [order.id]);
            if (existing.rows.length > 0) {
                return res.status(400).json({ success: false, error: 'A return has already been requested for this order' });
            }

            const returnId = `RET-${Date.now()}`;

            const result = await pool.query(
                `INSERT INTO order_returns (return_id, order_id, store_id, reason, status, return_shipping_method)
                 VALUES ($1, $2, $3, $4, 'requested', $5)
                 RETURNING *`,
                [returnId, order.id, storeId, reason, returnConfig.returnShippingMethod || 'customer-pays']
            );

            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Create return error:', error);
            if (error.code === '23505') { // unique_violation, e.g. a race on the same order
                return res.status(400).json({ success: false, error: 'A return has already been requested for this order' });
            }
            res.status(500).json({ success: false, error: error.message || 'Failed to request return' });
        }
    },

    // POST /api/store/:storeId/orders/:orderId/return/photos
    // multipart/form-data with an "image" file. Reuses the exact same
    // ImageService.processAndSaveImage() core that product/category
    // uploads use — the only new thing is resolving tenant_id server-side
    // (the customer's session only ever has storeId, never a tenantId).
    uploadPhoto: async (req, res) => {
        try {
            const { storeId, orderId } = req.params;
            const { customerId } = req.customer;

            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No image file provided' });
            }

            const orderCheck = await pool.query(
                'SELECT id FROM orders WHERE order_id = $1 AND store_id = $2 AND customer_id = $3',
                [orderId, storeId, customerId]
            );
            if (orderCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }
            const orderUuid = orderCheck.rows[0].id;

            const returnResult = await pool.query('SELECT id FROM order_returns WHERE order_id = $1', [orderUuid]);
            if (returnResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Please request the return before uploading photos' });
            }
            const returnRecordId = returnResult.rows[0].id;

            const storeResult = await pool.query('SELECT tenant_id FROM stores WHERE id = $1', [storeId]);
            if (storeResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }
            const tenantId = storeResult.rows[0].tenant_id;

            const result = await ImageService.processAndSaveImage(
                req.file,
                'RETURN',
                tenantId,
                storeId,
                returnRecordId
            );

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            console.error('❌ Upload return photo error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to upload photo' });
        }
    },

    // GET /api/store/:storeId/orders/:orderId/return
    getForOrder: async (req, res) => {
        try {
            const { storeId, orderId } = req.params;
            const { customerId } = req.customer;

            const orderCheck = await pool.query(
                'SELECT id FROM orders WHERE order_id = $1 AND store_id = $2 AND customer_id = $3',
                [orderId, storeId, customerId]
            );
            if (orderCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }
            const orderUuid = orderCheck.rows[0].id;

            const returnResult = await pool.query('SELECT * FROM order_returns WHERE order_id = $1', [orderUuid]);
            if (returnResult.rows.length === 0) {
                return res.json({ success: true, data: null });
            }
            const returnRecord = returnResult.rows[0];

            const photos = await pool.query(
                'SELECT id, storage_path FROM store_images WHERE image_type = $1 AND reference_id = $2 AND is_active = true',
                ['RETURN', returnRecord.id]
            );
            const photosWithUrls = photos.rows.map((p) => ({ id: p.id, url: ImageService.getImageUrl(storeId, p.storage_path) }));

            res.json({ success: true, data: { ...returnRecord, photos: photosWithUrls } });
        } catch (error) {
            console.error('❌ Get return error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get return status' });
        }
    },

    // PUT /api/store/:storeId/orders/:orderId/return/customer-shipping
    // Only for the customer-pays flow: customer shares their own courier +
    // tracking number once their return has been approved.
    // body: { courierName, trackingNumber }
    submitCustomerShipping: async (req, res) => {
        try {
            const { storeId, orderId } = req.params;
            const { customerId } = req.customer;
            const { courierName, trackingNumber } = req.body;

            if (!courierName || !trackingNumber) {
                return res.status(400).json({ success: false, error: 'Courier name and tracking number are required' });
            }

            const orderCheck = await pool.query(
                'SELECT id FROM orders WHERE order_id = $1 AND store_id = $2 AND customer_id = $3',
                [orderId, storeId, customerId]
            );
            if (orderCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }
            const orderUuid = orderCheck.rows[0].id;

            const returnResult = await pool.query('SELECT * FROM order_returns WHERE order_id = $1', [orderUuid]);
            if (returnResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'No return found for this order' });
            }
            const returnRecord = returnResult.rows[0];

            if (returnRecord.status !== 'approved') {
                return res.status(400).json({ success: false, error: 'This return has not been approved yet' });
            }
            if (returnRecord.return_shipping_method !== 'customer-pays') {
                return res.status(400).json({ success: false, error: 'This return is being picked up by the store — no need to share tracking yourself' });
            }

            const result = await pool.query(
                `UPDATE order_returns SET customer_courier_name = $1, customer_tracking_number = $2, updated_at = NOW()
                 WHERE id = $3 RETURNING *`,
                [courierName, trackingNumber, returnRecord.id]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Submit customer shipping error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to save shipping details' });
        }
    },
};

module.exports = CustomerReturnController;
