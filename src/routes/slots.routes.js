const express = require('express');
const router = express.Router({ mergeParams: true });
const SlotsController = require('../controllers/slots.controller');

router.get('/', SlotsController.getAvailableSlots);

module.exports = router;
