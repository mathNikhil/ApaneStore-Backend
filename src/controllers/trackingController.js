const pool = require('../config/database');
const courierService = require('../services/courierService');

// ✅ Rewritten from the original trackingController.js. Fixes, in order of
// how they were found:
//  - Was mountable with NO auth at all and trusted req.body.storeId
//    (defaulting to store 1 if omitted) — meant anyone could tamper with
//    any store's tracking data. Now every function takes storeId/orderId
//    from the URL, which only resolves through the already-authenticated
//    store-admin route it's mounted under.
//  - Referenced orders.order_status/shipped_at/order_total, none of which
//    existed on the real orders table (it uses status/total_amount, and
//    shipped_at/delivered_at have now been added).
//  - refreshTracking looked like it worked but never actually called the
//    scraper — just touched a timestamp. Now it does the real thing.
class TrackingController {
    // GET /api/tracking/couriers — public, just static config
    async getCourierList(req, res) {
        try {
            const couriers = courierService.getCourierList();
            res.json({ success: true, data: couriers });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/store/:storeId/admin/orders/:orderId/tracking
    // body: { courierName, trackingNumber, courierNotes? }
    // :orderId is the order's UUID (matches the rest of store-admin/orders routes)
    async addTracking(req, res) {
        try {
            const { storeId, orderId } = req.params;
            const { courierName, trackingNumber, courierNotes } = req.body;
            const adminId = req.adminId || req.tenantId;

            if (!courierName || !trackingNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Courier name and tracking number are required',
                });
            }

            const orderResult = await pool.query(
                'SELECT order_id FROM orders WHERE id = $1 AND store_id = $2',
                [orderId, storeId]
            );
            if (orderResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }
            const orderIdStr = orderResult.rows[0].order_id;

            const existing = await pool.query(
                'SELECT id FROM order_tracking WHERE order_id = $1',
                [orderIdStr]
            );

            if (existing.rows.length > 0) {
                await pool.query(
                    `UPDATE order_tracking
                     SET courier_name = $1, tracking_number = $2, courier_notes = $3, updated_at = NOW()
                     WHERE order_id = $4`,
                    [courierName, trackingNumber, courierNotes || null, orderIdStr]
                );
            } else {
                await pool.query(
                    `INSERT INTO order_tracking (order_id, store_id, courier_name, tracking_number, courier_notes, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [orderIdStr, storeId, courierName, trackingNumber, courierNotes || null, adminId]
                );
            }

            // Move the order itself to out_for_delivery, matching the
            // real allowed status list used by updateStatus.
            await pool.query(
                `UPDATE orders SET status = 'out_for_delivery', shipped_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [orderId]
            );
            await pool.query(
                `INSERT INTO order_status_history (order_id, status, changed_by, notes)
                 VALUES ($1, 'out_for_delivery', $2, $3)`,
                [orderId, adminId, `Shipped via ${courierName}, tracking #${trackingNumber}`]
            );

            res.json({
                success: true,
                message: 'Tracking details added successfully',
                data: { orderId: orderIdStr, courierName, trackingNumber },
            });
        } catch (error) {
            console.error('❌ Add tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/store/:storeId/admin/orders/:orderId/tracking
    async getTracking(req, res) {
        try {
            const { storeId, orderId } = req.params;

            const orderResult = await pool.query(
                'SELECT order_id FROM orders WHERE id = $1 AND store_id = $2',
                [orderId, storeId]
            );
            if (orderResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }

            const tracking = await pool.query(
                'SELECT * FROM order_tracking WHERE order_id = $1',
                [orderResult.rows[0].order_id]
            );

            if (tracking.rows.length === 0) {
                return res.json({
                    success: true,
                    data: { status: 'pending', message: 'No tracking information available yet' },
                });
            }

            res.json({ success: true, data: tracking.rows[0] });
        } catch (error) {
            console.error('❌ Get tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/store/:storeId/admin/orders/tracking — all tracked orders for the store
    async getStoreTracking(req, res) {
        try {
            const { storeId } = req.params;

            const tracking = await pool.query(
                `SELECT t.*, o.customer_name, o.total_amount, o.status AS order_status
                 FROM order_tracking t
                 JOIN orders o ON t.order_id = o.order_id
                 WHERE t.store_id = $1
                 ORDER BY t.created_at DESC`,
                [storeId]
            );

            res.json({ success: true, data: tracking.rows });
        } catch (error) {
            console.error('❌ Get store tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/store/:storeId/admin/orders/:orderId/tracking/refresh
    // ✅ FIX: this used to just update a timestamp and return the same
    // stale row — now it actually calls the scraper and saves what comes
    // back, same as the automatic cron job does.
    async refreshTracking(req, res) {
        try {
            const { storeId, orderId } = req.params;

            const orderResult = await pool.query(
                'SELECT order_id FROM orders WHERE id = $1 AND store_id = $2',
                [orderId, storeId]
            );
            if (orderResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }
            const orderIdStr = orderResult.rows[0].order_id;

            const existing = await pool.query(
                'SELECT * FROM order_tracking WHERE order_id = $1',
                [orderIdStr]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'No tracking found for this order' });
            }
            const record = existing.rows[0];

            const status = await courierService.getTrackingStatus(record.courier_name, record.tracking_number);

            const updateResult = await pool.query(
                `UPDATE order_tracking
                 SET last_status = $1, last_status_message = $2,
                     status_details = jsonb_set(status_details, '{events}', COALESCE($3, '[]'::jsonb)),
                     last_checked = NOW(), updated_at = NOW()
                 WHERE id = $4
                 RETURNING *`,
                [status.status, status.message, JSON.stringify(status.events || []), record.id]
            );

            if (status.status === 'delivered') {
                await pool.query(
                    `UPDATE orders SET status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = $1`,
                    [orderId]
                );
                await pool.query(
                    `INSERT INTO order_status_history (order_id, status, changed_by, notes)
                     VALUES ($1, 'delivered', 'courier-tracking', 'Auto-detected as delivered via courier tracking')`,
                    [orderId]
                );
            }

            res.json({
                success: true,
                message: 'Tracking refreshed successfully',
                data: updateResult.rows[0],
            });
        } catch (error) {
            console.error('❌ Refresh tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/store/:storeId/orders/:orderId/tracking — customer-facing,
    // read-only (mounted separately under customerAuth, see customerOrder.routes.js)
    async getCustomerTracking(req, res) {
        try {
            const { storeId, orderId } = req.params;
            const { customerId } = req.customer;

            const orderResult = await pool.query(
                'SELECT order_id FROM orders WHERE id = $1 AND store_id = $2 AND customer_id = $3',
                [orderId, storeId, customerId]
            );
            if (orderResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }

            const tracking = await pool.query(
                'SELECT courier_name, tracking_number, tracking_url, last_status, last_status_message, last_checked, status_details, estimated_delivery FROM order_tracking WHERE order_id = $1',
                [orderResult.rows[0].order_id]
            );

            if (tracking.rows.length === 0) {
                return res.json({ success: true, data: null });
            }

            res.json({ success: true, data: tracking.rows[0] });
        } catch (error) {
            console.error('❌ Get customer tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = new TrackingController();
