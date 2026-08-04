const express = require('express');
const router = express.Router({ mergeParams: true });
const StoreAdminCouriersController = require('../../controllers/store-admin/couriers.controller');
const { storeAdminAuth } = require('../../middleware/storeAdminAuth');

router.use(storeAdminAuth);

router.get('/', StoreAdminCouriersController.getAll);
router.post('/', StoreAdminCouriersController.create);
router.delete('/:courierId', StoreAdminCouriersController.delete);

module.exports = router;
