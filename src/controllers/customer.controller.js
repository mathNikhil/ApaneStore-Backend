const CustomerService = require('../services/customer.service');
const OTPService = require('../services/otp.service');
const logger = require('../config/logger');

class CustomerController {
    // Send OTP for a customer logging into a specific store
    static async sendOTP(req, res) {
        try {
            const { storeId } = req.params;
            const { phone } = req.body;

            if (!phone) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone number is required'
                });
            }

            // OTP just proves phone ownership; which store the resulting
            // session belongs to is decided by loginOrRegisterByPhone below.
            // (purpose is VARCHAR(20), so it can't embed a storeId UUID.)
            const result = await OTPService.sendOTP(phone, null, 'customer_login');
            res.status(result.success ? 200 : 500).json(result);
        } catch (error) {
            logger.error('❌ Customer send OTP error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to send OTP'
            });
        }
    }

    // Verify OTP and log the customer in (auto-registering them at this
    // store on their first visit)
    static async verifyOTP(req, res) {
        try {
            const { storeId } = req.params;
            const { phone, otp } = req.body;

            if (!phone || !otp) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone and OTP are required'
                });
            }

            const result = await OTPService.verifyOTP(phone, otp, 'customer_login');
            if (!result.valid) {
                return res.status(400).json(result);
            }

            const loginResult = await CustomerService.loginOrRegisterByPhone(storeId, phone);
            if (!loginResult.success) {
                return res.status(400).json(loginResult);
            }

            res.status(200).json({
                success: true,
                message: 'OTP verified successfully',
                data: {
                    customer: loginResult.customer,
                    token: loginResult.token,
                    isNewCustomer: loginResult.isNewCustomer
                }
            });
        } catch (error) {
            logger.error('❌ Customer verify OTP error:', error);
            res.status(500).json({
                success: false,
                error: 'OTP verification failed'
            });
        }
    }
}

module.exports = CustomerController;
