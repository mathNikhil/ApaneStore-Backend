const pool = require('../config/database');

// ✅ Real customer profile + address book — replaces what was previously a
// hardcoded sample name/email/address shown to every customer regardless
// of what they actually entered, never sent to the backend at all.
const CustomerProfileController = {
    // GET /api/store/:storeId/customers/me
    getMe: async (req, res) => {
        try {
            const { customerId } = req.customer;

            const customerResult = await pool.query(
                'SELECT id, customer_id, name, email, phone FROM customers WHERE id = $1',
                [customerId]
            );
            if (customerResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Customer not found' });
            }

            const addressesResult = await pool.query(
                'SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC',
                [customerId]
            );

            res.json({
                success: true,
                data: {
                    ...customerResult.rows[0],
                    addresses: addressesResult.rows,
                },
            });
        } catch (error) {
            console.error('❌ Get customer profile error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get profile' });
        }
    },

    // PATCH /api/store/:storeId/customers/me   body: { name?, email? }
    updateMe: async (req, res) => {
        try {
            const { customerId } = req.customer;
            const { name, email } = req.body;

            const current = await pool.query('SELECT name, email FROM customers WHERE id = $1', [customerId]);
            if (current.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Customer not found' });
            }

            const result = await pool.query(
                `UPDATE customers SET name = $1, email = $2 WHERE id = $3
                 RETURNING id, customer_id, name, email, phone`,
                [
                    name !== undefined ? name : current.rows[0].name,
                    email !== undefined ? email : current.rows[0].email,
                    customerId,
                ]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Update customer profile error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to update profile' });
        }
    },

    // POST /api/store/:storeId/customers/me/addresses
    addAddress: async (req, res) => {
        try {
            const { storeId } = req.params;
            const { customerId } = req.customer;
            const { label, recipientName, recipientMobile, addressLine1, addressLine2, city, state, pincode, landmark, isDefault } = req.body;

            if (!addressLine1 || !city || !pincode) {
                return res.status(400).json({ success: false, error: 'Address line, city, and pincode are required' });
            }

            const existingCount = await pool.query('SELECT COUNT(*) FROM customer_addresses WHERE customer_id = $1', [customerId]);
            const isFirst = parseInt(existingCount.rows[0].count, 10) === 0;
            const shouldBeDefault = isFirst || !!isDefault;

            if (shouldBeDefault) {
                await pool.query('UPDATE customer_addresses SET is_default = false WHERE customer_id = $1', [customerId]);
            }

            const result = await pool.query(
                `INSERT INTO customer_addresses
                    (customer_id, store_id, label, recipient_name, recipient_mobile, address_line1, address_line2, city, state, pincode, landmark, is_default)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING *`,
                [customerId, storeId, label || 'Home', recipientName || null, recipientMobile || null, addressLine1, addressLine2 || null, city, state || null, pincode, landmark || null, shouldBeDefault]
            );

            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Add address error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to add address' });
        }
    },

    // PUT /api/store/:storeId/customers/me/addresses/:addressId
    updateAddress: async (req, res) => {
        try {
            const { addressId } = req.params;
            const { customerId } = req.customer;
            const { label, recipientName, recipientMobile, addressLine1, addressLine2, city, state, pincode, landmark } = req.body;

            const existing = await pool.query(
                'SELECT * FROM customer_addresses WHERE id = $1 AND customer_id = $2',
                [addressId, customerId]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Address not found' });
            }
            const current = existing.rows[0];

            const result = await pool.query(
                `UPDATE customer_addresses
                 SET label = $1, recipient_name = $2, recipient_mobile = $3, address_line1 = $4,
                     address_line2 = $5, city = $6, state = $7, pincode = $8, landmark = $9, updated_at = NOW()
                 WHERE id = $10
                 RETURNING *`,
                [
                    label !== undefined ? label : current.label,
                    recipientName !== undefined ? recipientName : current.recipient_name,
                    recipientMobile !== undefined ? recipientMobile : current.recipient_mobile,
                    addressLine1 !== undefined ? addressLine1 : current.address_line1,
                    addressLine2 !== undefined ? addressLine2 : current.address_line2,
                    city !== undefined ? city : current.city,
                    state !== undefined ? state : current.state,
                    pincode !== undefined ? pincode : current.pincode,
                    landmark !== undefined ? landmark : current.landmark,
                    addressId,
                ]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Update address error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to update address' });
        }
    },

    // DELETE /api/store/:storeId/customers/me/addresses/:addressId
    deleteAddress: async (req, res) => {
        try {
            const { addressId } = req.params;
            const { customerId } = req.customer;

            const existing = await pool.query(
                'SELECT * FROM customer_addresses WHERE id = $1 AND customer_id = $2',
                [addressId, customerId]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Address not found' });
            }
            const wasDefault = existing.rows[0].is_default;

            await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);

            // Promote the next-most-recent address to default if we just deleted the default one
            if (wasDefault) {
                const remaining = await pool.query(
                    'SELECT id FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1',
                    [customerId]
                );
                if (remaining.rows.length > 0) {
                    await pool.query('UPDATE customer_addresses SET is_default = true WHERE id = $1', [remaining.rows[0].id]);
                }
            }

            res.json({ success: true });
        } catch (error) {
            console.error('❌ Delete address error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to delete address' });
        }
    },

    // PUT /api/store/:storeId/customers/me/addresses/:addressId/default
    setDefaultAddress: async (req, res) => {
        try {
            const { addressId } = req.params;
            const { customerId } = req.customer;

            const existing = await pool.query(
                'SELECT id FROM customer_addresses WHERE id = $1 AND customer_id = $2',
                [addressId, customerId]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Address not found' });
            }

            await pool.query('UPDATE customer_addresses SET is_default = (id = $1) WHERE customer_id = $2', [addressId, customerId]);

            res.json({ success: true });
        } catch (error) {
            console.error('❌ Set default address error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to set default address' });
        }
    },
};

module.exports = CustomerProfileController;
