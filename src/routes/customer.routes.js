const validate = require('../middleware/validate');
const express = require('express');
const router = express.Router({ mergeParams: true });
const CustomerController = require('../controllers/customer.controller');

// Mounted at /api/store/:storeId/auth — public, this is the login itself
router.post('/otp/send', validate('customerSendOTP'), CustomerController.sendOTP);
router.post('/otp/verify', validate('customerVerifyOTP'), CustomerController.verifyOTP);


// POST /api/store/:storeId/cashfree/create-order
// Creates a Cashfree payment session for storefront checkout
router.post('/:storeId/cashfree/create-order', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { orderId, amount, customerPhone, customerName, customerEmail, orderData } = req.body;

        const pool = require('../config/database');

        // Get store's Cashfree credentials
        const gatewayResult = await pool.query(
            `SELECT spga.encrypted_api_key, spga.encrypted_secret_key, spga.gateway_mode
             FROM store_payment_gateway_accounts spga
             JOIN payment_gateways pg ON pg.id = spga.gateway_id
             WHERE spga.store_id = $1 AND pg.gateway_key = 'cashfree' AND spga.is_enabled = true`,
            [storeId]
        );

        if (gatewayResult.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Cashfree not configured for this store' });
        }

        const { decrypt } = require('../utils/encryption');
        const creds = gatewayResult.rows[0];
        const appId = decrypt(creds.encrypted_api_key);
        const secretKey = decrypt(creds.encrypted_secret_key);
        const mode = creds.gateway_mode || 'sandbox';

        const baseUrl = mode === 'production'
            ? 'https://api.cashfree.com/pg/orders'
            : 'https://sandbox.cashfree.com/pg/orders';

        // Save pending order data for webhook to use
        await pool.query(
            `INSERT INTO cashfree_pending_orders (order_id, store_id, order_data, amount, status, created_at)
             VALUES ($1, $2, $3, $4, 'pending', NOW())
             ON CONFLICT (order_id) DO UPDATE SET order_data = $3, updated_at = NOW()`,
            [orderId, storeId, JSON.stringify(orderData || {}), amount]
        ).catch(() => {}); // Table may not exist yet, handle gracefully

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': appId,
                'x-client-secret': secretKey,
            },
            body: JSON.stringify({
                order_id: orderId,
                order_amount: parseFloat(amount),
                order_currency: 'INR',
                customer_details: {
                    customer_id: customerPhone || 'guest',
                    customer_phone: customerPhone || '9999999999',
                    customer_name: customerName || 'Customer',
                    customer_email: customerEmail || 'customer@store.com',
                },
                order_meta: {
                    notify_url: `https://api.aapnaestore.com/api/webhooks/store-payment/${storeId}`,
                },
            }),
        });

        const data = await response.json();

        if (!data.payment_session_id) {
            console.error('Cashfree error:', data);
            return res.status(400).json({ success: false, error: data.message || 'Failed to create payment session' });
        }

        res.json({ success: true, data: { paymentSessionId: data.payment_session_id, orderId, mode } });
    } catch (e) {
        console.error('Cashfree create-order error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
