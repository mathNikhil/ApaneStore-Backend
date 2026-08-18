const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyWebhookSignature, getSettings } = require('../services/paymentGateway.service');

// POST /api/webhooks/cashfree
// Cashfree calls this after payment — verifies signature, marks store live
router.post('/cashfree', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-webhook-signature'];
        const rawBody = req.body.toString();
        const settings = await getSettings();

        if (!verifyWebhookSignature(rawBody, signature, settings.cashfree_secret_key)) {
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }

        const event = JSON.parse(rawBody);
        const { type, data } = event;

        if (type === 'PAYMENT_SUCCESS') {
            const orderId = data.order.order_id;
            // orderId format: store_{storeId}_{timestamp}
            const storeId = orderId.split('_')[1];

            // Get subscription info from pending_payments table
            const pendingResult = await pool.query(
                'SELECT * FROM pending_payments WHERE order_id = $1',
                [orderId]
            );

            if (pendingResult.rows.length > 0) {
                const pending = pendingResult.rows[0];

                // Create subscription
                await pool.query(
                    `INSERT INTO store_subscriptions
                        (store_id, plan_key, plan_name, billing_cycle, base_amount, tax_amount, total_amount, payment_status, payment_method, paid_at, valid_until, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', 'cashfree', NOW(), NOW() + ($8 || ' days')::interval, NOW())
                     ON CONFLICT (store_id) DO UPDATE
                     SET plan_key=$2, plan_name=$3, billing_cycle=$4, base_amount=$5, tax_amount=$6, total_amount=$7,
                         payment_status='paid', payment_method='cashfree', paid_at=NOW(),
                         valid_until=NOW() + ($8 || ' days')::interval, updated_at=NOW()`,
                    [storeId, pending.plan_key, pending.plan_name, pending.billing_cycle,
                     pending.base_amount, pending.tax_amount, pending.total_amount, pending.validity_days]
                );

                // Mark store live
                await pool.query(
                    "UPDATE stores SET status='published', published_at=NOW(), updated_at=NOW() WHERE id=$1",
                    [storeId]
                );

                // Mark payment done
                await pool.query(
                    "UPDATE pending_payments SET status='completed', updated_at=NOW() WHERE order_id=$1",
                    [orderId]
                );
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
