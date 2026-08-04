const jwt = require('jsonwebtoken');
const pool = require('../config/database');
require('dotenv').config();

// Protect routes - verify JWT token
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'No token provided. Please login first.'
            });
        }
        
        const token = authHeader.split(' ')[1];
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if tenant exists
        const result = await pool.query(
            'SELECT id, tenant_id, company_name, email, subscription_tier, status FROM tenants WHERE id = $1 AND is_verified = true',
            [decoded.tenantId]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'User not found or not verified'
            });
        }

        // ✅ Block hidden tenants from using the dashboard at all — this
        // check runs on every request, so it also cuts off access for a
        // tenant who was hidden after already logging in (their existing
        // token would otherwise keep working for up to 7 days).
        if (result.rows[0].status === 'hidden') {
            return res.status(403).json({
                success: false,
                error: 'Your account has been disabled. Please contact support.'
            });
        }
        
        req.tenant = result.rows[0];
        req.tenantId = decoded.tenantId;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expired. Please login again.'
            });
        }
        console.error('Auth error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authentication failed'
        });
    }
};

// Authorize - check user role
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.tenant?.subscription_tier || 'trial')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions'
            });
        }
        next();
    };
};

// ✅ Add alias for compatibility
const authMiddleware = authenticate;

module.exports = { 
    authenticate, 
    authorize,
    authMiddleware  // ← Add this alias
};