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
                // If no sizes defined, create a default size
                const sizes = variation.sizes?.length > 0 ? variation.sizes : [{ id: `${variation.id}_default`, size: '', unit: '' }];
                for (const size of sizes) {
                    const sizeLabel = size.size ? `${size.size} ${size.unit||''}`.trim() : 'Default';
                    // Only update existing row if it has _default size_id (placeholder)
                    const existing = await pool.query(
                        'SELECT id, size_id FROM inventory WHERE store_id=$1 AND product_id=$2 AND variation_id=$3 AND size_id=$4 LIMIT 1',
                        [storeId, String(product.id), String(variation.id), `${variation.id}_default`]
                    );
                    if (existing.rows.length > 0 && String(size.id) !== `${variation.id}_default`) {
                        // Replace _default placeholder with real size_id
                        await pool.query(`
                            UPDATE inventory SET size_id=$1, size_label=$2, price=$3, image_url=$4,
                                product_name=$5, variation_name=$6, category_name=$7, is_archived=FALSE, updated_at=NOW()
                            WHERE store_id=$8 AND id=$9
                        `, [String(size.id), sizeLabel, parseFloat(size.price)||0, variantImage,
                            product.name||'Unnamed', variation.name||'Default', category.name||'',
                            storeId, existing.rows[0].id]);
                    } else {
                        await pool.query(`
                            INSERT INTO inventory (store_id, product_id, variation_id, size_id, product_name, variation_name, size_label, price, image_url, category_name)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                            ON CONFLICT (store_id, product_id, variation_id, size_id)
                            DO UPDATE SET product_name=EXCLUDED.product_name, variation_name=EXCLUDED.variation_name,
                                size_label=EXCLUDED.size_label, price=EXCLUDED.price, image_url=EXCLUDED.image_url,
                                category_name=EXCLUDED.category_name, is_archived=FALSE, updated_at=NOW()
                        `, [storeId, String(product.id), String(variation.id), String(size.id),
                            product.name||'Unnamed', variation.name||'Default', sizeLabel,
                            parseFloat(size.price)||0, variantImage, category.name||'']);
                    }
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
                COALESCE(s.instore_sold,0) AS instore_sold,
                COALESCE(s.online_sold,0) AS online_sold,
                COALESCE(r.total_returned,0) AS total_returned,
                (inv.stock_quantity - COALESCE(s.total_sold,0) + COALESCE(r.total_returned,0)) AS current_stock,
                (inv.stock_quantity - COALESCE(s.total_sold,0) + COALESCE(r.total_returned,0)) * inv.price AS total_value
            FROM inventory inv
            LEFT JOIN (
                SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                    item->>'sizeId' AS size_id,
                    SUM((item->>'quantity')::INTEGER) AS total_sold,
                    SUM(CASE WHEN order_type = 'dine_in' THEN (item->>'quantity')::INTEGER ELSE 0 END) AS instore_sold,
                    SUM(CASE WHEN order_type != 'dine_in' OR order_type IS NULL THEN (item->>'quantity')::INTEGER ELSE 0 END) AS online_sold
                FROM orders, jsonb_array_elements(items::jsonb) AS item
                WHERE store_id=$1 AND (
                    (order_type = 'dine_in' AND status IN ('confirmed', 'processing', 'delivered'))
                    OR
                    (order_type = 'delivery' AND status = 'delivered')
                    OR
                    (order_type IS NULL AND status = 'delivered')
                )
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId'
            ) s ON inv.store_id=s.store_id AND inv.product_id=s.product_id AND inv.variation_id=s.variation_id AND inv.size_id=s.size_id
            LEFT JOIN (
                SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                    item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_returned
                FROM orders, jsonb_array_elements(items::jsonb) AS item
                WHERE store_id=$1 AND status='returned'
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId'
            ) r ON inv.store_id=r.store_id AND inv.product_id=r.product_id AND inv.variation_id=r.variation_id AND inv.size_id=r.size_id
            WHERE inv.store_id=$1
            ORDER BY inv.product_name, inv.variation_name, inv.size_label
        `, [storeId]);

        // Sort by config order
        const storeRes = await pool.query('SELECT config FROM stores WHERE id=$1', [storeId]);
        const cfg = storeRes.rows[0]?.config;
        const invOrderMap = {};
        (cfg?.products?.categories || []).forEach((cat, catIdx) => {
            (cat.products || []).forEach((prod, prodIdx) => {
                (prod.variations || []).forEach((vari, variIdx) => {
                    (vari.sizes || []).forEach((sz, szIdx) => {
                        invOrderMap[String(sz.id)] = { catIdx, prodIdx, variIdx, szIdx };
                    });
                });
            });
        });
        result.rows.sort((a, b) => {
            const aO = invOrderMap[String(a.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            const bO = invOrderMap[String(b.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            if (aO.catIdx !== bO.catIdx) return aO.catIdx - bO.catIdx;
            if (aO.prodIdx !== bO.prodIdx) return aO.prodIdx - bO.prodIdx;
            if (aO.variIdx !== bO.variIdx) return aO.variIdx - bO.variIdx;
            return aO.szIdx - bO.szIdx;
        });

        // Separate active and archived — archived shown at bottom greyed out
        const activeRows = result.rows.filter(r => !r.is_archived);
        const archivedRows = result.rows.filter(r => r.is_archived);
        const allRows = [...activeRows, ...archivedRows];

        // Summary only counts active
        const totalValue = activeRows.reduce((s,r) => s + parseFloat(r.total_value||0), 0);
        const totalItems = activeRows.reduce((s,r) => s + parseInt(r.current_stock||0), 0);
        res.json({ success: true, data: allRows, summary: { totalProducts: activeRows.length, totalItems, totalValue } });
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

        // Get category order from store config
        const storeResult = await pool.query('SELECT config FROM stores WHERE id = $1', [storeId]);
        const config = storeResult.rows[0]?.config;
        const categoryOrder = (config?.products?.categories || []).map((c, idx) => ({ name: c.name?.toLowerCase(), idx }));

        const result = await pool.query(`
            SELECT inv.*, inv.category_name, COALESCE(s.total_sold,0) AS total_sold, COALESCE(r.total_returned,0) AS total_returned,
                (inv.stock_quantity - COALESCE(s.total_sold,0) + COALESCE(r.total_returned,0)) AS current_stock
            FROM inventory inv
            LEFT JOIN (SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_sold
                FROM orders, jsonb_array_elements(items::jsonb) AS item
                WHERE store_id=$1 AND (
                    (order_type = 'dine_in' AND status IN ('confirmed', 'processing', 'delivered'))
                    OR
                    (order_type = 'delivery' AND status = 'delivered')
                    OR
                    (order_type IS NULL AND status = 'delivered')
                )
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

        // Sort by config order instead of alphabetical
        const invOrderMap = {};
        (config?.products?.categories || []).forEach((cat, catIdx) => {
            (cat.products || []).forEach((prod, prodIdx) => {
                (prod.variations || []).forEach((vari, variIdx) => {
                    (vari.sizes || []).forEach((sz, szIdx) => {
                        invOrderMap[String(sz.id)] = { catIdx, prodIdx, variIdx, szIdx };
                    });
                });
            });
        });
        result.rows.sort((a, b) => {
            const aO = invOrderMap[String(a.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            const bO = invOrderMap[String(b.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            if (aO.catIdx !== bO.catIdx) return aO.catIdx - bO.catIdx;
            if (aO.prodIdx !== bO.prodIdx) return aO.prodIdx - bO.prodIdx;
            if (aO.variIdx !== bO.variIdx) return aO.variIdx - bO.variIdx;
            return aO.szIdx - bO.szIdx;
        });

        const headers = ['category_name','product_name','variation_name','size','unit','price','InStock','Sale','Return','Current_Stock','product_id','variation_id','size_id'];
        // Sort by tenant's category order
        // Build full order map: category → product → variation → size
        const orderMap = {};
        (config?.products?.categories || []).forEach((cat, catIdx) => {
            (cat.products || []).forEach((prod, prodIdx) => {
                (prod.variations || []).forEach((vari, variIdx) => {
                    (vari.sizes || []).forEach((sz, szIdx) => {
                        orderMap[String(sz.id)] = { catIdx, prodIdx, variIdx, szIdx };
                    });
                });
            });
        });

        const sortedRows = result.rows.sort((a, b) => {
            const aOrder = orderMap[String(a.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            const bOrder = orderMap[String(b.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            if (aOrder.catIdx !== bOrder.catIdx) return aOrder.catIdx - bOrder.catIdx;
            if (aOrder.prodIdx !== bOrder.prodIdx) return aOrder.prodIdx - bOrder.prodIdx;
            if (aOrder.variIdx !== bOrder.variIdx) return aOrder.variIdx - bOrder.variIdx;
            return aOrder.szIdx - bOrder.szIdx;
        });

        const rows = sortedRows.map(r => {
            const sizeLabel = r.size_label || '';
            // Split size_label into size and unit (e.g. "7 UK" -> size=7, unit=UK)
            const sizeMatch = sizeLabel.match(/^([\d.]+)\s*(.*)$/);
            const size = sizeMatch ? sizeMatch[1] : sizeLabel;
            const unit = sizeMatch ? sizeMatch[2].trim() : '';
            return [
                `"${r.category_name || ''}"`, `"${r.product_name}"`, `"${r.variation_name}"`,
                size, unit, r.price, r.stock_quantity, r.total_sold, r.total_returned, r.current_stock,
                `="${r.product_id}"`, `="${r.variation_id}"`, `="${r.size_id}"`
            ];
        });
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
        // Parse CSV properly handling quoted fields
        const parseCSVLine = (line) => {
            const cols = [];
            let current = '';
            let inQuotes = false;
            for (let c of line) {
                if (c === '"') { inQuotes = !inQuotes; }
                else if (c === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
                else { current += c; }
            }
            cols.push(current.trim());
            return cols;
        };

        const lines = csvData.trim().replace(/\r/g, '').split('\n');
        const headers = parseCSVLine(lines[0]);
        const inStockIdx = headers.indexOf('InStock');
        const productIdIdx = headers.indexOf('product_id');
        const variationIdIdx = headers.indexOf('variation_id');
        const sizeIdIdx = headers.indexOf('size_id');
        if (inStockIdx === -1) return res.status(400).json({ success: false, error: 'InStock column not found' });
        // Strip Excel ="..." format and handle scientific notation
        const toFullInt = (val) => {
            if (!val) return val;
            // Strip ="..." Excel text format
            val = val.trim().replace(/^="?(.*?)"?$/, '$1');
            return val;
        };

        let updated = 0, skipped = 0, errors = [];
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) { skipped++; continue; }
            const cols = parseCSVLine(lines[i]);
            const productId = toFullInt(cols[productIdIdx]);
            const variationId = toFullInt(cols[variationIdIdx]);
            const sizeId = toFullInt(cols[sizeIdIdx]);
            const inStock = parseInt(cols[inStockIdx]?.trim());
            if (!productId || !variationId || !sizeId) { skipped++; continue; }
            if (isNaN(inStock) || inStock < 0) { errors.push(`Row ${i+1}: Invalid InStock`); skipped++; continue; }
            console.log(`Upload matching: storeId=${storeId} productId=${productId} variationId=${variationId} sizeId=${sizeId}`);
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

        // Archive products in inventory that no longer exist in store config
        const storeResult = await pool.query('SELECT config FROM stores WHERE id=$1', [storeId]);
        const config = storeResult.rows[0]?.config;
        const configProductIds = [];
        (config?.products?.categories || []).forEach(cat => {
            (cat.products || []).forEach(prod => {
                if (!prod._archived) configProductIds.push(String(prod.id));
            });
        });

        if (configProductIds.length > 0) {
            // Archive inventory rows for products not in config
            await pool.query(
                `UPDATE inventory SET is_archived=TRUE, updated_at=NOW() 
                 WHERE store_id=$1 AND product_id != ALL($2::text[]) AND is_archived=FALSE`,
                [storeId, configProductIds]
            );
        }

        res.json({ success: true, message: 'Synced successfully' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

const downloadTallyCSV = async (req, res) => {
    try {
        const { storeId } = req.params;
        await syncInventory(storeId);

        const storeResult = await pool.query('SELECT config FROM stores WHERE id = $1', [storeId]);
        const config = storeResult.rows[0]?.config;
        const hsnCode = config?.cart?.hsnCode || '';
        const gstRate = config?.cart?.gstRate || 0;
        const tallyStockGroup = config?.cart?.tallyStockGroup || 'Trading Goods';
        const categoryOrder = (config?.products?.categories || []).map((c, idx) => ({ name: c.name?.toLowerCase(), idx }));

        const result = await pool.query(`
            SELECT inv.*, COALESCE(s.total_sold,0) AS total_sold, COALESCE(r.total_returned,0) AS total_returned,
                (inv.stock_quantity - COALESCE(s.total_sold,0) + COALESCE(r.total_returned,0)) AS current_stock
            FROM inventory inv
            LEFT JOIN (SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_sold
                FROM orders o, jsonb_array_elements(o.items::jsonb) AS item
                WHERE o.store_id=$1 AND (
                    (o.order_type = 'dine_in' AND o.status IN ('confirmed','processing','delivered'))
                    OR (o.order_type = 'delivery' AND o.status = 'delivered')
                    OR (o.order_type IS NULL AND o.status = 'delivered')
                )
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId') s
                ON inv.store_id=s.store_id AND inv.product_id=s.product_id AND inv.variation_id=s.variation_id AND inv.size_id=s.size_id
            LEFT JOIN (SELECT store_id, item->>'productId' AS product_id, item->>'variationId' AS variation_id,
                item->>'sizeId' AS size_id, SUM((item->>'quantity')::INTEGER) AS total_returned
                FROM orders o, jsonb_array_elements(o.items::jsonb) AS item
                WHERE o.store_id=$1 AND o.status='returned'
                GROUP BY store_id, item->>'productId', item->>'variationId', item->>'sizeId') r
                ON inv.store_id=r.store_id AND inv.product_id=r.product_id AND inv.variation_id=r.variation_id AND inv.size_id=r.size_id
            WHERE inv.store_id=$1 AND inv.is_archived=FALSE
        `, [storeId]);

        // Build full order map: category → product → variation → size
        const orderMap = {};
        (config?.products?.categories || []).forEach((cat, catIdx) => {
            (cat.products || []).forEach((prod, prodIdx) => {
                (prod.variations || []).forEach((vari, variIdx) => {
                    (vari.sizes || []).forEach((sz, szIdx) => {
                        orderMap[String(sz.id)] = { catIdx, prodIdx, variIdx, szIdx };
                    });
                });
            });
        });

        const sortedRows = result.rows.sort((a, b) => {
            const aOrder = orderMap[String(a.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            const bOrder = orderMap[String(b.size_id)] || { catIdx: 999, prodIdx: 999, variIdx: 999, szIdx: 999 };
            if (aOrder.catIdx !== bOrder.catIdx) return aOrder.catIdx - bOrder.catIdx;
            if (aOrder.prodIdx !== bOrder.prodIdx) return aOrder.prodIdx - bOrder.prodIdx;
            if (aOrder.variIdx !== bOrder.variIdx) return aOrder.variIdx - bOrder.variIdx;
            return aOrder.szIdx - bOrder.szIdx;
        });

        const headers = ['Item Name','Stock Group','HSN/SAC Code','Unit of Measure','GST Rate (%)','Opening Qty','Opening Rate (Rs.)','Opening Value (Rs.)'];

        const rows = sortedRows.map(r => {
            const sizeLabel = r.size_label || '';
            const sizeMatch = sizeLabel.match(/^([\d.]+)\s*(.*)$/);
            const unit = sizeMatch ? sizeMatch[2].trim() : 'Nos';
            const itemName = [r.product_name, r.variation_name, sizeLabel].filter(Boolean).join(' - ');
            const openingQty = parseInt(r.current_stock || 0);
            const rate = parseFloat(r.price || 0);
            const openingValue = (openingQty * rate).toFixed(2);
            return [
                `"${itemName}"`,
                `"${tallyStockGroup}"`,
                hsnCode || '',
                unit || 'Nos',
                gstRate,
                openingQty,
                rate.toFixed(2),
                openingValue
            ];
        });

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="tally-inventory-${storeId}.csv"`);
        res.send(csv);
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

module.exports = { getInventory, updateStock, downloadCSV, downloadTallyCSV, uploadCSV, syncStore, syncInventory };
