const cron = require('node-cron');
const courierService = require('../services/courierService');
const db = require('../config/database');

// Run every 60 minutes
cron.schedule('*/60 * * * *', async () => {
    console.log('🔄 Running tracking update job...');
    
    try {
        // Get all orders with tracking numbers that need updating
        const orders = await db.query(
            `SELECT * FROM order_tracking 
             WHERE auto_update = true 
             AND last_status != 'delivered'
             AND last_status != 'failed'
             AND updated_at < NOW() - INTERVAL '30 minutes'`
        );
        
        console.log(`📦 Found ${orders.rows.length} orders to update`);
        
        for (const order of orders.rows) {
            try {
                const status = await courierService.getTrackingStatus(
                    order.courier_name,
                    order.tracking_number
                );
                
                // Only update if status changed
                if (status.status !== order.last_status) {
                    await db.query(
                        `UPDATE order_tracking 
                         SET last_status = $1, 
                             last_status_message = $2,
                             status_details = jsonb_set(
                                 status_details, 
                                 '{events}', 
                                 COALESCE($3, '[]'::jsonb)
                             ),
                             last_checked = NOW(),
                             updated_at = NOW()
                         WHERE id = $4`,
                        [
                            status.status, 
                            status.message, 
                            JSON.stringify(status.events || []),
                            order.id
                        ]
                    );
                    
                    console.log(`📬 Updated tracking for ${order.order_id}: ${order.last_status} → ${status.status}`);
                    
                    // ✅ FIX: was UPDATE orders SET order_status = ... — that
                    // column has never existed on the real orders table (it's
                    // `status`), so this silently failed with a SQL error
                    // every single time the automatic job tried to mark an
                    // order delivered. Only the manual "Refresh Now" button
                    // (fixed separately) ever actually worked before this.
                    if (status.status === 'delivered') {
                        const orderResult = await db.query(
                            `UPDATE orders 
                             SET status = 'delivered', 
                                 delivered_at = NOW(),
                                 updated_at = NOW()
                             WHERE order_id = $1
                             RETURNING id`,
                            [order.order_id]
                        );
                        if (orderResult.rows.length > 0) {
                            await db.query(
                                `INSERT INTO order_status_history (order_id, status, changed_by, notes)
                                 VALUES ($1, 'delivered', 'courier-tracking', 'Auto-detected as delivered via courier tracking')`,
                                [orderResult.rows[0].id]
                            );
                        }
                        console.log(`✅ Order ${order.order_id} marked as delivered!`);
                    }
                } else {
                    // Just update last_checked
                    await db.query(
                        `UPDATE order_tracking 
                         SET last_checked = NOW()
                         WHERE id = $1`,
                        [order.id]
                    );
                }
            } catch (error) {
                console.error(`❌ Failed to update ${order.order_id}:`, error.message);
            }
        }
        
        console.log('✅ Tracking update job completed!');
    } catch (error) {
        console.error('❌ Job error:', error);
    }
});

console.log('🕐 Tracking auto-update job scheduled (every 60 minutes)');

module.exports = cron;
