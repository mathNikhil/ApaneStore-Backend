const express = require('express');
const router = express.Router({ mergeParams: true });
const CustomerProfileController = require('../controllers/customerProfile.controller');
const { customerAuth } = require('../middleware/customerAuth');

router.use(customerAuth);

router.get('/', CustomerProfileController.getMe);
router.patch('/', CustomerProfileController.updateMe);
router.post('/addresses', CustomerProfileController.addAddress);
router.put('/addresses/:addressId', CustomerProfileController.updateAddress);
router.delete('/addresses/:addressId', CustomerProfileController.deleteAddress);
router.put('/addresses/:addressId/default', CustomerProfileController.setDefaultAddress);

module.exports = router;
