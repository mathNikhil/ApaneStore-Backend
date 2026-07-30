const pool = require('../config/database');

class AdminSettingsService {
    /**
     * Get a setting value by key
     */
    async getSetting(key, defaultValue = null) {
        try {
            const result = await pool.query(
                'SELECT setting_value FROM admin_settings WHERE setting_key = $1',
                [key]
            );
            
            if (result.rows.length === 0) {
                return defaultValue;
            }
            
            return result.rows[0].setting_value;
        } catch (error) {
            console.error('Error getting setting:', error);
            return defaultValue;
        }
    }

    /**
     * Set a setting value
     */
    async setSetting(key, value, updatedBy = null) {
        try {
            const result = await pool.query(
                `INSERT INTO admin_settings (setting_key, setting_value, updated_by, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (setting_key) 
                 DO UPDATE SET setting_value = $2, updated_by = $3, updated_at = NOW()
                 RETURNING *`,
                [key, value, updatedBy]
            );
            
            return result.rows[0];
        } catch (error) {
            console.error('Error setting setting:', error);
            throw error;
        }
    }

    /**
     * Get draft store expiry days (default: 120)
     */
    async getDraftExpiryDays() {
        const value = await this.getSetting('draft_store_expiry_days', '120');
        return parseInt(value, 10);
    }
}

module.exports = new AdminSettingsService();