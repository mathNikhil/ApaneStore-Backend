const express = require('express');
const router = express.Router({ mergeParams: true });
const { customerAuth } = require('../middleware/customerAuth');
const CustomerCartController = require('../controllers/customerCart.controller');

router.get('/', customerAuth, CustomerCartController.getCart);
router.post('/', customerAuth, CustomerCartController.saveCart);
router.delete('/', customerAuth, CustomerCartController.clearCart);

module.exports = router;
