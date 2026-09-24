const express = require('express');
const router = express.Router({ mergeParams: true });
const { getInventory, updateStock, downloadCSV, downloadTallyCSV, uploadCSV, syncStore, syncInventory } = require('../controllers/inventory.controller');
const { storeAdminAuth } = require('../middleware/storeAdminAuth');

router.get('/', storeAdminAuth, getInventory);
router.put('/:inventoryId', storeAdminAuth, updateStock);
router.get('/download-csv', storeAdminAuth, downloadCSV);
router.get('/download-tally-csv', storeAdminAuth, downloadTallyCSV);
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

// Tenant CSV sync endpoint (called from Step 2 after product upload)
// Uses tenant JWT auth (not store admin auth)
const { authenticate } = require('../middleware/auth');
router.post('/sync-csv', authenticate, async (req, res) => {
    try {
        const { storeId } = req.params;
        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({ success: false, error: 'Invalid updates' });
        }
        // First sync inventory to ensure all products are in inventory table
        await syncInventory(storeId);
        // Then update stock quantities
        for (const { sizeId, inStock } of updates) {
            await pool.query(
                `UPDATE inventory SET stock_quantity=$1, updated_at=NOW() WHERE store_id=$2 AND size_id=$3`,
                [inStock, storeId, String(sizeId)]
            );
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
