const pool = require('../config/database');
const imageService = require('./imageService');
const adminSettingsService = require('./adminSettingsService');

class StoreCleanupService {
    /**
     * ✅ MAIN CLEANUP FUNCTION
     * Called by cron job to delete expired draft stores
     * 
     * @returns {Promise<Object>} Cleanup results
     */
    async cleanupExpiredDraftStores() {
        console.log('🧹 Starting draft store cleanup...');
        const startTime = Date.now();
        
        try {
            // Get expiry days from admin settings
            const expiryDays = await adminSettingsService.getDraftExpiryDays();
            console.log(`📋 Draft stores expire after ${expiryDays} days`);
            
            // Find expired draft stores
            const expiredStores = await this.findExpiredDraftStores(expiryDays);
            
            if (expiredStores.length === 0) {
                console.log('✅ No expired draft stores to clean up');
                return {
                    success: true,
                    deleted: 0,
                    message: 'No expired stores found',
                    duration: Date.now() - startTime
                };
            }
            
            console.log(`📦 Found ${expiredStores.length} expired draft stores`);
            
            const results = [];
            let totalDeleted = 0;
            let totalFilesDeleted = 0;
            let totalSizeDeleted = 0;
            
            for (const store of expiredStores) {
                const result = await this.deleteStoreAndAssets(store);
                results.push({
                    storeId: store.id,
                    storeName: store.store_name,
                    storeId: store.store_id,
                    ...result
                });
                
                if (result.success) {
                    totalDeleted++;
                    totalFilesDeleted += result.storage?.filesDeleted || 0;
                    totalSizeDeleted += result.storage?.sizeDeleted || 0;
                }
            }
            
            const duration = Date.now() - startTime;
            
            console.log(`✅ Cleanup complete: ${totalDeleted} stores deleted in ${duration}ms`);
            console.log(`📊 Total: ${totalFilesDeleted} files, ${(totalSizeDeleted / 1024 / 1024).toFixed(2)} MB freed`);
            
            return {
                success: true,
                deleted: totalDeleted,
                totalFilesDeleted: totalFilesDeleted,
                totalSizeDeletedMB: (totalSizeDeleted / 1024 / 1024).toFixed(2),
                duration: duration,
                results: results
            };
        } catch (error) {
            console.error('❌ Cleanup error:', error);
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * ✅ Find draft stores older than expiry days
     * 
     * @param {number} expiryDays - Number of days before expiry
     * @returns {Promise<Array>} Array of expired stores
     */
    async findExpiredDraftStores(expiryDays) {
        const query = `
            SELECT id, store_id, store_name, tenant_id, created_at, status
            FROM stores
            WHERE status = 'draft'
            AND deleted_at IS NULL
            AND auto_deleted = false
            AND created_at < NOW() - INTERVAL '${expiryDays} days'
        `;
        
        const result = await pool.query(query);
        return result.rows;
    }

    /**
     * ✅ Get all draft stores (for monitoring)
     * 
     * @returns {Promise<Array>} All draft stores
     */
    async getDraftStores() {
        const query = `
            SELECT id, store_id, store_name, tenant_id, created_at, status
            FROM stores
            WHERE status = 'draft'
            AND deleted_at IS NULL
            ORDER BY created_at ASC
        `;
        
        const result = await pool.query(query);
        return result.rows;
    }

    /**
     * ✅ Delete a store and all its assets
     * 
     * @param {Object} store - Store object with id, store_id, tenant_id
     * @returns {Promise<Object>} Deletion result
     */
    async deleteStoreAndAssets(store) {
        try {
            console.log(`🗑️ Deleting draft store: ${store.store_name} (${store.store_id})`);
            
            // 1. Delete all images from storage using imageService
            const storageResult = await imageService.deleteStoreImages(
                store.tenant_id,
                store.store_id
            );
            
            // 2. Delete from database (cascade will handle related records)
            await pool.query(
                `DELETE FROM stores WHERE id = $1`,
                [store.id]
            );
            
            // 3. Log the deletion (optional - can be stored in a log table)
            console.log(`✅ Deleted store: ${store.store_name} (${store.store_id})`);
            
            return {
                success: true,
                storage: storageResult,
                storeName: store.store_name,
                storeId: store.store_id
            };
        } catch (error) {
            console.error(`❌ Error deleting store ${store.store_id}:`, error);
            return {
                success: false,
                error: error.message,
                storeName: store.store_name,
                storeId: store.store_id
            };
        }
    }

    /**
     * ✅ DELETE A SINGLE STORE (Manual trigger)
     * 
     * @param {string} storeId - Store ID to delete
     * @returns {Promise<Object>} Deletion result
     */
    async deleteStoreById(storeId) {
        try {
            // Get store details first
            const storeResult = await pool.query(
                `SELECT id, store_id, store_name, tenant_id, status 
                 FROM stores 
                 WHERE id = $1 AND deleted_at IS NULL`,
                [storeId]
            );
            
            if (storeResult.rows.length === 0) {
                return {
                    success: false,
                    error: 'Store not found or already deleted'
                };
            }
            
            const store = storeResult.rows[0];
            
            // Only allow deletion if status is draft
            if (store.status !== 'draft') {
                return {
                    success: false,
                    error: 'Only draft stores can be deleted'
                };
            }
            
            return await this.deleteStoreAndAssets(store);
        } catch (error) {
            console.error('Error deleting store by ID:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * ✅ GET EXPIRY INFO FOR A STORE
     * Used in frontend to show remaining days
     * 
     * @param {string} storeId - Store ID
     * @returns {Promise<Object|null>} Expiry information
     */
    async getStoreExpiryInfo(storeId) {
        try {
            const result = await pool.query(
                `SELECT id, store_name, status, created_at 
                 FROM stores 
                 WHERE id = $1 AND status = 'draft' AND deleted_at IS NULL`,
                [storeId]
            );
            
            if (result.rows.length === 0) {
                return null;
            }
            
            const store = result.rows[0];
            const expiryDays = await adminSettingsService.getDraftExpiryDays();
            
            const createdAt = new Date(store.created_at);
            const expiryDate = new Date(createdAt);
            expiryDate.setDate(expiryDate.getDate() + expiryDays);
            
            const now = new Date();
            const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
            
            return {
                storeId: store.id,
                storeName: store.store_name,
                status: store.status,
                createdAt: store.created_at,
                expiryDays: expiryDays,
                expiryDate: expiryDate,
                daysRemaining: daysRemaining,
                isExpired: daysRemaining <= 0,
                isWarning: daysRemaining <= 7 && daysRemaining > 0,
                isUrgent: daysRemaining <= 3 && daysRemaining > 0
            };
        } catch (error) {
            console.error('Error getting store expiry info:', error);
            return null;
        }
    }

    /**
     * ✅ GET ALL STORES WITH EXPIRY INFO (for dashboard)
     * 
     * @param {string} tenantId - Tenant ID
     * @returns {Promise<Array>} Stores with expiry info
     */
    async getStoresWithExpiryInfo(tenantId) {
        try {
            const result = await pool.query(
                `SELECT id, store_id, store_name, status, created_at 
                 FROM stores 
                 WHERE tenant_id = $1 AND deleted_at IS NULL
                 ORDER BY created_at DESC`,
                [tenantId]
            );
            
            const expiryDays = await adminSettingsService.getDraftExpiryDays();
            
            const storesWithExpiry = [];
            const now = new Date();
            
            for (const store of result.rows) {
                const storeData = {
                    ...store,
                    expiryInfo: null
                };
                
                if (store.status === 'draft') {
                    const createdAt = new Date(store.created_at);
                    const expiryDate = new Date(createdAt);
                    expiryDate.setDate(expiryDate.getDate() + expiryDays);
                    
                    const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                    
                    storeData.expiryInfo = {
                        expiryDays: expiryDays,
                        expiryDate: expiryDate,
                        daysRemaining: daysRemaining,
                        isExpired: daysRemaining <= 0,
                        isWarning: daysRemaining <= 7 && daysRemaining > 0,
                        isUrgent: daysRemaining <= 3 && daysRemaining > 0
                    };
                }
                
                storesWithExpiry.push(storeData);
            }
            
            return storesWithExpiry;
        } catch (error) {
            console.error('Error getting stores with expiry info:', error);
            return [];
        }
    }

    /**
     * ✅ GET CLEANUP STATS (for super admin dashboard)
     * 
     * @returns {Promise<Object>} Cleanup statistics
     */
    async getCleanupStats() {
        try {
            const expiryDays = await adminSettingsService.getDraftExpiryDays();
            
            // Total draft stores
            const totalResult = await pool.query(
                `SELECT COUNT(*) as total FROM stores WHERE status = 'draft' AND deleted_at IS NULL`
            );
            
            // Expired draft stores
            const expiredResult = await pool.query(
                `SELECT COUNT(*) as expired 
                 FROM stores 
                 WHERE status = 'draft' 
                 AND deleted_at IS NULL 
                 AND created_at < NOW() - INTERVAL '${expiryDays} days'`
            );
            
            // Expiring soon (within 7 days)
            const expiringResult = await pool.query(
                `SELECT COUNT(*) as expiring_soon 
                 FROM stores 
                 WHERE status = 'draft' 
                 AND deleted_at IS NULL 
                 AND created_at > NOW() - INTERVAL '${expiryDays - 7} days'
                 AND created_at < NOW() - INTERVAL '${expiryDays - 30} days'`
            );
            
            // Storage usage for draft stores
            const storageResult = await pool.query(
                `SELECT SUM(
                    (SELECT COALESCE(SUM(
                        (SELECT COALESCE(SUM(
                            (SELECT COALESCE(SUM(size), 0) 
                             FROM store_images 
                             WHERE store_id = stores.id)
                        ), 0))
                    ), 0))
                 ) as total_storage
                 FROM stores 
                 WHERE status = 'draft' AND deleted_at IS NULL`
            );
            
            return {
                totalDraftStores: parseInt(totalResult.rows[0]?.total || 0),
                expiredStores: parseInt(expiredResult.rows[0]?.expired || 0),
                expiringSoon: parseInt(expiringResult.rows[0]?.expiring_soon || 0),
                expiryDays: expiryDays,
                estimatedStorageMB: parseFloat(storageResult.rows[0]?.total_storage || 0) / (1024 * 1024)
            };
        } catch (error) {
            console.error('Error getting cleanup stats:', error);
            return null;
        }
    }

    /**
     * ✅ UPDATE STORE EXPIRY WARNING STATUS
     * Called when expiry warning is shown to user
     * 
     * @param {string} storeId - Store ID
     * @returns {Promise<Object>} Update result
     */
    async markExpiryWarningSent(storeId) {
        try {
            await pool.query(
                `UPDATE stores 
                 SET expiry_warning_sent = TRUE 
                 WHERE id = $1`,
                [storeId]
            );
            return { success: true };
        } catch (error) {
            console.error('Error marking expiry warning sent:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new StoreCleanupService();