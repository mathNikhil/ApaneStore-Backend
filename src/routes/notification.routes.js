const express = require('express');
const router = express.Router({ mergeParams: true });
const { getNotificationStatus, disconnectGmail } = require('../controllers/notification.controller');
const { storeAdminAuth } = require('../middleware/storeAdminAuth');

router.get('/notification-status', storeAdminAuth, getNotificationStatus);
router.post('/notification/disconnect-gmail', storeAdminAuth, disconnectGmail);

module.exports = router;
