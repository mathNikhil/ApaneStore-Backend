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

// Public endpoint to get current stock for CSV download (no auth needed — just store ID)
router.get('/stock-for-csv', async (req, res) => {
    try {
        const { storeId } = req.params;
        const result = await pool.query(
            'SELECT size_id, stock_quantity FROM inventory WHERE store_id=$1 AND is_archived=FALSE',
            [storeId]
        );
        const stockMap = {};
        result.rows.forEach(r => { stockMap[String(r.size_id)] = parseInt(r.stock_quantity) || 0; });
        res.json({ success: true, data: stockMap });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/sync-csv', authenticate, async (req, res) => {
    try {
        const { storeId } = req.params;
        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({ success: false, error: 'Invalid updates' });
        }
        // First sync inventory to ensure all products are in inventory table
        await syncInventory(storeId);
        console.log('sync-csv updates:', updates.length, 'sample:', JSON.stringify(updates[0]));
        // Remove inventory rows for products not in CSV upload
        if (updates.length > 0) {
            const productNames = [...new Set(updates.map(u => u.productName).filter(Boolean))];
            if (productNames.length > 0) {
                await pool.query(
                    `DELETE FROM inventory WHERE store_id=$1 AND product_name != ALL($2::text[])`,
                    [storeId, productNames]
                );
            }
        }
        // Match by product+variation+size_label — size_id unreliable due to Excel precision loss
        for (const update of updates) {
            const { sizeId, inStock, productName, variationName, size, unit } = update;
            const sizeLabel = size && unit ? `${size} ${unit}` : (size || '');
            if (productName) {
                // Match by name — most reliable, works even when sizeId has Excel precision loss
                await pool.query(
                    `UPDATE inventory SET stock_quantity=$1, updated_at=NOW() 
                     WHERE store_id=$2 AND product_name=$3 AND variation_name=$4 AND size_label=$5`,
                    [inStock, storeId, productName, variationName || '', sizeLabel]
                );
            } else if (sizeId) {
                // Fallback: try sizeId directly
                await pool.query(
                    `UPDATE inventory SET stock_quantity=$1, updated_at=NOW() WHERE store_id=$2 AND size_id=$3`,
                    [inStock, storeId, String(sizeId)]
                );
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
