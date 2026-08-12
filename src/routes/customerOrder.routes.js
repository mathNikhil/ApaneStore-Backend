const express = require('express');
const router = express.Router({ mergeParams: true });
const CustomerOrderController = require('../controllers/customerOrder.controller');
const CustomerReturnController = require('../controllers/customerReturn.controller');
const trackingController = require('../controllers/trackingController');
const { customerAuth } = require('../middleware/customerAuth');
const { uploadSingle, handleMulterError } = require('../middleware/upload');
const { validateSingleImage } = require('../middleware/imageValidation');

router.post('/', customerAuth, CustomerOrderController.create);
router.get('/mine', customerAuth, CustomerOrderController.getMine);
router.get('/:orderId/tracking', customerAuth, trackingController.getCustomerTracking);
router.post('/:orderId/return', customerAuth, CustomerReturnController.create);
router.get('/:orderId/return', customerAuth, CustomerReturnController.getForOrder);
router.put('/:orderId/return/customer-shipping', customerAuth, CustomerReturnController.submitCustomerShipping);
router.post(
    '/:orderId/return/photos',
    customerAuth,
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'RETURN'; next(); },
    validateSingleImage,
    CustomerReturnController.uploadPhoto
);

module.exports = router;
