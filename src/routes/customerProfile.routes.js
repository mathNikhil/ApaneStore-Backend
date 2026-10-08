const express = require('express');
const pool = require('../config/database');
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

// DPDP: Delete customer account
router.delete('/delete-account', async (req, res) => {
    try {
        const { storeId } = req.params;
        const customerId = req.customer?.id;
        if (!customerId) return res.status(401).json({ success: false, error: 'Not authenticated' });
        await pool.query(
            `UPDATE customers SET 
                phone = CONCAT('deleted_', id::text),
                name = 'Deleted User',
                email = NULL,
                is_deleted = TRUE,
                updated_at = NOW()
            WHERE id = $1 AND store_id = $2`,
            [customerId, storeId]
        );
        res.json({ success: true, message: 'Account deleted successfully' });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
