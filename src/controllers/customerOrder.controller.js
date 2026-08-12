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
            const { items, deliveryAddress, paymentMethod, customerUpiId, subtotal, deliveryCharge, taxAmount, totalAmount } = req.body;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, error: 'Order must include at least one item' });
            }
            if (!deliveryAddress) {
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

            const customerResult = await pool.query('SELECT name, phone FROM customers WHERE id = $1', [customerId]);
            const customer = customerResult.rows[0] || {};

            const orderId = `ORD-${Date.now()}`;

            const result = await pool.query(
                `INSERT INTO orders
                    (order_id, store_id, customer_id, customer_name, customer_phone, items, delivery_address,
                     subtotal, delivery_charge, tax_amount, total_amount, payment_method, customer_upi_id, status, payment_status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', 'pending')
                 RETURNING *`,
                [
                    orderId, storeId, customerId, customer.name || null, customer.phone || phone,
                    JSON.stringify(items), JSON.stringify(deliveryAddress),
                    subtotal || 0, deliveryCharge || 0, taxAmount || 0, totalAmount, paymentMethod || null,
                    paymentMethod === 'upi' ? customerUpiId : null,
                ]
            );

            const order = result.rows[0];

            await pool.query(
                `INSERT INTO order_status_history (order_id, status, changed_by, notes)
                 VALUES ($1, 'pending', $2, 'Order placed by customer')`,
                [order.id, phone]
            );

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
