const pool = require('../config/database');

const syncInventory = async (storeId) => {
    const storeResult = await pool.query('SELECT config FROM stores WHERE id = $1', [storeId]);
    if (storeResult.rows.length === 0) return;
    const config = storeResult.rows[0].config;
    const categories = config?.products?.categories || [];
    for (const category of categories) {
        for (const product of category.products || []) {
            for (const variation of product.variations || []) {
                // Use variant's own image, or fall back to its imageIndex in product.images
                const variantImage = variation.image?.url || variation.image?.preview ||
                    (variation.imageIndex !== undefined && variation.imageIndex !== null
                        ? (product.images?.[variation.imageIndex]?.url || product.images?.[variation.imageIndex]?.preview)
                        : null) ||
                    product.images?.[0]?.url || product.images?.[0]?.preview || null;
                for (const size of variation.sizes || []) {
                    await pool.query(`
                        INSERT INTO inventory (store_id, product_id, variation_id, size_id, product_name, variation_name, size_label, price, image_url)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                        ON CONFLICT (store_id, product_id, variation_id, size_id)
                        DO UPDATE SET product_name=EXCLUDED.product_name, variation_name=EXCLUDED.variation_name,
                            size_label=EXCLUDED.size_label, price=EXCLUDED.price, image_url=EXCLUDED.image_url,
                            is_archived=FALSE, updated_at=NOW()
                    `, [storeId, String(product.id), String(variation.id), String(size.id),
                        product.name || 'Unnamed', variation.name || 'Default',
                        size.size ? `${size.size} ${size.unit||''}`.trim() : 'Default',
                        parseFloat(size.price)||0, variantImage]);
                }
            }
        }
    }
};

const getInventory = async (req, res) => {
    try {
        const { storeId } = req.params;
        const count = await pool.query('SELECT COUNT(*) FROM inventory WHERE store_id=$1 AND is_archived=FALSE', [storeId]);
        if (parseInt(count.rows[0].count) === 0) await syncInventory(storeId);
        const result = await pool.query(`
            SELECT inv.*,
                COALESCE(s.total_sold,0) AS total_sold,
                COALESCE(r.total_returned,0) AS total_returned,
                (inv.stock_quantity - COALESCE(s.total_sold,0) + COALESCE(r.total_returned,0)) AS current_stock,
                (inv.stock_quantity - COALESCE(s.total_sold,0) + COALESCE(r.total_returned,0)) * inv.price AS total_value
            FROM inventory inv
            LEFT JOIN (
                SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                    item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_sold
                FROM orders, jsonb_array_elements(items::jsonb) AS item
                WHERE store_id=$1 AND status NOT IN ('cancelled')
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId'
            ) s ON inv.store_id=s.store_id AND inv.product_id=s.product_id AND inv.variation_id=s.variation_id AND inv.size_id=s.size_id
            LEFT JOIN (
                SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                    item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_returned
                FROM orders, jsonb_array_elements(items::jsonb) AS item
                WHERE store_id=$1 AND status='returned'
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId'
            ) r ON inv.store_id=r.store_id AND inv.product_id=r.product_id AND inv.variation_id=r.variation_id AND inv.size_id=r.size_id
            WHERE inv.store_id=$1 AND inv.is_archived=FALSE
            ORDER BY inv.product_name, inv.variation_name, inv.size_label
        `, [storeId]);
        const totalValue = result.rows.reduce((s,r) => s + parseFloat(r.total_value||0), 0);
        const totalItems = result.rows.reduce((s,r) => s + parseInt(r.current_stock||0), 0);
        res.json({ success: true, data: result.rows, summary: { totalProducts: result.rows.length, totalItems, totalValue } });
    } catch (error) {
        console.error('Inventory GET error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const updateStock = async (req, res) => {
    try {
        const { storeId, inventoryId } = req.params;
        const { stock_quantity } = req.body;
        if (stock_quantity === undefined || stock_quantity < 0)
            return res.status(400).json({ success: false, error: 'Invalid stock quantity' });
        const result = await pool.query(
            'UPDATE inventory SET stock_quantity=$1, updated_at=NOW() WHERE id=$2 AND store_id=$3 RETURNING *',
            [stock_quantity, inventoryId, storeId]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

const downloadCSV = async (req, res) => {
    try {
        const { storeId } = req.params;
        await syncInventory(storeId);
        const result = await pool.query(`
            SELECT inv.*, COALESCE(s.total_sold,0) AS total_sold, COALESCE(r.total_returned,0) AS total_returned,
                (inv.stock_quantity - COALESCE(s.total_sold,0) + COALESCE(r.total_returned,0)) AS current_stock
            FROM inventory inv
            LEFT JOIN (SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_sold
                FROM orders, jsonb_array_elements(items::jsonb) AS item
                WHERE store_id=$1 AND status NOT IN ('cancelled')
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId') s
                ON inv.store_id=s.store_id AND inv.product_id=s.product_id AND inv.variation_id=s.variation_id AND inv.size_id=s.size_id
            LEFT JOIN (SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_returned
                FROM orders, jsonb_array_elements(items::jsonb) AS item
                WHERE store_id=$1 AND status='returned'
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId') r
                ON inv.store_id=r.store_id AND inv.product_id=r.product_id AND inv.variation_id=r.variation_id AND inv.size_id=r.size_id
            WHERE inv.store_id=$1 AND inv.is_archived=FALSE
            ORDER BY inv.product_name, inv.variation_name, inv.size_label
        `, [storeId]);
        const headers = ['product_id','variation_id','size_id','product_name','variation_name','size_label','price','InStock','Sale','Return','Current_Stock'];
        const rows = result.rows.map(r => [r.product_id, r.variation_id, r.size_id,
            `"${r.product_name}"`, `"${r.variation_name}"`, `"${r.size_label}"`,
            r.price, r.stock_quantity, r.total_sold, r.total_returned, r.current_stock]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="inventory-${storeId}.csv"`);
        res.send(csv);
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

const uploadCSV = async (req, res) => {
    try {
        const { storeId } = req.params;
        const { csvData } = req.body;
        if (!csvData) return res.status(400).json({ success: false, error: 'No CSV data' });
        const lines = csvData.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const inStockIdx = headers.indexOf('InStock');
        const productIdIdx = headers.indexOf('product_id');
        const variationIdIdx = headers.indexOf('variation_id');
        const sizeIdIdx = headers.indexOf('size_id');
        if (inStockIdx === -1) return res.status(400).json({ success: false, error: 'InStock column not found' });
        let updated = 0, skipped = 0, errors = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            const productId = cols[productIdIdx]?.trim();
            const variationId = cols[variationIdIdx]?.trim();
            const sizeId = cols[sizeIdIdx]?.trim();
            const inStock = parseInt(cols[inStockIdx]?.trim());
            if (!productId || !variationId || !sizeId) { skipped++; continue; }
            if (isNaN(inStock) || inStock < 0) { errors.push(`Row ${i+1}: Invalid InStock`); skipped++; continue; }
            const r = await pool.query(
                'UPDATE inventory SET stock_quantity=$1, updated_at=NOW() WHERE store_id=$2 AND product_id=$3 AND variation_id=$4 AND size_id=$5',
                [inStock, storeId, productId, variationId, sizeId]);
            if (r.rowCount > 0) updated++; else { errors.push(`Row ${i+1}: Not found`); skipped++; }
        }
        res.json({ success: true, updated, skipped, errors });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

const syncStore = async (req, res) => {
    try {
        const { storeId } = req.params;
        await syncInventory(storeId);
        res.json({ success: true, message: 'Synced successfully' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

module.exports = { getInventory, updateStock, downloadCSV, uploadCSV, syncStore, syncInventory };
