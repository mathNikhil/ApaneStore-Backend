const { body, validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    next();
};

const tenantRegisterValidation = [
    body('companyName').notEmpty().withMessage('Company name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const tenantLoginValidation = [
    body('identifier').notEmpty().withMessage('Email or phone is required'),
    body('password').notEmpty().withMessage('Password is required'),
];

module.exports = {
    validate,
    tenantRegisterValidation,
    tenantLoginValidation
};