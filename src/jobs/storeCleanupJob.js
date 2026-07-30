const cron = require('node-cron');
const storeCleanupService = require('../services/storeCleanupService');

/**
 * ✅ SCHEDULE: Daily at 2:00 AM
 * 
 * Cron syntax: minute hour day month day-of-week
 * '0 2 * * *' = At 2:00 AM every day
 */
const scheduleCleanupJob = () => {
    // Run at 2:00 AM every day
    cron.schedule('0 2 * * *', async () => {
        console.log('⏰ Running scheduled draft store cleanup...');
        console.log(`📅 ${new Date().toISOString()}`);
        
        try {
            const result = await storeCleanupService.cleanupExpiredDraftStores();
            
            if (result.success) {
                console.log(`✅ Cleanup job completed: ${result.deleted} stores deleted`);
            } else {
                console.error('❌ Cleanup job failed:', result.error);
            }
        } catch (error) {
            console.error('❌ Cleanup job error:', error);
        }
    });

    console.log('🕐 Draft store cleanup job scheduled (daily at 2:00 AM)');
};

module.exports = scheduleCleanupJob;