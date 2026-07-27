const db = require('../config/database');
const courierService = require('../services/courierService');

class TrackingController {
    // Get courier list
    async getCourierList(req, res) {
        try {
            const couriers = courierService.getCourierList();
            res.json({ success: true, data: couriers });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // Add tracking
    async addTracking(req, res) {
        try {
            const { orderId, courierName, trackingNumber, courierNotes } = req.body;
            const storeId = req.body.storeId || 1;

            if (!orderId || !courierName || !trackingNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Order ID, Courier Name, and Tracking Number are required'
                });
            }

            // Check if tracking already exists
            const existing = await db.query(
                'SELECT * FROM order_tracking WHERE order_id = $1',
                [orderId]
            );

            if (existing.rows.length > 0) {
                await db.query(
                    `UPDATE order_tracking 
                     SET courier_name = $1, 
                         tracking_number = $2,
                         courier_notes = $3,
                         updated_at = NOW()
                     WHERE order_id = $4`,
                    [courierName, trackingNumber, courierNotes, orderId]
                );
            } else {
                await db.query(
                    `INSERT INTO order_tracking (order_id, store_id, courier_name, tracking_number, courier_notes)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [orderId, storeId, courierName, trackingNumber, courierNotes]
                );
            }

            // Update order status
            await db.query(
                `UPDATE orders SET order_status = 'shipped', shipped_at = NOW()
                 WHERE order_id = $1`,
                [orderId]
            );

            res.json({
                success: true,
                message: 'Tracking details added successfully',
                data: { orderId, courierName, trackingNumber }
            });

        } catch (error) {
            console.error('Add tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // Bulk add tracking
    async bulkAddTracking(req, res) {
        try {
            const { trackingData } = req.body;
            const storeId = req.body.storeId || 1;

            if (!trackingData || !Array.isArray(trackingData) || trackingData.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Please provide tracking data array'
                });
            }

            const results = [];
            const errors = [];

            for (const item of trackingData) {
                try {
                    const { orderId, courierName, trackingNumber } = item;

                    if (!orderId || !courierName || !trackingNumber) {
                        errors.push({ orderId, error: 'Missing required fields' });
                        continue;
                    }

                    const existing = await db.query(
                        'SELECT * FROM order_tracking WHERE order_id = $1',
                        [orderId]
                    );

                    if (existing.rows.length > 0) {
                        await db.query(
                            `UPDATE order_tracking 
                             SET courier_name = $1, 
                                 tracking_number = $2,
                                 updated_at = NOW()
                             WHERE order_id = $3`,
                            [courierName, trackingNumber, orderId]
                        );
                    } else {
                        await db.query(
                            `INSERT INTO order_tracking (order_id, store_id, courier_name, tracking_number)
                             VALUES ($1, $2, $3, $4)`,
                            [orderId, storeId, courierName, trackingNumber]
                        );
                    }

                    await db.query(
                        `UPDATE orders SET order_status = 'shipped', shipped_at = NOW()
                         WHERE order_id = $1`,
                        [orderId]
                    );

                    results.push({ orderId, success: true, trackingNumber });

                } catch (error) {
                    errors.push({ orderId: item.orderId, error: error.message });
                }
            }

            res.json({
                success: true,
                message: `Processed ${results.length} orders, ${errors.length} errors`,
                data: { success: results, errors }
            });

        } catch (error) {
            console.error('Bulk add tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // Get tracking for an order
    async getTracking(req, res) {
        try {
            const { orderId } = req.params;

            const tracking = await db.query(
                `SELECT * FROM order_tracking WHERE order_id = $1`,
                [orderId]
            );

            if (tracking.rows.length === 0) {
                return res.json({
                    success: true,
                    data: { status: 'pending', message: 'No tracking information available' }
                });
            }

            res.json({
                success: true,
                data: tracking.rows[0]
            });

        } catch (error) {
            console.error('Get tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // Get all tracking for a store
    async getStoreTracking(req, res) {
        try {
            const { storeId } = req.params;

            const tracking = await db.query(
                `SELECT t.*, o.customer_name, o.order_total, o.order_status 
                 FROM order_tracking t
                 JOIN orders o ON t.order_id = o.order_id
                 WHERE t.store_id = $1
                 ORDER BY t.created_at DESC`,
                [storeId]
            );

            res.json({
                success: true,
                data: tracking.rows
            });

        } catch (error) {
            console.error('Get store tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // Refresh tracking
    async refreshTracking(req, res) {
        try {
            const { orderId } = req.params;

            const tracking = await db.query(
                'SELECT * FROM order_tracking WHERE order_id = $1',
                [orderId]
            );

            if (tracking.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No tracking found for this order'
                });
            }

            // Update last checked time
            await db.query(
                `UPDATE order_tracking 
                 SET last_checked = NOW(),
                     updated_at = NOW()
                 WHERE order_id = $1`,
                [orderId]
            );

            res.json({
                success: true,
                message: 'Tracking refreshed successfully',
                data: tracking.rows[0]
            });

        } catch (error) {
            console.error('Refresh tracking error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = new TrackingController();