const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

class JWTService {
    static generateTokens(tenantId, email, role = 'tenant') {
        const payload = { tenantId, email, role };
        
        const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || '7d'
        });
        
        const refreshToken = crypto.randomBytes(40).toString('hex');
        
        return { accessToken, refreshToken };
    }

    static verifyAccessToken(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            return { valid: true, decoded };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }
}

module.exports = JWTService;