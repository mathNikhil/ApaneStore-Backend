const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/product.controller');
const { authenticate } = require('../middleware/auth');
const contentFilter = require('../middleware/contentFilter');

// All product routes require authentication
router.use(authenticate);

router.get('/', ProductController.getAll);
router.get('/:id', ProductController.getById);
router.post('/', contentFilter, ProductController.create);
router.put('/:id', contentFilter, ProductController.update);
router.delete('/:id', ProductController.delete);

module.exports = router;