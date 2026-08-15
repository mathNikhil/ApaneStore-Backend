const cron = require('node-cron');
const subscriptionExpiryService = require('../services/subscriptionExpiryService');

// ✅ Runs hourly — checks for any published store whose paid subscription
// period has ended, and reverts it to draft. Hourly (not daily, like the
// draft-cleanup job) since billing cycles can be as short as monthly, and
// a store staying live well past what was actually paid for is a real
// revenue-integrity issue, not just cosmetic.
cron.schedule('0 * * * *', async () => {
    console.log('🔄 Checking for expired store subscriptions...');
    const result = await subscriptionExpiryService.processExpiredSubscriptions();
    if (result && result.success && result.processed > 0) {
        console.log(`⏳ Subscription expiry check complete: ${result.processed} store(s) reverted to draft`);
    }
});

console.log('🕐 Subscription expiry job scheduled (hourly)');

module.exports = cron;
