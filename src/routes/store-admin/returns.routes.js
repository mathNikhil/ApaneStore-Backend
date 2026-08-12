const express = require('express');
const router = express.Router({ mergeParams: true });
const StoreAdminReturnsController = require('../../controllers/store-admin/returns.controller');
const { storeAdminAuth } = require('../../middleware/storeAdminAuth');

router.use(storeAdminAuth);

router.get('/stats', StoreAdminReturnsController.getStats);
router.get('/', StoreAdminReturnsController.getAll);
router.get('/:returnId', StoreAdminReturnsController.getById);
router.put('/:returnId/approve', StoreAdminReturnsController.approve);
router.put('/:returnId/reject', StoreAdminReturnsController.reject);
router.put('/:returnId/status', StoreAdminReturnsController.updateStatus);

module.exports = router;
