const express = require('express');
const router = express.Router();
const StoreController = require('../controllers/store.controller');
const { authenticate } = require('../middleware/auth');

// All store routes require authentication
router.use(authenticate);

router.get('/', StoreController.getAll);
router.get('/:id', StoreController.getById);
router.post('/', StoreController.create);
router.put('/:id', StoreController.update);
router.delete('/:id', StoreController.delete);

module.exports = router;