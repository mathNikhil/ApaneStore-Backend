const Joi = require('joi');

module.exports = {
    tenantSchema: Joi.object({
        companyName: Joi.string().required(),
        email: Joi.string().email().required(),
        phone: Joi.string().pattern(/^[0-9]{10}$/).required(),
        password: Joi.string().min(6).required(),
        businessType: Joi.string().optional()
    }),
    
    loginSchema: Joi.object({
        identifier: Joi.string().required(),
        password: Joi.string().required()
    }),
    
    storeSchema: Joi.object({
        storeName: Joi.string().required(),
        subdomain: Joi.string().pattern(/^[a-z0-9-]+$/).required(),
        config: Joi.object().optional()
    }),
    
    productSchema: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().optional(),
        price: Joi.number().positive().required(),
        comparePrice: Joi.number().positive().optional(),
        sku: Joi.string().optional(),
        category: Joi.string().optional(),
        inventoryCount: Joi.number().integer().min(0).default(0)
    })
};