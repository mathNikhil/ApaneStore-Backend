const pool = require('../config/database');
const logger = require('../config/logger');

// ⚠️ SECURITY: real credentials for any gateway belong ONLY in environment
// variables — never in code, never pasted in chat, never committed.
const CASHFREE_PARTNER_CLIENT_ID = process.env.CASHFREE_PARTNER_CLIENT_ID;
const CASHFREE_PARTNER_CLIENT_SECRET = process.env.CASHFREE_PARTNER_CLIENT_SECRET;
const CASHFREE_API_BASE = process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';

// ============================================================
// PER-GATEWAY HELPERS
// Each one knows how to talk to ITS OWN provider. Adding gateway #4 later
// means writing one more function like these, not touching anything else
// in this file below the "GENERIC CORE" section.
// ============================================================

// 🔧 Real Cashfree "Create Merchant" call goes here once sandbox
// credentials are available. Currently returns a clearly-marked
// placeholder so the rest of the flow can be built/tested end-to-end.
async function initiateCashfreeOnboarding(businessDetails) {
    if (!CASHFREE_PARTNER_CLIENT_ID || !CASHFREE_PARTNER_CLIENT_SECRET) {
        throw new Error('Cashfree Partner credentials not configured (set CASHFREE_PARTNER_CLIENT_ID / CASHFREE_PARTNER_CLIENT_SECRET in .env)');
    }

    // const response = await axios.post(
    //     `${CASHFREE_API_BASE}/partners/merchant`,
    //     businessDetails,
    //     { headers: {
    //         'x-partner-clientid': CASHFREE_PARTNER_CLIENT_ID,
    //         'x-partner-clientsecret': CASHFREE_PARTNER_CLIENT_SECRET,
    //     }}
    // );
    // return { accountIdentifier: response.data.merchantId, kycStatus: 'pending' };

    return {
        accountIdentifier: `CF_PENDING_${Date.now()}`,
        kycStatus: 'pending',
    };
}

// 🔧 Stripe Connect equivalent — not built yet (application not started),
// stubbed so the generic dispatcher below already has a slot ready.
async function initiateStripeOnboarding(businessDetails) {
    throw new Error('Stripe Connect integration not yet available');
}

// Maps a gateway_key to its onboarding function. Adding a new gateway =
// add one line here + one function above.
const ONBOARDING_HANDLERS = {
    cashfree: initiateCashfreeOnboarding,
    stripe: initiateStripeOnboarding,
};

// ============================================================
// GENERIC CORE
// Everything below works the same regardless of which gateway is
// involved — it doesn't know or care about Cashfree/Stripe specifics,
// it just looks up the right handler and stores the result consistently.
// ============================================================

const PaymentGatewayController = {
    // GET /api/stores/:id/payment-gateways
    // All gateways configured for this store, in one call — used by
    // Step 4 to render every badge/status without one request per gateway.
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
                `SELECT spga.id, pg.gateway_key, pg.display_name, pg.requires_kyc,
                        spga.account_identifier, spga.kyc_status, spga.is_enabled
                 FROM store_payment_gateway_accounts spga
                 JOIN payment_gateways pg ON pg.id = spga.gateway_id
                 WHERE spga.store_id = $1`,
                [storeId]
            );

            res.json({ success: true, data: result.rows });
        } catch (error) {
            logger.error('❌ List store gateways error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to load payment gateways' });
        }
    },

    // POST /api/stores/:id/payment-gateway/:gatewayKey
    // Starts (or re-attempts) onboarding for ONE gateway on THIS store.
    createOrUpdateGatewayAccount: async (req, res) => {
        try {
            const { id: storeId, gatewayKey } = req.params;
            const tenantId = req.tenantId;
            const { businessDetails } = req.body;

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [storeId, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const gatewayResult = await pool.query(
                'SELECT id, requires_kyc FROM payment_gateways WHERE gateway_key = $1 AND is_active = true',
                [gatewayKey]
            );
            if (gatewayResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: `Unknown or inactive gateway: ${gatewayKey}` });
            }
            const gateway = gatewayResult.rows[0];

            const handler = ONBOARDING_HANDLERS[gatewayKey];
            if (!handler) {
                return res.status(400).json({ success: false, error: `No onboarding handler configured for ${gatewayKey}` });
            }

            // Existing account for this store+gateway? (unique constraint
            // means there can only ever be zero or one)
            const existing = await pool.query(
                'SELECT id FROM store_payment_gateway_accounts WHERE store_id = $1 AND gateway_id = $2',
                [storeId, gateway.id]
            );
            if (existing.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `This store already has a ${gatewayKey} account. Use the status endpoint to check progress.`,
                });
            }

            const { accountIdentifier, kycStatus } = await handler(businessDetails);

            const insertResult = await pool.query(
                `INSERT INTO store_payment_gateway_accounts
                    (store_id, gateway_id, account_identifier, kyc_status, gateway_details, is_enabled)
                 VALUES ($1, $2, $3, $4, $5, true)
                 RETURNING id, account_identifier, kyc_status`,
                [storeId, gateway.id, accountIdentifier, kycStatus, JSON.stringify(businessDetails)]
            );

            logger.info(`✅ ${gatewayKey} account created for store ${storeId}: ${accountIdentifier}`);

            res.json({ success: true, data: insertResult.rows[0] });
        } catch (error) {
            logger.error(`❌ Create gateway account error:`, error);
            res.status(500).json({ success: false, error: error.message || 'Failed to start onboarding' });
        }
    },

    // GET /api/stores/:id/payment-gateway/:gatewayKey
    getGatewayStatus: async (req, res) => {
        try {
            const { id: storeId, gatewayKey } = req.params;
            const tenantId = req.tenantId;

            const result = await pool.query(
                `SELECT spga.account_identifier, spga.kyc_status, spga.is_enabled
                 FROM store_payment_gateway_accounts spga
                 JOIN payment_gateways pg ON pg.id = spga.gateway_id
                 JOIN stores s ON s.id = spga.store_id
                 WHERE spga.store_id = $1 AND pg.gateway_key = $2 AND s.tenant_id = $3`,
                [storeId, gatewayKey, tenantId]
            );

            if (result.rows.length === 0) {
                return res.json({ success: true, data: { kycStatus: 'not_started' } });
            }

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            logger.error('❌ Get gateway status error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get status' });
        }
    },

    // POST /api/stores/:id/payment-gateway/default
    // Sets which gateway is pre-selected at this store's checkout.
    setDefaultGateway: async (req, res) => {
        try {
            const { id: storeId } = req.params;
            const tenantId = req.tenantId;
            const { gatewayKey } = req.body;

            const gatewayResult = await pool.query(
                'SELECT id FROM payment_gateways WHERE gateway_key = $1',
                [gatewayKey]
            );
            if (gatewayResult.rows.length === 0) {
                return res.status(400).json({ success: false, error: `Unknown gateway: ${gatewayKey}` });
            }

            const result = await pool.query(
                `UPDATE stores SET default_payment_gateway_id = $1, updated_at = NOW()
                 WHERE id = $2 AND tenant_id = $3
                 RETURNING id, default_payment_gateway_id`,
                [gatewayResult.rows[0].id, storeId, tenantId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            logger.error('❌ Set default gateway error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to set default gateway' });
        }
    },

    // 🔧 TODO: verify webhook signature before trusting this payload once
    // wired to real Cashfree credentials — never skip signature
    // verification on a payments-adjacent webhook.
    cashfreeKycWebhook: async (req, res) => {
        try {
            const { merchantId, kycStatus } = req.body;

            const result = await pool.query(
                `UPDATE store_payment_gateway_accounts
                 SET kyc_status = $1, updated_at = NOW()
                 WHERE account_identifier = $2
                 RETURNING store_id`,
                [kycStatus, merchantId]
            );

            if (result.rows.length === 0) {
                logger.error(`❌ Cashfree webhook: no account found for merchant_id ${merchantId}`);
                return res.status(404).json({ success: false });
            }

            logger.info(`✅ Cashfree KYC status updated for store ${result.rows[0].store_id}: ${kycStatus}`);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Cashfree webhook error:', error);
            res.status(500).json({ success: false });
        }
    },
};

module.exports = PaymentGatewayController;
