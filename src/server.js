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
const storeAdminCustomersRoutes = require('./routes/store-admin/customers.routes');
const customerRoutes = require('./routes/customer.routes');
const publicRoutes = require('./routes/public.routes');
const imageRoutes = require('./routes/imageRoutes');
// Add this import at the top with other routes
const trackingRoutes = require('./routes/tracking.routes');

// Import database to ensure connection
require('./config/database');

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
app.use(helmet({
    // Default helmet blocks cross-origin loading of static assets (like
    // uploaded product images) via Cross-Origin-Resource-Policy. Since the
    // frontend apps run on different ports than this API, that would
    // silently break every <img> tag pointing at /uploads/... without any
    // error message explaining why.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add this with other route registrations
app.use('/api/tracking', trackingRoutes);

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/store/:storeId/admin/orders', storeAdminOrdersRoutes);
app.use('/api/store/:storeId/admin/customers', storeAdminCustomersRoutes);
app.use('/api/store/:storeId/auth', customerRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/images', imageRoutes);

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
});

module.exports = app;
