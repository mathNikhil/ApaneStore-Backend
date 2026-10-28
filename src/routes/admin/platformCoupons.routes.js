const express = require('express');
const router = express.Router();
const PlatformCouponsController = require('../../controllers/Admin/platformCoupons.controller');
const { adminAuth } = require('../../middleware/adminAuth');

router.use(adminAuth);

router.get('/',                           PlatformCouponsController.getAll);
router.post('/',                          PlatformCouponsController.create);
router.delete('/:id',                     PlatformCouponsController.remove);
router.patch('/:id/disable',              PlatformCouponsController.disable);
router.get('/:id/claims',                 PlatformCouponsController.getClaims);

// Called when a store is published — auto-clones active platform coupons
router.post('/claim-for-store/:storeId',  PlatformCouponsController.claimForStore);

module.exports = router;
