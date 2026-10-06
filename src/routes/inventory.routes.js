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
        // CSV upload only updates stock — never deletes products from inventory
        // Match by product+variation+size_label — size_id unreliable due to Excel precision loss
        for (const update of updates) {
            const { sizeId, inStock, productName, variationName, size, unit } = update;
            // Build size label matching inventory format
            let sizeLabel = '';
            if (size && unit) sizeLabel = `${size} ${unit}`;
            else if (size) sizeLabel = size;
            else sizeLabel = ''; // will match 'Default' or '1 unit' via fallback
            if (productName) {
                if (sizeLabel) {
                    // Match by product+variation+size_label
                    const r = await pool.query(
                        `UPDATE inventory SET stock_quantity=$1, updated_at=NOW() 
                         WHERE store_id=$2 AND product_name=$3 AND variation_name=$4 AND size_label=$5`,
                        [inStock, storeId, productName, variationName || '', sizeLabel]
                    );
                    // If no match try size only (ignore unit)
                    if (r.rowCount === 0 && size) {
                        await pool.query(
                            `UPDATE inventory SET stock_quantity=$1, updated_at=NOW() 
                             WHERE store_id=$2 AND product_name=$3 AND variation_name=$4 AND size_label LIKE $5`,
                            [inStock, storeId, productName, variationName || '', `${size}%`]
                        );
                    }
                } else {
                    // No size — match by product+variation only (single size products like Mocktail)
                    await pool.query(
                        `UPDATE inventory SET stock_quantity=$1, updated_at=NOW() 
                         WHERE store_id=$2 AND product_name=$3 AND variation_name=$4`,
                        [inStock, storeId, productName, variationName || '']
                    );
                }
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
