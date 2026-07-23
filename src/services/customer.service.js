const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const logger = require('../config/logger');
require('dotenv').config();

class CustomerService {
    // Passwordless login, scoped to a single store. The same phone number can
    // be a separate customer at every store it shops at — each store owns its
    // own customer list, its own OTP flow, its own session.
    static async loginOrRegisterByPhone(storeId, phone) {
        try {
            const storeCheck = await pool.query('SELECT id FROM stores WHERE id = $1', [storeId]);
            if (storeCheck.rows.length === 0) {
                return { success: false, error: 'Store not found' };
            }

            const existing = await pool.query(
                `SELECT id, customer_id, store_id, phone, name, is_verified 
                 FROM customers WHERE store_id = $1 AND phone = $2`,
                [storeId, phone]
            );

            let customer;
            let isNewCustomer = false;

            if (existing.rows.length > 0) {
                customer = existing.rows[0];
                if (!customer.is_verified) {
                    await pool.query('UPDATE customers SET is_verified = true WHERE id = $1', [customer.id]);
                    customer.is_verified = true;
                }
            } else {
                const timestamp = Date.now().toString().slice(-6);
                const customerId = `CUS-${timestamp}-${Math.floor(Math.random() * 10000)}`;

                const inserted = await pool.query(
                    `INSERT INTO customers (customer_id, store_id, phone, is_verified)
                     VALUES ($1, $2, $3, true)
                     RETURNING id, customer_id, store_id, phone, name, is_verified`,
                    [customerId, storeId, phone]
                );
                customer = inserted.rows[0];
                isNewCustomer = true;
                logger.info(`✅ New customer auto-registered via OTP: ${phone} @ store ${storeId}`);
            }

            const token = jwt.sign(
                { customerId: customer.id, storeId, phone: customer.phone, role: 'customer' },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            logger.info(`✅ Customer OTP login: ${customer.phone} @ store ${storeId}`);

            return { success: true, customer, token, isNewCustomer };
        } catch (error) {
            logger.error('❌ Customer OTP login/register error:', error);
            return { success: false, error: 'Login failed: ' + error.message };
        }
    }

    static verifyToken(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.role !== 'customer') return null;
            return decoded;
        } catch (error) {
            return null;
        }
    }
}

module.exports = CustomerService;
