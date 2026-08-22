const Joi = require('joi');

const schemas = {
    // Tenant OTP login
    sendOTP: Joi.object({
        phone: Joi.string().pattern(/^[6-9]\d{9}$/).required()
            .messages({ 'string.pattern.base': 'Enter a valid 10-digit Indian mobile number' }),
    }),
    verifyOTP: Joi.object({
        phone: Joi.string().pattern(/^[6-9]\d{9}$/).required(),
        otp: Joi.string().length(6).pattern(/^\d+$/).required()
            .messages({ 'string.length': 'OTP must be 6 digits' }),
    }),

    // Store admin login
    storeAdminLogin: Joi.object({
        subdomain: Joi.string().pattern(/^[a-zA-Z0-9-]+$/).min(2).max(50).required(),
        password: Joi.string().min(4).max(100).required(),
    }),

    // Customer OTP
    customerSendOTP: Joi.object({
        phone: Joi.string().pattern(/^[6-9]\d{9}$/).required()
            .messages({ 'string.pattern.base': 'Enter a valid 10-digit Indian mobile number' }),
    }),
    customerVerifyOTP: Joi.object({
        phone: Joi.string().pattern(/^[6-9]\d{9}$/).required(),
        otp: Joi.string().length(6).pattern(/^\d+$/).required(),
    }),

    // Super admin login
    adminLogin: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(4).max(100).required(),
    }),

    // Order creation
    createOrder: Joi.object({
        items: Joi.array().min(1).required(),
        deliveryAddress: Joi.object().required(),
        paymentMethod: Joi.string().valid('cod', 'upi', 'card', 'netbanking').required(),
        customerUpiId: Joi.string().max(50).optional().allow(null, ''),
        subtotal: Joi.number().min(0).required(),
        deliveryCharge: Joi.number().min(0).required(),
        taxAmount: Joi.number().min(0).required(),
        totalAmount: Joi.number().min(0).required(),
    }),
};

const validate = (schemaName) => (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next();
    
    const { error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
        return res.status(400).json({
            success: false,
            error: error.details.map(d => d.message).join(', ')
        });
    }
    next();
};

module.exports = validate;
