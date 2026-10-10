const express = require('express');
const router = express.Router();
const PublicStoreController = require('../controllers/public.controller');

router.get('/store/:subdomain', PublicStoreController.getBySubdomain);


// Resolve delivery zone by pincode — called from storefront when customer enters pincode
router.get('/store/:subdomain/resolve-delivery/:pincode', async (req, res) => {
    const pool = require('../config/database');
    try {
        const { subdomain, pincode } = req.params;

        // Get store config
        const result = await pool.query(
            'SELECT id, config FROM stores WHERE subdomain=$1 AND status=$2',
            [subdomain, 'published']
        );
        if (result.rows.length === 0)
            return res.status(404).json({ success: false, error: 'Store not found' });

        const store = result.rows[0];
        const config = store.config || {};
        const deliveryZones = config?.cart?.deliveryZones || [];

        // If no zones configured — delivery allowed everywhere, use flat charge
        if (!deliveryZones.length) {
            return res.json({
                success: true,
                data: {
                    deliveryAllowed: true,
                    storeAddressId: null,
                    storeAddressName: null,
                    deliveryZone: null,
                    deliveryCost: config?.cart?.deliveryCharge || 0,
                    flatRate: true
                }
            });
        }

        // Check each store address zones
        for (const address of deliveryZones) {
            for (const zone of (address.zones || [])) {
                if (!zone.pincode || !zone.pincode.trim()) continue; // skip empty zones
                if (pincode.startsWith(zone.pincode)) {
                    return res.json({
                        success: true,
                        data: {
                            deliveryAllowed: true,
                            storeAddressId: address.storeAddressId,
                            storeAddressName: address.storeAddressName,
                            deliveryZone: zone.area,
                            deliveryCost: zone.deliveryCost || 0,
                            flatRate: false
                        }
                    });
                }
            }
        }

        // No match found
        return res.json({
            success: true,
            data: {
                deliveryAllowed: false,
                storeAddressId: null,
                storeAddressName: null,
                deliveryZone: null,
                deliveryCost: null,
                flatRate: false
            }
        });

    } catch (e) {
        console.error('Resolve delivery error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;

// Get store info by ID (for popup auth branding)
router.get('/store-by-id/:storeId', async (req, res) => {
    try {
        const pool = require('../config/database');
        const { storeId } = req.params;
        const result = await pool.query(
            'SELECT id, name, subdomain, config FROM stores WHERE id=$1 AND status=$2 LIMIT 1',
            [storeId, 'published']
        );
        if (!result.rows.length) return res.json({ success: false });
        const store = result.rows[0];
        res.json({ success: true, data: { id: store.id, name: store.name, subdomain: store.subdomain, config: store.config } });
    } catch(e) { res.status(500).json({ success: false }); }
});
