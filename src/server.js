const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

// Route imports
const authRoutes = require('./routes/auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const storeRoutes = require('./routes/store.routes');
const productRoutes = require('./routes/product.routes');
const adminRoutes = require('./routes/admin.routes');
const storeAdminOrdersRoutes = require('./routes/store-admin/orders.routes');
const storeAdminCouriersRoutes = require('./routes/store-admin/couriers.routes');
const storeAdminReturnsRoutes = require('./routes/store-admin/returns.routes');
const storeAdminCustomersRoutes = require('./routes/store-admin/customers.routes');
const storeAdminSessionRoutes = require('./routes/storeAdminSession.routes');
const pricingRoutes = require('./routes/pricing.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const termsRoutes = require('./routes/terms.routes');
const aiRoutes = require('./routes/ai.routes');
const customerRoutes = require('./routes/customer.routes');
const customerOrderRoutes = require('./routes/customerOrder.routes');
const customerProfileRoutes = require('./routes/customerProfile.routes');
const publicRoutes = require('./routes/public.routes');
const imageRoutes = require('./routes/imageRoutes');
const trackingRoutes = require('./routes/tracking.routes');

// ✅ NEW — WhatsApp Market routes (does not affect any existing routes)
const waRoutes          = require('./routes/wa.routes');
const addonAdminRoutes  = require('./routes/addon.admin.routes');
const addonPublicRoutes = require('./routes/addon.public.routes');

// Import database to ensure connection
require('./config/database');

// Subscription expiry cron — runs daily at midnight
const subscriptionExpiryService = require('./services/subscriptionExpiryService');
const { CronJob } = require('cron');
new CronJob('0 0 * * *', () => {
    subscriptionExpiryService.processExpiredSubscriptions();
}, null, true, 'Asia/Kolkata');
console.log('⏰ Subscription expiry cron scheduled (daily midnight IST)');

const app = express();

// ✅ Needed for req.ip to reflect the real visitor, not the proxy, once
// this runs behind nginx/a load balancer/Cloudflare — otherwise every
// request looks like it's from the same IP, which would silently break
// the per-IP OTP rate limiting the moment this goes into production.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5002;

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    contentSecurityPolicy: false,
}));

const rateLimit = require('express-rate-limit');

// General API rate limit — for all authenticated API calls (JWT protected)
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { success: false, error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Super admin login — keyed by EMAIL so each admin has their own counter
const superAdminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: { success: false, error: 'Too many login attempts, please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `superadmin:${req.body?.email || req.ip}`,
});

// Tenant OTP — keyed by PHONE so each tenant has their own counter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: { success: false, error: 'Too many login attempts, please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth:${req.body?.phone || req.ip}`,
});

// Store admin login — keyed by SUBDOMAIN so each store has their own counter
const storeAdminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: { success: false, error: 'Too many login attempts, please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `storeadmin:${req.body?.subdomain || req.ip}`,
});

// Customer OTP — keyed by PHONE so each customer has their own counter
const customerOtpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: { success: false, error: 'Too many OTP attempts, please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `customerotp:${req.body?.phone || req.ip}`,
});

// Keep superAdminLimiter as alias for backward compat
const superAdminLimiter = superAdminLoginLimiter;

app.use('/api', generalLimiter);
app.use(cors({
    origin: [
        'https://aapnaestore.com',
        'https://www.aapnaestore.com',
        'https://app.aapnaestore.com',
        'https://admin.aapnaestore.com',
        'https://store-admin.aapnaestore.com',
        /^https:\/\/[a-z0-9-]+\.aapnaestore\.com$/,
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
// ✅ Also parse text/plain as JSON — specifically for navigator.sendBeacon
// calls (e.g. Store Admin's logout-on-tab-close), which can't use
// application/json for a cross-origin request without triggering a CORS
// preflight that sendBeacon isn't able to perform. text/plain is
// CORS-simple, so the beacon can actually deliver it; this just tells the
// JSON parser to also look at that content type.
app.use(express.json({ limit: '10mb', type: ['application/json', 'text/plain'] }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded images
app.use('/uploads/tenants', (req, res, next) => {
    if (req.path.includes('/returns/')) {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
    }
    next();
}, express.static(path.join(__dirname, '../uploads/tenants')));

// ✅ NEW — serve WhatsApp Market uploaded images (public)
app.use('/uploads/market', express.static(path.join(__dirname, '../public/uploads/market')));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Welcome route
app.get('/', (req, res) => {
    res.json({
        message: 'ApnaEstore Backend is running! 🚀',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            tenants: '/api/tenants',
            stores: '/api/stores',
            products: '/api/products',
            admin: '/api/admin',
            storeAdmin: '/api/store/:storeId/admin'
        }
    });
});

// API Routes
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);

// ✅ CRITICAL FIX: Mount Image Routes BEFORE Store Routes
// Because imageRoutes starts with /stores, Express must check it FIRST.
app.use('/api/stores', imageRoutes); 
app.use('/api/stores', storeRoutes);

// ✅ NEW — WhatsApp Market API (completely separate from all existing routes)
app.use('/api/stores/:storeId/market', waRoutes);
app.use('/api/admin/addon-plans',       addonAdminRoutes);
app.use('/api/addon-plans',             addonPublicRoutes);

// Public webhook — Cashfree calls this directly with its own signature,
// never a tenant JWT, so it must NOT sit behind authenticate middleware.
// 🔧 TODO: add signature verification here once real Cashfree credentials
// are wired — see PaymentGatewayController.cashfreeKycWebhook.
const PaymentGatewayController = require('./controllers/paymentGateway.controller');
const webhookRoutes = require('./routes/webhook.routes');
app.post('/api/store/:storeId/cashfree/create-order', PaymentGatewayController.createCashfreeOrder);
app.post('/api/webhooks/cashfree/kyc-status', PaymentGatewayController.cashfreeKycWebhook);
app.use('/api/webhooks', webhookRoutes);
app.post('/api/webhooks/cashfree/payment/:storeId', PaymentGatewayController.cashfreePaymentWebhook);

app.use('/api/products', productRoutes);
app.use('/api/admin/login', superAdminLoginLimiter);
app.use('/api/admin', adminRoutes);
app.use('/api/store/:storeId/admin/orders', storeAdminOrdersRoutes);
app.use('/api/store/:storeId/admin/couriers', storeAdminCouriersRoutes);
app.use('/api/store/:storeId/admin/returns', storeAdminReturnsRoutes);
app.use('/api/store/:storeId/admin/customers', storeAdminCustomersRoutes);
app.use('/api/store-admin/login', storeAdminLimiter);
app.use('/api/store-admin', storeAdminSessionRoutes);
app.use('/api/pricing-plans', pricingRoutes);
app.use('/api/invoices', invoiceRoutes);

// Public endpoint — check if platform payment gateway is enabled
app.get('/api/public/payment-gateway-status', async (req, res) => {
    try {
        const _pool = require('./config/database');
        const result = await _pool.query(
            "SELECT key, value FROM platform_settings WHERE key IN ('pg_enabled', 'pg_provider', 'pg_environment')"
        );
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });
        res.json({
            success: true,
            data: {
                enabled: settings.pg_enabled === 'true',
                provider: settings.pg_provider || 'cashfree',
                environment: settings.pg_environment || 'sandbox',
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Check if tenant is test tenant — affects payment method shown
app.get('/api/public/is-test-tenant', async (req, res) => {
    try {
        const { phone } = req.query;
        const cashfreeService = require('./services/paymentGateway.service');
        res.json({ success: true, isTestTenant: cashfreeService.isTestTenant(phone) });
    } catch (e) {
        res.json({ success: true, isTestTenant: false });
    }
});


// Store-level Cashfree payment webhook
// Fires when a customer pays on a tenant's storefront
app.post('/api/webhooks/store-payment/:storeId', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const { storeId } = req.params;
        const pool = require('./config/database');
        const { decrypt } = require('./utils/encryption');
        const crypto = require('crypto');

        // Get store secret key for signature verification
        const gatewayResult = await pool.query(
            `SELECT spga.encrypted_secret_key
             FROM store_payment_gateway_accounts spga
             JOIN payment_gateways pg ON pg.id = spga.gateway_id
             WHERE spga.store_id = $1 AND pg.gateway_key = 'cashfree'`,
            [storeId]
        );

        const rawBody = req.body.toString();
        const event = JSON.parse(rawBody);

        // Verify signature if secret exists
        if (gatewayResult.rows.length > 0) {
            const secretKey = decrypt(gatewayResult.rows[0].encrypted_secret_key);
            const signature = req.headers['x-webhook-signature'];
            const timestamp = req.headers['x-webhook-timestamp'];
            if (signature && timestamp) {
                const signedPayload = timestamp + rawBody;
                const expectedSig = crypto.createHmac('sha256', secretKey).update(signedPayload).digest('base64');
                if (signature !== expectedSig) {
                    return res.status(401).json({ success: false, error: 'Invalid signature' });
                }
            }
        }

        const eventType = event.type || event.event;
        const orderData = event.data || event;

        if (eventType === 'PAYMENT_SUCCESS' || eventType === 'payment.captured') {
            const orderId = orderData.order?.order_id || orderData.order_id;
            const amount = orderData.payment?.payment_amount || orderData.order?.order_amount;

            // Get pending order data
            let pendingOrder = null;
            try {
                const pendingResult = await pool.query(
                    'SELECT * FROM cashfree_pending_orders WHERE order_id = $1',
                    [orderId]
                );
                if (pendingResult.rows.length > 0) {
                    pendingOrder = JSON.parse(pendingResult.rows[0].order_data);
                }
            } catch (e) {}

            if (pendingOrder && Object.keys(pendingOrder).length > 0) {
                // Create the actual order now that payment is confirmed
                const { v4: uuidv4 } = require('uuid');
                const dbOrderId = orderId;

                const insertResult = await pool.query(
                    `INSERT INTO orders
                        (order_id, store_id, customer_id, customer_name, customer_phone, items, delivery_address,
                         subtotal, delivery_charge, tax_amount, total_amount, payment_method, status, payment_status, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'cashfree', 'confirmed', 'paid', NOW())
                     ON CONFLICT (order_id) DO UPDATE
                     SET status = 'confirmed', payment_status = 'paid', updated_at = NOW()
                     RETURNING id`,
                    [
                        dbOrderId, storeId,
                        pendingOrder.customerId || null,
                        pendingOrder.customerName || 'Customer',
                        pendingOrder.customerPhone || null,
                        JSON.stringify(pendingOrder.items || []),
                        JSON.stringify(pendingOrder.deliveryAddress || {}),
                        pendingOrder.subtotal || 0,
                        pendingOrder.deliveryCharge || 0,
                        pendingOrder.taxAmount || 0,
                        amount || pendingOrder.totalAmount || 0
                    ]
                );

                // Add status history
                if (insertResult.rows.length > 0) {
                    await pool.query(
                        `INSERT INTO order_status_history (order_id, status, changed_by, notes)
                         VALUES ($1, 'confirmed', 'system', 'Payment confirmed via Cashfree')`,
                        [insertResult.rows[0].id]
                    );
                }

                // Mark pending order as completed
                await pool.query(
                    'UPDATE cashfree_pending_orders SET status = $1 WHERE order_id = $2',
                    ['completed', orderId]
                ).catch(() => {});
            }
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Store payment webhook error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Public pricing — no auth, needed for legal/marketing pages
app.get('/api/public/pricing-plans', async (req, res) => {
    try {
        const _pool = require('./config/database');
        const result = await _pool.query(
            'SELECT plan_key, display_name, billing_cycle, base_amount, tax_percentage, validity_days FROM pricing_plans WHERE is_active = true ORDER BY plan_key, billing_cycle'
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});


app.use('/api/terms', termsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/store/:storeId/auth/otp', customerOtpLimiter);
app.use('/api/store/:storeId/auth', customerRoutes);
app.use('/api/store/:storeId/orders', customerOrderRoutes);
app.use('/api/store/:storeId/customers/me', customerProfileRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/tracking', trackingRoutes);

// ============================================================
// ✅ START CRON JOB FOR DRAFT STORE CLEANUP (Added)
// ============================================================
const scheduleCleanupJob = require('./jobs/storeCleanupJob');
require('./jobs/trackingJob'); // ✅ was never actually required anywhere before — cron.schedule() runs as a side effect of this require
require('./jobs/subscriptionExpiryJob');
require('./jobs/trialExpiryJob');

// ✅ NEW — WhatsApp Market scheduler + restore sessions on restart
require('./jobs/wa.scheduler.job');
const { restoreAllSessions } = require('./services/wa.session.service');
restoreAllSessions();

scheduleCleanupJob();

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.message);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 Auth API: http://localhost:${PORT}/api/auth`);
    console.log(`👥 Tenants API: http://localhost:${PORT}/api/tenants`);
    console.log(`🏪 Stores API: http://localhost:${PORT}/api/stores`);
    console.log(`📦 Products API: http://localhost:${PORT}/api/products`);
    console.log(`🛡️ Admin API: http://localhost:${PORT}/api/admin`);
    console.log(`📋 Store Admin Orders: http://localhost:${PORT}/api/store/:storeId/admin/orders`);
    console.log(`👤 Store Admin Customers: http://localhost:${PORT}/api/store/:storeId/admin/customers`);
    console.log(`💬 WhatsApp Market API: http://localhost:${PORT}/api/stores/:storeId/market`);
    console.log(`🕐 Draft store cleanup job scheduled (daily at 2:00 AM)`);
    console.log(`📦 Courier tracking auto-update job scheduled (every 60 minutes)`);
    console.log(`📲 WhatsApp Market scheduler started`);
});

module.exports = app;
