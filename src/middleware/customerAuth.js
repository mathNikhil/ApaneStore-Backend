const CustomerService = require('../services/customer.service');

// ✅ Validates a customer's JWT (from OTP login) for store-scoped customer
// endpoints — order creation, order history, etc. Separate from both the
// tenant's own `authenticate` and Store Admin's `storeAdminAuth` — a
// customer identity isn't a tenant or a staff session, it's the actual
// shopper.
const customerAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, error: 'Please log in to continue' });
    }

    const decoded = CustomerService.verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ success: false, error: 'Your session has expired. Please log in again.' });
    }

    // A customer's session at one store shouldn't be usable for another
    // store's orders — same phone number is a different customer per store.
    if (String(decoded.storeId) !== String(req.params.storeId)) {
        return res.status(403).json({ success: false, error: 'This session is not valid for this store' });
    }

    req.customer = decoded;
    next();
};

module.exports = { customerAuth };
