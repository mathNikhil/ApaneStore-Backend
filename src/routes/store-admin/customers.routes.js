const express = require('express');
const router = express.Router({ mergeParams: true });
const StoreAdminCustomersController = require('../../controllers/store-admin/customers.controller');
const { storeAdminAuth } = require('../../middleware/storeAdminAuth');

router.use(storeAdminAuth);
router.get('/', StoreAdminCustomersController.getAll);

module.exports = router;
