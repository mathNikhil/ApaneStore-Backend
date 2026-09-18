const express = require('express');
const router = express.Router({ mergeParams: true });
const { getInventory, updateStock, downloadCSV, uploadCSV, syncStore } = require('../controllers/inventory.controller');
const { storeAdminAuth } = require('../middleware/storeAdminAuth');

router.get('/', storeAdminAuth, getInventory);
router.put('/:inventoryId', storeAdminAuth, updateStock);
router.get('/download-csv', storeAdminAuth, downloadCSV);
router.post('/upload-csv', storeAdminAuth, uploadCSV);
router.post('/sync', storeAdminAuth, syncStore);

const pool = require('../config/database');

// GET threshold
router.get('/threshold', storeAdminAuth, async (req, res) => {
    try {
        const { storeId } = req.params;
        const result = await pool.query(
            'SELECT low_stock_threshold FROM store_admin_credentials WHERE store_id = $1',
            [storeId]
        );
        const threshold = result.rows[0]?.low_stock_threshold || 10;
        res.json({ success: true, data: { threshold } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT threshold
router.put('/threshold', storeAdminAuth, async (req, res) => {
    try {
        const { storeId } = req.params;
        const { threshold } = req.body;
        if (!threshold || threshold < 1) return res.status(400).json({ success: false, error: 'Invalid threshold' });
        await pool.query(
            'UPDATE store_admin_credentials SET low_stock_threshold = $1 WHERE store_id = $2',
            [threshold, storeId]
        );
        res.json({ success: true, data: { threshold } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
