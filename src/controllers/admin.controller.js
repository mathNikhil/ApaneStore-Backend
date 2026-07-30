const adminSettingsService = require('../services/adminSettingsService');
const storeCleanupService = require('../services/storeCleanupService');

// ✅ Get platform settings
const getSettings = async (req, res) => {
    try {
        const expiryDays = await adminSettingsService.getDraftExpiryDays();
        
        res.json({
            success: true,
            data: {
                draftStoreExpiryDays: parseInt(expiryDays, 10)
            }
        });
    } catch (error) {
        console.error('Error getting settings:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// ✅ Update platform settings
const updateSettings = async (req, res) => {
    try {
        const { draftStoreExpiryDays } = req.body;
        
        if (!draftStoreExpiryDays || draftStoreExpiryDays < 1) {
            return res.status(400).json({
                success: false,
                error: 'Invalid expiry days value'
            });
        }
        
        await adminSettingsService.setSetting(
            'draft_store_expiry_days', 
            String(draftStoreExpiryDays),
            req.tenantId
        );
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            data: {
                draftStoreExpiryDays: parseInt(draftStoreExpiryDays, 10)
            }
        });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// ✅ Manual cleanup trigger (for testing)
const triggerCleanup = async (req, res) => {
    try {
        const result = await storeCleanupService.cleanupExpiredDraftStores();
        res.json(result);
    } catch (error) {
        console.error('Error triggering cleanup:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// ✅ Get expiry info for a store
const getStoreExpiryInfo = async (req, res) => {
    try {
        const { storeId } = req.params;
        const info = await storeCleanupService.getStoreExpiryInfo(storeId);
        
        if (!info) {
            return res.status(404).json({
                success: false,
                error: 'Store not found or not in draft status'
            });
        }
        
        res.json({
            success: true,
            data: info
        });
    } catch (error) {
        console.error('Error getting store expiry info:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// ✅ Get cleanup statistics (for Super Admin dashboard)
const getCleanupStats = async (req, res) => {
    try {
        const stats = await storeCleanupService.getCleanupStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error getting cleanup stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// Export all methods
module.exports = {
    getSettings,
    updateSettings,
    triggerCleanup,
    getStoreExpiryInfo,
    getCleanupStats,
};