const pool = require('../config/database');
const logger = require('../config/logger');
const { encrypt, decrypt } = require('../utils/encryption');

const CASHFREE_API_BASE = process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';

const PaymentGatewayController = {

    // GET /api/stores/:id/payment-gateways
    listStoreGateways: async (req, res) => {
        try {
            const { id: storeId } = req.params;
            const tenantId = req.tenantId;

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [storeId, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const result = await pool.query(
                `SELECT spga.id, pg.gateway_key, pg.display_name,
                        spga.account_identifier, spga.kyc_status, spga.is_enabled,
                        spga.gateway_mode,
                        spga.encrypted_api_key,
                        spga.encrypted_secret_key,
                        CASE WHEN spga.encrypted_api_key IS NOT NULL THEN true ELSE false END as has_api_key,
                        CASE WHEN spga.encrypted_secret_key IS NOT NULL THEN true ELSE false END as has_secret_key
                 FROM store_payment_gateway_accounts spga
                 JOIN payment_gateways pg ON pg.id = spga.gateway_id
                 WHERE spga.store_id = $1`,
                [storeId]
            );

            // Decrypt first 2 chars only for display hint
            const { decrypt } = require('../utils/encryption');
            const rows = result.rows.map(row => {
                let apiKeyHint = null;
                let secretKeyHint = null;
                try { if (row.encrypted_api_key) apiKeyHint = decrypt(row.encrypted_api_key).substring(0, 4); } catch(e) {}
                try { if (row.encrypted_secret_key) secretKeyHint = decrypt(row.encrypted_secret_key).substring(0, 4); } catch(e) {}
                const { encrypted_api_key, encrypted_secret_key, ...rest } = row;
                return { ...rest, api_key_hint: apiKeyHint, secret_key_hint: secretKeyHint };
            });

            res.json({ success: true, data: rows });
        } catch (error) {
            logger.error('List store gateways error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // POST /api/stores/:id/payment-gateway/cashfree/keys
    // Save encrypted Cashfree API keys
    saveCashfreeKeys: async (req, res) => {
        try {
            const { id: storeId } = req.params;
            const tenantId = req.tenantId;
            const { appId, secretKey, mode } = req.body;

            if (!appId || !secretKey) {
                return res.status(400).json({ success: false, error: 'App ID and Secret Key are required' });
            }

            // Verify store belongs to tenant
            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [storeId, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            // Get Cashfree gateway ID
            const gatewayResult = await pool.query(
                "SELECT id FROM payment_gateways WHERE gateway_key = 'cashfree'",
            );
            if (gatewayResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Cashfree gateway not found' });
            }
            const gatewayId = gatewayResult.rows[0].id;

            // Encrypt keys
            const encryptedApiKey = encrypt(appId);
            const encryptedSecretKey = encrypt(secretKey);
            const gatewayMode = mode || 'sandbox';

            // Upsert
            await pool.query(
                `INSERT INTO store_payment_gateway_accounts
                    (store_id, gateway_id, account_identifier, encrypted_api_key, encrypted_secret_key,
                     gateway_mode, kyc_status, is_enabled, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'approved', true, NOW())
                 ON CONFLICT (store_id, gateway_id) DO UPDATE
                 SET encrypted_api_key = $4, encrypted_secret_key = $5,
                     account_identifier = $3, gateway_mode = $6,
                     is_enabled = true, updated_at = NOW()`,
                [storeId, gatewayId, appId, encryptedApiKey, encryptedSecretKey, gatewayMode]
            );

            logger.info('Cashfree keys saved for store ' + storeId);
            res.json({ success: true, message: 'Cashfree configured successfully' });
        } catch (error) {
            logger.error('Save Cashfree keys error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // POST /api/store/:storeId/cashfree/create-order
    // Create Cashfree payment order — called at customer checkout
    createCashfreeOrder: async (req, res) => {
        try {
            const { storeId } = req.params;
            const { amount, orderId, customerName, customerEmail, customerPhone } = req.body;

            // Get encrypted keys for this store
            const result = await pool.query(
                `SELECT spga.encrypted_api_key, spga.encrypted_secret_key, spga.gateway_mode
                 FROM store_payment_gateway_accounts spga
                 JOIN payment_gateways pg ON pg.id = spga.gateway_id
                 WHERE spga.store_id = $1 AND pg.gateway_key = 'cashfree' AND spga.is_enabled = true`,
                [storeId]
            );

            if (result.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Cashfree not configured for this store' });
            }

            const { encrypted_api_key, encrypted_secret_key, gateway_mode } = result.rows[0];
            const appId = decrypt(encrypted_api_key);
            const secretKey = decrypt(encrypted_secret_key);

            const apiBase = gateway_mode === 'production'
                ? 'https://api.cashfree.com'
                : 'https://sandbox.cashfree.com';

            // Create order with Cashfree
            const response = await fetch(`${apiBase}/pg/orders`, {
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
                        customer_id: customerPhone || 'CUST_' + Date.now(),
                        customer_name: customerName || 'Customer',
                        customer_email: customerEmail || 'customer@example.com',
                        customer_phone: customerPhone || '9999999999',
                    },
                    order_meta: {
                        notify_url: `https://api.aapnaestore.com/api/webhooks/cashfree/payment/${storeId}`,
                    }
                })
            });

            const data = await response.json();

            if (!response.ok) {
                logger.error('Cashfree order creation failed:', data);
                return res.status(400).json({ success: false, error: data.message || 'Failed to create payment order' });
            }

            res.json({
                success: true,
                data: {
                    orderId: data.order_id,
                    paymentSessionId: data.payment_session_id,
                    orderAmount: data.order_amount,
                }
            });
        } catch (error) {
            logger.error('Create Cashfree order error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // POST /api/webhooks/cashfree/payment/:storeId
    // Cashfree calls this after payment — auto-confirm order
    cashfreePaymentWebhook: async (req, res) => {
        try {
            const { storeId } = req.params;
            const payload = req.body;

            logger.info('Cashfree webhook received for store ' + storeId + ':', JSON.stringify(payload));

            const orderStatus = payload?.data?.order?.order_status;
            const cfOrderId = payload?.data?.order?.cf_order_id;
            const orderId = payload?.data?.order?.order_id;

            if (orderStatus === 'PAID') {
                // Auto-confirm order
                await pool.query(
                    `UPDATE orders SET status = 'confirmed', payment_status = 'paid',
                     gateway_transaction_id = $1, updated_at = NOW()
                     WHERE store_order_id = $2 AND store_id = $3`,
                    [String(cfOrderId), orderId, storeId]
                );
                logger.info('Order auto-confirmed: ' + orderId);
            }

            res.json({ success: true });
        } catch (error) {
            logger.error('Cashfree payment webhook error:', error);
            res.status(500).json({ success: false });
        }
    },

    // KYC webhook (existing)
    cashfreeKycWebhook: async (req, res) => {
        try {
            const { merchantId, kycStatus } = req.body;
            await pool.query(
                `UPDATE store_payment_gateway_accounts SET kyc_status = $1, updated_at = NOW()
                 WHERE account_identifier = $2`,
                [kycStatus, merchantId]
            );
            res.json({ success: true });
        } catch (error) {
            logger.error('Cashfree KYC webhook error:', error);
            res.status(500).json({ success: false });
        }
    },

    // POST /api/stores/:id/payment-gateway/razorpay/keys
    saveRazorpayKeys: async (req, res) => {
        try {
            const { id: storeId } = req.params;
            const tenantId = req.tenantId;
            const { keyId, keySecret, mode } = req.body;

            if (!keyId || !keySecret) {
                return res.status(400).json({ success: false, error: 'Key ID and Key Secret are required' });
            }

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [storeId, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const gatewayResult = await pool.query(
                "SELECT id FROM payment_gateways WHERE gateway_key = 'razorpay'"
            );
            if (gatewayResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Razorpay gateway not found' });
            }
            const gatewayId = gatewayResult.rows[0].id;

            const encryptedApiKey = encrypt(keyId);
            const encryptedSecretKey = encrypt(keySecret);
            const gatewayMode = mode || 'sandbox';

            await pool.query(
                `INSERT INTO store_payment_gateway_accounts
                    (store_id, gateway_id, account_identifier, encrypted_api_key, encrypted_secret_key,
                     gateway_mode, kyc_status, is_enabled, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'approved', true, NOW())
                 ON CONFLICT (store_id, gateway_id) DO UPDATE
                 SET encrypted_api_key = $4, encrypted_secret_key = $5,
                     account_identifier = $3, gateway_mode = $6,
                     is_enabled = true, updated_at = NOW()`,
                [storeId, gatewayId, keyId, encryptedApiKey, encryptedSecretKey, gatewayMode]
            );

            logger.info('Razorpay keys saved for store ' + storeId);
            res.json({ success: true, message: 'Razorpay configured successfully' });
        } catch (error) {
            logger.error('Save Razorpay keys error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // POST /api/stores/:id/payment-gateway/stripe/keys
    saveStripeKeys: async (req, res) => {
        try {
            const { id: storeId } = req.params;
            const tenantId = req.tenantId;
            const { publishableKey, secretKey, webhookSecret, mode } = req.body;

            if (!publishableKey || !secretKey) {
                return res.status(400).json({ success: false, error: 'Publishable Key and Secret Key are required' });
            }

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [storeId, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const gatewayResult = await pool.query(
                "SELECT id FROM payment_gateways WHERE gateway_key = 'stripe'"
            );
            if (gatewayResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Stripe gateway not found' });
            }
            const gatewayId = gatewayResult.rows[0].id;

            const encryptedApiKey = encrypt(publishableKey);
            const encryptedSecretKey = encrypt(secretKey);
            const gatewayDetails = webhookSecret
                ? { webhook_secret: encrypt(webhookSecret) }
                : {};
            const gatewayMode = mode || 'sandbox';

            await pool.query(
                `INSERT INTO store_payment_gateway_accounts
                    (store_id, gateway_id, account_identifier, encrypted_api_key, encrypted_secret_key,
                     gateway_details, gateway_mode, kyc_status, is_enabled, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', true, NOW())
                 ON CONFLICT (store_id, gateway_id) DO UPDATE
                 SET encrypted_api_key = $4, encrypted_secret_key = $5,
                     gateway_details = $6, account_identifier = $3,
                     gateway_mode = $7, is_enabled = true, updated_at = NOW()`,
                [storeId, gatewayId, publishableKey, encryptedApiKey, encryptedSecretKey,
                 JSON.stringify(gatewayDetails), gatewayMode]
            );

            logger.info('Stripe keys saved for store ' + storeId);
            res.json({ success: true, message: 'Stripe configured successfully' });
        } catch (error) {
            logger.error('Save Stripe keys error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },
};
module.exports = PaymentGatewayController;
