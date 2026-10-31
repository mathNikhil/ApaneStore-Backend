const pool = require('../config/database');

// ✅ The centerpiece of making the storefront real — until now, placing an
// order only updated local browser state and never touched the database.
// This is the actual save-to-database endpoint, called by the customer's
// checkout, and it's what finally makes Store Admin's order list mean
// something.
const CustomerOrderController = {
    // POST /api/store/:storeId/orders
    // body: { items, deliveryAddress, paymentMethod, subtotal, deliveryCharge, taxAmount, totalAmount }
    create: async (req, res) => {
        try {
            const { storeId } = req.params;
            const { customerId, phone } = req.customer;
            const { items, deliveryAddress, paymentMethod, customerUpiId, subtotal, deliveryCharge, taxAmount, totalAmount, orderType, branchId, branchName, deliveryZone, deliveryCost, dineInCustomerName, dineInCustomerMobile, discountAmount, couponCode } = req.body;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, error: 'Order must include at least one item' });
            }
            if (!deliveryAddress && orderType !== 'dine_in') {
                return res.status(400).json({ success: false, error: 'Delivery address is required' });
            }
            if (totalAmount === undefined || totalAmount === null) {
                return res.status(400).json({ success: false, error: 'Total amount is required' });
            }
            // ✅ Only meaningful on the COD+UPI tier (no real gateway yet) —
            // required so an operator has something to actually cross-check
            // against their own bank/UPI app before confirming the order.
            if (paymentMethod === 'upi' && !customerUpiId) {
                return res.status(400).json({ success: false, error: 'Please enter your UPI ID' });
            }

            // ── SECURITY: Re-verify prices server-side (SEC-PRICE) ──────────────────
            // Never trust prices or totals from the client. Look up each item's
            // actual price from the DB, recompute all totals server-side, and
            // reject if the client total diverges by more than ₹1.
            //
            // Products with multiple variations/sizes use the `inventory` table
            // (which mirrors per-size prices from the builder). Simple single-price
            // products fall back to `products.price`.
            const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))];

            // Fetch base prices from products table (covers simple products)
            let basePriceMap = {};
            if (productIds.length > 0) {
                const priceRows = await pool.query(
                    `SELECT id, price FROM products
                     WHERE id = ANY($1::int[]) AND store_id = $2 AND is_active = true`,
                    [productIds, storeId]
                );
                for (const row of priceRows.rows) {
                    basePriceMap[row.id] = parseFloat(row.price);
                }
            }

            // Fetch per-variation/size prices from inventory table where provided
            // Key: `${productId}:${variationId}:${sizeId}`
            const inventoryLookups = items
                .filter(i => i.productId && (i.variationId || i.sizeId))
                .map(i => ({ productId: i.productId, variationId: i.variationId, sizeId: i.sizeId }));

            let inventoryPriceMap = {};
            if (inventoryLookups.length > 0) {
                const invRows = await pool.query(
                    `SELECT product_id, variation_id, size_id, price FROM inventory
                     WHERE store_id = $1
                       AND product_id = ANY($2::int[])
                       AND is_archived = FALSE`,
                    [storeId, productIds]
                );
                for (const row of invRows.rows) {
                    const key = `${row.product_id}:${row.variation_id || ''}:${row.size_id || ''}`;
                    inventoryPriceMap[key] = parseFloat(row.price);
                }
            }

            // Rebuild items with verified prices; reject any item whose product isn't found
            const verifiedItems = [];
            for (const item of items) {
                let dbPrice;

                // Try inventory first (per-variation/size price)
                if (item.productId && (item.variationId || item.sizeId)) {
                    const key = `${item.productId}:${item.variationId || ''}:${item.sizeId || ''}`;
                    dbPrice = inventoryPriceMap[key];
                }

                // Fall back to base product price
                if (dbPrice === undefined) {
                    dbPrice = basePriceMap[item.productId];
                }

                if (dbPrice === undefined) {
                    // Product not found in this store — possibly a tampered productId
                    return res.status(400).json({
                        success: false,
                        error: `Product not found or unavailable: ${item.name || item.productId}`
                    });
                }
                verifiedItems.push({ ...item, price: dbPrice, total: dbPrice * item.quantity });
            }

            // Recompute totals from store's own config
            const storeConfigResult = await pool.query('SELECT config FROM stores WHERE id = $1', [storeId]);
            const storeConfig = storeConfigResult.rows[0]?.config || {};
            const cartCfg = storeConfig.cart || {};

            const serverSubtotal = Math.round(
                verifiedItems.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100
            ) / 100;

            // GST
            const enableGST = cartCfg.enableGST ?? false;
            const gstRate = parseFloat(cartCfg.gstRate) || 0;
            const serverTax = enableGST
                ? Math.round(serverSubtotal * (gstRate / 100) * 100) / 100
                : 0;

            // Delivery
            let serverDelivery = 0;
            if (orderType !== 'dine_in') {
                const freeDelivery = cartCfg.freeDelivery ?? false;
                const freeThreshold = parseFloat(cartCfg.freeDeliveryThreshold) || 0;
                const baseDelivery = parseFloat(cartCfg.deliveryCharge) || 0;
                serverDelivery = (freeDelivery && serverSubtotal >= freeThreshold) ? 0 : baseDelivery;
            }

            // Coupon discount — re-validate server-side if one was applied
            let serverDiscount = 0;
            if (couponCode) {
                const couponResult = await pool.query(
                    `SELECT unit, value, min_order_value FROM discount_codes
                     WHERE store_id = $1 AND code = $2
                       AND status != 'disabled'
                       AND start_at <= NOW() AND end_at >= NOW()
                       AND (max_uses IS NULL OR current_uses < max_uses)
                     LIMIT 1`,
                    [storeId, couponCode.trim().toUpperCase()]
                );
                if (couponResult.rows.length > 0) {
                    const coupon = couponResult.rows[0];
                    const minOrder = parseFloat(coupon.min_order_value) || 0;
                    if (serverSubtotal >= minOrder) {
                        const val = parseFloat(coupon.value) || 0;
                        if (coupon.unit === 'percent') {
                            serverDiscount = Math.round(serverSubtotal * val / 100 * 100) / 100;
                        } else {
                            serverDiscount = Math.min(val, serverSubtotal);
                        }
                    }
                }
                // If coupon not found/expired, serverDiscount stays 0 — not a hard error;
                // coupon atomicity is enforced below when we claim it.
            }

            const serverTotal = Math.round(
                (serverSubtotal + serverTax + serverDelivery - serverDiscount) * 100
            ) / 100;

            // Reject if client total is more than ₹1 off from what we computed
            // (small float rounding is tolerated; a ₹1+ gap is manipulation)
            if (Math.abs(serverTotal - parseFloat(totalAmount)) > 1.0) {
                console.warn(`⚠️ Price mismatch storeId=${storeId} customerId=${customerId}: client ₹${totalAmount} vs server ₹${serverTotal}`);
                return res.status(400).json({
                    success: false,
                    error: 'Order total mismatch. Please refresh your cart and try again.'
                });
            }

            // Use server-computed values — never the client's
            const safeSubtotal = serverSubtotal;
            const safeTax = serverTax;
            const safeDelivery = serverDelivery;
            const safeDiscount = serverDiscount;
            const safeTotal = serverTotal;
            // ── end price verification ───────────────────────────────────────────────

            const customerResult = await pool.query('SELECT name, phone, email FROM customers WHERE id = $1', [customerId]);
            const customer = customerResult.rows[0] || {};

            const orderId = `ORD-${Date.now()}`;

            // If a coupon code was applied, atomically claim one use BEFORE inserting
            // the order. The /use endpoint uses UPDATE ... WHERE current_uses < max_uses
            // so concurrent checkouts can't both consume the last slot.
            if (couponCode) {
                const useRes = await pool.query(
                    `UPDATE discount_codes
                     SET current_uses = current_uses + 1
                     WHERE store_id = $1 AND code = $2
                       AND status != 'disabled'
                       AND start_at <= NOW() AND end_at >= NOW()
                       AND (max_uses IS NULL OR current_uses < max_uses)
                     RETURNING id`,
                    [storeId, couponCode.trim().toUpperCase()]
                );
                if (useRes.rows.length === 0) {
                    // Coupon expired or just ran out — reject the order so customer sees the real reason
                    return res.status(409).json({
                        success: false,
                        coupon_error: true,
                        error: 'The coupon you applied is no longer valid. Please remove it and try again, or use a different offer.'
                    });
                }
            }

            const result = await pool.query(
                `INSERT INTO orders
                    (order_id, store_id, customer_id, customer_name, customer_phone, customer_email, items, delivery_address,
                     subtotal, delivery_charge, tax_amount, total_amount, payment_method, customer_upi_id, status, payment_status, order_type,
                     branch_id, branch_name, delivery_zone, delivery_cost, dine_in_customer_name, dine_in_customer_mobile, discount_amount, coupon_code)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CASE WHEN $15 = 'dine_in' THEN 'delivered' ELSE 'pending' END, CASE WHEN $15 = 'dine_in' THEN 'paid' ELSE 'pending' END, $15, $16, $17, $18, $19, $20, $21, $22, $23)
                 RETURNING *`,
                [
                    orderId, storeId, customerId, customer.name || null, customer.phone || phone,
                    customer.email || null,
                    JSON.stringify(verifiedItems), JSON.stringify(deliveryAddress),
                    safeSubtotal, safeDelivery, safeTax, safeTotal, paymentMethod || null,
                    paymentMethod === 'upi' ? customerUpiId : null,
                    orderType || 'delivery',
                    branchId || null, branchName || null, deliveryZone || null, deliveryCost || null,
                    (orderType === 'dine_in' && dineInCustomerName) ? dineInCustomerName.trim() : null,
                    (orderType === 'dine_in' && dineInCustomerMobile) ? dineInCustomerMobile.trim() : null,
                    safeDiscount, couponCode || null
                ]
            );

            const order = result.rows[0];

            await pool.query(
                `INSERT INTO order_status_history (order_id, status, changed_by, notes)
                 VALUES ($1, 'pending', $2, 'Order placed by customer')`,
                [order.id, phone]
            );

            // ── Service bookings: lock the slots so no other customer can take them ──
            // Each cart item for a service store carries selectedSlots: [{date, startTime, staffName}]
            // We write one row per slot into service.bookings so the slot-availability
            // check (slots.controller) sees them as occupied and blocks overbooking.
            try {
                const storeRow = await pool.query(
                    `SELECT id AS store_int_id, store_id AS store_str_id FROM stores
                     WHERE store_id = $1
                        OR (id::text = $1 AND $1 ~ '^[0-9]+$')
                     LIMIT 1`,
                    [String(storeId)]
                );
                const storeIntId = storeRow.rows[0]?.store_int_id;   // integer — for bookings.store_id
                const storeStrId = storeRow.rows[0]?.store_str_id;   // 'STORE_...' — for staff_members.store_id

                for (const item of verifiedItems) {
                    const slots = item.selectedSlots || [];
                    if (!slots.length) continue;

                    const duration = parseInt(item.duration) || 60;

                    for (const slot of slots) {
                        // Resolve staff_id from name — use ILIKE so case differences don't cause null
                        let staffId = null;
                        const staffName = slot.staffName || item.staffName || null;
                        if (storeStrId && staffName && staffName !== 'All Staff') {
                            const staffRow = await pool.query(
                                `SELECT id FROM service.staff_members WHERE store_id = $1 AND TRIM(name) ILIKE TRIM($2) LIMIT 1`,
                                [storeStrId, staffName]
                            );
                            staffId = staffRow.rows[0]?.id || null;
                        }

                        const bookingServiceType = (orderType === 'delivery' || orderType === 'home_visit' || orderType === 'homevisit') ? 'homevisit' : 'inshop';
                        // Store the raw staff name so the appointments scheduler can
                        // place the booking in the correct column even if the id
                        // lookup above returned null (case mismatch, trim difference, etc.)
                        const requestedStaffName = (staffName && staffName !== 'All Staff') ? staffName.trim() : null;
                        await pool.query(
                            `INSERT INTO service.bookings
                                (store_id, order_id, booking_date, booking_time, duration_mins, staff_id, requested_staff_name, notes, status, service_type)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9)
                             ON CONFLICT DO NOTHING`,
                            [
                                storeIntId,
                                order.id,
                                slot.date,
                                slot.startTime,
                                duration,
                                staffId,
                                requestedStaffName,
                                item.name ? `${item.name} | order ${order.order_id}` : `order ${order.order_id}`,
                                bookingServiceType,
                            ]
                        );
                    }
                }
            } catch (bookingErr) {
                // Non-fatal: order is already placed, just log and continue
                console.warn('⚠️ Service booking slots save failed:', bookingErr.message);
            }

            // Auto-add customer to WA contacts using delivery address name + phone
            try {
                const tenantRes = await pool.query('SELECT tenant_id FROM stores WHERE id = $1', [storeId]);
                if (tenantRes.rows.length > 0) {
                    const tenantId = tenantRes.rows[0].tenant_id;
                    const recipientName = deliveryAddress?.recipientName || customer.name || null;
                    const recipientPhone = deliveryAddress?.recipientMobile || customer.phone || phone;
                    if (recipientPhone) {
                        await pool.query(
                            `INSERT INTO wa_contacts (tenant_id, store_id, name, phone, created_at)
                             VALUES ($1, $2, $3, $4, NOW())
                             ON CONFLICT (tenant_id, phone) WHERE tenant_id IS NOT NULL DO NOTHING`,
                            [tenantId, storeId, recipientName || recipientPhone, recipientPhone]
                        );
                    }
                }
            } catch (waErr) {
                console.warn('⚠️ WA contact auto-add skipped:', waErr.message);
            }

            res.status(201).json({ success: true, data: order });
        } catch (error) {
            console.error('❌ Create order error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to place order' });
        }
    },

    // GET /api/store/:storeId/orders/mine — the logged-in customer's own order history
    getMine: async (req, res) => {
        try {
            const { storeId } = req.params;
            const { customerId } = req.customer;

            const result = await pool.query(
                'SELECT * FROM orders WHERE store_id = $1 AND customer_id = $2 ORDER BY created_at DESC',
                [storeId, customerId]
            );

            res.json({ success: true, data: result.rows });
        } catch (error) {
            console.error('❌ Get my orders error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get orders' });
        }
    },
};

module.exports = CustomerOrderController;
