const jwt = require('jsonwebtoken');
const pool = require('../config/database');
require('dotenv').config();

// Super Admin Authentication Middleware
const authenticateAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'No token provided. Please login as admin.'
            });
        }
        
        const token = authHeader.split(' ')[1];
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // SECURITY: The JWT must carry role: 'super_admin', issued only by /admin/login.
        // A regular tenant token (role: 'tenant') is rejected here even if the DB row
        // happens to have business_type = 'admin', preventing privilege escalation via
        // account label manipulation.
        if (decoded.role !== 'super_admin') {
            return res.status(401).json({
                success: false,
                error: 'Admin not found or not authorized'
            });
        }

        // Double-check: confirm the account still exists in DB with admin label
        // (catches cases where admin was demoted or deleted after token issuance)
        const result = await pool.query(
            'SELECT id, tenant_id, company_name, email, business_type FROM tenants WHERE id = $1 AND business_type = $2 AND is_verified = true',
            [decoded.adminId || decoded.tenantId, 'admin']
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Admin not found or not authorized'
            });
        }
        
        req.admin = result.rows[0];
        req.adminId = decoded.adminId || decoded.tenantId;
        req.isAdmin = true;
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
        return res.status(500).json({
            success: false,
            error: 'Authentication failed'
        });
    }
};

module.exports = { authenticateAdmin };