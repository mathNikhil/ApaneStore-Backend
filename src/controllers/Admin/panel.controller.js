const pool = require('../../config/database');
const logger = require('../../config/logger');

class AdminPanelController {
    // Get panel configuration for a store
    static async getStorePanels(req, res) {
        try {
            const { storeId } = req.params;

            const result = await pool.query(
                `SELECT 
                    panel_type,
                    is_enabled,
                    settings,
                    created_at,
                    updated_at
                 FROM store_permissions
                 WHERE store_id = $1
                 ORDER BY panel_type`,
                [storeId]
            );

            // Ensure all panel types exist
            const panelTypes = ['admin', 'production', 'delivery'];
            const existingPanels = result.rows.map(r => r.panel_type);
            
            const allPanels = panelTypes.map(type => {
                const existing = result.rows.find(r => r.panel_type === type);
                if (existing) return existing;
                return {
                    panel_type: type,
                    is_enabled: type === 'admin', // admin is always enabled by default
                    settings: {},
                    created_at: null,
                    updated_at: null
                };
            });

            res.status(200).json({
                success: true,
                data: allPanels
            });
        } catch (error) {
            logger.error('❌ Get store panels error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get store panels'
            });
        }
    }

    // Update panel configuration for a store
    static async updateStorePanels(req, res) {
        try {
            const { storeId } = req.params;
            const { panels } = req.body;
            const adminId = req.adminId;

            if (!panels || !Array.isArray(panels)) {
                return res.status(400).json({
                    success: false,
                    error: 'Panels array is required'
                });
            }

            // Verify store exists
            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1',
                [storeId]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            const results = [];
            for (const panel of panels) {
                const { panel_type, is_enabled, settings } = panel;

                if (!panel_type || !['admin', 'production', 'delivery'].includes(panel_type)) {
                    continue;
                }

                // Admin panel cannot be disabled
                if (panel_type === 'admin' && is_enabled === false) {
                    continue;
                }

                const result = await pool.query(
                    `INSERT INTO store_permissions (store_id, panel_type, is_enabled, settings, updated_by, updated_at)
                     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                     ON CONFLICT (store_id, panel_type) 
                     DO UPDATE SET 
                        is_enabled = EXCLUDED.is_enabled,
                        settings = EXCLUDED.settings,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = CURRENT_TIMESTAMP
                     RETURNING *`,
                    [storeId, panel_type, is_enabled, settings || {}, adminId]
                );

                results.push(result.rows[0]);
            }

            logger.info(`✅ Store ${storeId} panels updated by admin ${adminId}`);

            res.status(200).json({
                success: true,
                message: 'Panel configuration updated successfully',
                data: results
            });
        } catch (error) {
            logger.error('❌ Update store panels error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update store panels'
            });
        }
    }

    // Toggle a single panel (quick action)
    static async togglePanel(req, res) {
        try {
            const { storeId, panelType } = req.params;
            const { is_enabled } = req.body;
            const adminId = req.adminId;

            if (!['admin', 'production', 'delivery'].includes(panelType)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid panel type'
                });
            }

            // Admin panel cannot be disabled
            if (panelType === 'admin' && is_enabled === false) {
                return res.status(400).json({
                    success: false,
                    error: 'Admin panel cannot be disabled'
                });
            }

            // Verify store exists
            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1',
                [storeId]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            const result = await pool.query(
                `INSERT INTO store_permissions (store_id, panel_type, is_enabled, updated_by, updated_at)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                 ON CONFLICT (store_id, panel_type) 
                 DO UPDATE SET 
                    is_enabled = EXCLUDED.is_enabled,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = CURRENT_TIMESTAMP
                 RETURNING *`,
                [storeId, panelType, is_enabled, adminId]
            );

            logger.info(`✅ Panel ${panelType} for store ${storeId} set to ${is_enabled}`);

            res.status(200).json({
                success: true,
                message: `Panel ${panelType} ${is_enabled ? 'enabled' : 'disabled'} successfully`,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Toggle panel error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to toggle panel'
            });
        }
    }
}

module.exports = AdminPanelController;