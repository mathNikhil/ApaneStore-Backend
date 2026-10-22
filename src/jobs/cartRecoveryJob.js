/**
 * Cart Recovery Batch Job
 *
 * Runs every 30 minutes to check which stores have hit their configured send_time.
 * For each eligible store:
 *   1. Find abandoned carts that satisfy: not ordered, cart_total >= min_cart_value,
 *      and enough hours have passed since updated_at (or last_reminded_at for repeat reminders)
 *   2. Respect 75/day WA cap (shared with marketing)
 *   3. Send reminders via WA personal number
 *   4. Overflow carts that can't send today → queued for tomorrow's run
 *   5. Log the batch
 */

const pool = require('../config/database');
const logger = require('../config/logger');
const { getTodayCount, incrementDailyCount, sendPersonal } = require('../services/wa.sender.service');

const DAILY_LIMIT = 75;

// ─── Template variable replacement ───────────────────────────────────────────
function buildMessage(template, cart, storeLink) {
    return template
        .replace(/{name}/gi, cart.customer_name || 'there')
        .replace(/{total}/gi, `₹${parseFloat(cart.cart_total).toFixed(0)}`)
        .replace(/{items}/gi, buildItemsSummary(cart.items))
        .replace(/{link}/gi, storeLink || '');
}

function buildItemsSummary(items) {
    if (!Array.isArray(items) || items.length === 0) return 'your items';
    const names = items.slice(0, 3).map(i => i.name || i.product_name || 'item');
    if (items.length > 3) names.push(`+${items.length - 3} more`);
    return names.join(', ');
}

// ─── Check if store's send_time has been reached today (IST) ─────────────────
function isSendTimeNow(sendTime) {
    // sendTime format: "HH:MM"
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const hh = ist.getUTCHours();
    const mm = ist.getUTCMinutes();
    const [targetHH, targetMM] = sendTime.split(':').map(Number);

    // True if we're within the same 30-min window as the target time
    const currentMinutes = hh * 60 + mm;
    const targetMinutes = targetHH * 60 + targetMM;
    return currentMinutes >= targetMinutes && currentMinutes < targetMinutes + 30;
}

// ─── Has this store already run its batch today? ──────────────────────────────
async function alreadyRanToday(storeId) {
    const { rows } = await pool.query(
        `SELECT id FROM abandoned_cart_batch_log
         WHERE store_id = $1
           AND ran_at::date = CURRENT_DATE
         LIMIT 1`,
        [storeId]
    );
    return rows.length > 0;
}

// ─── Process one store ────────────────────────────────────────────────────────
async function processStore(store) {
    const config = store.cart_recovery_config;
    if (!config?.enabled) return;
    if (!isSendTimeNow(config.send_time || '12:00')) return;
    if (await alreadyRanToday(store.id)) return;

    const reminders = config.reminders || [];
    if (reminders.length === 0) return;

    const minCartValue = parseFloat(config.min_cart_value) || 0;
    const storeLink = `https://${store.subdomain}.aapnaestore.com`;

    logger.info(`🛒 Cart recovery: processing store ${store.id} (${store.store_name})`);

    // How many WA messages already sent today by this tenant
    const alreadySent = await getTodayCount(store.tenant_id);
    const slotsAvailable = Math.max(0, DAILY_LIMIT - alreadySent);

    let cartsSent = 0;
    let cartsQueued = 0;
    let cartsSkipped = 0;
    let dailyLimitHit = false;

    // Find all eligible abandoned carts for this store
    // Eligible = not ordered, meets min cart value, has a next reminder to send
    const { rows: carts } = await pool.query(
        `SELECT * FROM customer_carts
         WHERE store_id = $1
           AND order_placed = FALSE
           AND cart_total >= $2
         ORDER BY updated_at ASC`,
        [store.id, minCartValue]
    );

    for (const cart of carts) {
        const nextReminderIndex = cart.reminder_index + 1;

        // No more reminders configured for this cart
        if (nextReminderIndex >= reminders.length) {
            cartsSkipped++;
            continue;
        }

        const nextReminder = reminders[nextReminderIndex];
        const delayHours = nextReminder.delay_hours || 24;

        // Check if enough time has passed since cart was updated (or last reminded)
        const referenceTime = cart.last_reminded_at || cart.updated_at;
        const hoursSinceReference = (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60);

        if (hoursSinceReference < delayHours) {
            // Not ready yet — will be eligible in a future run
            continue;
        }

        // Cart is eligible — check if we have daily slots
        if (cartsSent >= slotsAvailable) {
            dailyLimitHit = true;
            cartsQueued++;
            // Insert into queue for tomorrow's run (will be picked up at next batch)
            await pool.query(
                `INSERT INTO wa_send_queue
                    (store_id, tenant_id, type, customer_phone, customer_name, message,
                     priority, scheduled_for, status, cart_id, reminder_index)
                 VALUES ($1, $2, 'cart_recovery', $3, $4, $5, 1, NOW() + INTERVAL '1 day', 'pending', $6, $7)
                 ON CONFLICT DO NOTHING`,
                [
                    store.id, store.tenant_id, cart.customer_phone, cart.customer_name,
                    buildMessage(nextReminder.message, cart, storeLink),
                    cart.id, nextReminderIndex
                ]
            );
            continue;
        }

        // Send the message
        try {
            const message = buildMessage(nextReminder.message, cart, storeLink);
            await sendPersonal({ tenantId: store.tenant_id, phone: cart.customer_phone, caption: message });
            await incrementDailyCount(store.tenant_id, 1);

            // Update cart: advance reminder index
            await pool.query(
                `UPDATE customer_carts
                 SET reminder_index = $1, last_reminded_at = NOW(), updated_at = NOW()
                 WHERE id = $2`,
                [nextReminderIndex, cart.id]
            );

            // Log in queue as sent
            await pool.query(
                `INSERT INTO wa_send_queue
                    (store_id, tenant_id, type, customer_phone, customer_name, message,
                     priority, scheduled_for, sent_at, status, cart_id, reminder_index)
                 VALUES ($1, $2, 'cart_recovery', $3, $4, $5, 1, NOW(), NOW(), 'sent', $6, $7)`,
                [
                    store.id, store.tenant_id, cart.customer_phone, cart.customer_name,
                    message, cart.id, nextReminderIndex
                ]
            );

            cartsSent++;
            logger.info(`  ✅ Sent reminder #${nextReminderIndex + 1} to ${cart.customer_phone}`);
        } catch (err) {
            logger.error(`  ❌ Failed to send to ${cart.customer_phone}:`, err.message);
            await pool.query(
                `INSERT INTO wa_send_queue
                    (store_id, tenant_id, type, customer_phone, customer_name, message,
                     priority, scheduled_for, status, error_msg, cart_id, reminder_index)
                 VALUES ($1, $2, 'cart_recovery', $3, $4, $5, 1, NOW(), 'failed', $6, $7, $8)`,
                [
                    store.id, store.tenant_id, cart.customer_phone, cart.customer_name,
                    buildMessage(nextReminder.message, cart, storeLink),
                    err.message, cart.id, nextReminderIndex
                ]
            );
        }
    }

    // Log this batch run
    await pool.query(
        `INSERT INTO abandoned_cart_batch_log
            (store_id, ran_at, carts_eligible, carts_sent, carts_queued, carts_skipped, daily_limit_hit)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6)`,
        [store.id, carts.length, cartsSent, cartsQueued, cartsSkipped, dailyLimitHit]
    );

    logger.info(`🛒 Store ${store.id}: sent=${cartsSent} queued=${cartsQueued} skipped=${cartsSkipped} limitHit=${dailyLimitHit}`);
}

// ─── Main job entry point ─────────────────────────────────────────────────────
async function runCartRecoveryJob() {
    logger.info('🛒 Cart recovery job started');

    try {
        // Get all stores with cart recovery enabled
        const { rows: stores } = await pool.query(
            `SELECT s.id, s.store_name, s.subdomain, s.tenant_id, s.cart_recovery_config,
                    wp.daily_limit
             FROM stores s
             LEFT JOIN wa_plan_subscriptions wp ON wp.store_id = s.id AND wp.status = 'active'
             WHERE (s.cart_recovery_config->>'enabled')::boolean = TRUE
               AND s.status = 'published'`
        );

        logger.info(`🛒 Found ${stores.length} stores with cart recovery enabled`);

        for (const store of stores) {
            try {
                await processStore(store);
            } catch (err) {
                logger.error(`❌ Cart recovery failed for store ${store.id}:`, err.message);
            }
        }
    } catch (err) {
        logger.error('❌ Cart recovery job error:', err);
    }

    logger.info('🛒 Cart recovery job complete');
}

module.exports = { runCartRecoveryJob };
