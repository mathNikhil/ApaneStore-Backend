const express = require('express');
const router = express.Router();
const InvoiceController = require('../controllers/invoice.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Tenant routes
router.get('/', InvoiceController.listTenantInvoices);
router.post('/:subscriptionId/generate', InvoiceController.generateInvoice);
router.get('/:subscriptionId/download', InvoiceController.downloadInvoice);

module.exports = router;
