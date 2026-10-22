const express = require('express');
const router = express.Router({ mergeParams: true });
const CouponsController = require('../../controllers/store-admin/coupons.controller');
const { storeAdminAuth } = require('../../middleware/storeAdminAuth');

router.use(storeAdminAuth);

// CRUD
router.get('/',    CouponsController.getAll);
router.post('/',   CouponsController.create);
router.get('/:id', CouponsController.getById);
router.put('/:id', CouponsController.update);
router.delete('/:id', CouponsController.remove);

// Actions
router.post('/:id/disable', CouponsController.disable);

// Checkout validation (also available from public storefront routes if needed)
router.post('/validate', CouponsController.validate);

module.exports = router;
