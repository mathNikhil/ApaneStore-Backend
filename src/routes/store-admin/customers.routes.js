const express = require('express');
const router = express.Router({ mergeParams: true });
const StoreAdminCustomersController = require('../../controllers/store-admin/customers.controller');
const { authenticate } = require('../../middleware/auth');

router.use(authenticate);
router.get('/', StoreAdminCustomersController.getAll);

module.exports = router;
