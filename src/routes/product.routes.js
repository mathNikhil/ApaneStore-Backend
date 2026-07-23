const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/product.controller');
const { authenticate } = require('../middleware/auth');

// All product routes require authentication
router.use(authenticate);

router.get('/', ProductController.getAll);
router.get('/:id', ProductController.getById);
router.post('/', ProductController.create);
router.put('/:id', ProductController.update);
router.delete('/:id', ProductController.delete);

module.exports = router;