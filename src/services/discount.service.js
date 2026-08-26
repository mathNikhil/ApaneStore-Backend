const pool = require('../config/database');

const TEST_TENANT_PHONES = ['5555555555', '6666666666', '7777777777'];

// Get all discount settings from DB
const getDiscountSettings = async () => {
    const result = await pool.query(
        `SELECT key, value FROM platform_settings 
         WHERE key LIKE '%publish%' OR key IN ('referral_bonus_percent', 'max_referral_count')`
    );
    const s = {};
    result.rows.forEach(r => { s[r.key] = parseFloat(r.value); });
    return {
        first_publish_30days:   s.first_publish_30days   || 10,
        first_publish_90days:   s.first_publish_90days   || 20,
        first_publish_365days:  s.first_publish_365days  || 50,
        repeat_publish_30days:  s.repeat_publish_30days  || 5,
        repeat_publish_90days:  s.repeat_publish_90days  || 10,
        repeat_publish_365days: s.repeat_publish_365days || 25,
        third_publish_30days:   s.third_publish_30days   || 0,
        third_publish_90days:   s.third_publish_90days   || 0,
        third_publish_365days:  s.third_publish_365days  || 0,
        referralBonusPercent:   s.referral_bonus_percent || 10,
        maxReferralCount:       s.max_referral_count     || 5,
    };
};

// Get discount percent based on publish count and billing cycle
const getBaseDiscountPercent = (settings, publishCount, billingCycle) => {
    const cycle = billingCycle?.includes('30') ? '30days'
                : billingCycle?.includes('90') ? '90days'
                : '365days';

    if (publishCount === 0) {
        return settings[`first_publish_${cycle}`] || 0;
    } else if (publishCount === 1) {
        return settings[`repeat_publish_${cycle}`] || 0;
    } else {
        return settings[`third_publish_${cycle}`] || 0;
    }
};

// Get credited referral count
const getCreditedReferralCount = async (tenantId) => {
    const result = await pool.query(
        `SELECT COUNT(*) as count FROM tenant_referrals
         WHERE referrer_tenant_id = $1 AND status = 'credited'`,
        [tenantId]
    );
    return parseInt(result.rows[0].count || 0);
};

// Get pending referrals where referred tenant has published
const getPendingCreditableReferrals = async (tenantId) => {
    const result = await pool.query(
        `SELECT COUNT(*) as count FROM tenant_referrals tr
         JOIN tenants t ON t.id = tr.referred_tenant_id
         WHERE tr.referrer_tenant_id = $1 
         AND tr.status = 'pending'
         AND t.publish_count > 0`,
        [tenantId]
    );
    return parseInt(result.rows[0].count || 0);
};

// Calculate discount for a tenant's next publish
const calculateDiscount = async (tenantId, baseAmount, billingCycle = '365days', taxPercent = 18) => {
    // Check if test tenant
    const tenantResult = await pool.query(
        'SELECT phone, publish_count, referral_points_used FROM tenants WHERE id = $1',
        [tenantId]
    );
    if (!tenantResult.rows.length) throw new Error('Tenant not found');

    const tenant = tenantResult.rows[0];
    const baseExclGST = baseAmount / (1 + taxPercent / 100);

    // No discount for test tenants
    if (TEST_TENANT_PHONES.includes(tenant.phone)) {
        return {
            baseAmount, baseExclGST: Math.round(baseExclGST * 100) / 100,
            discountedBase: Math.round(baseExclGST * 100) / 100,
            gstAmount: Math.round((baseAmount - baseExclGST) * 100) / 100,
            baseDiscountPercent: 0, referralBonusPercent: 0,
            referralDiscountDisplay: 0, totalDiscountPercent: 0,
            discountAmount: 0, finalAmount: Math.round(baseAmount * 100) / 100,
            publishCount: tenant.publish_count, usableReferrals: 0,
            billingCycle,
        };
    }

    const settings = await getDiscountSettings();
    const publishCount = parseInt(tenant.publish_count || 0);
    const baseDiscountPercent = getBaseDiscountPercent(settings, publishCount, billingCycle);

    // Referral bonus — applies on ANY publish as long as points available
    // Max 5 points total (configurable). All available points auto-applied.
    let referralBonusPercent = 0;
    let usableReferrals = 0;
    let referralDiscountDisplay = 0;

    const pointsUsed = parseInt(tenant.referral_points_used || 0);
    const remainingSlots = Math.max(0, settings.maxReferralCount - pointsUsed);

    if (remainingSlots > 0) {
        const pendingCreditable = await getPendingCreditableReferrals(tenantId);
        const credited = await getCreditedReferralCount(tenantId);
        // Available = earned but not yet used, capped by remaining slots
        const earnedNotUsed = (pendingCreditable + credited) - pointsUsed;
        usableReferrals = Math.min(Math.max(0, earnedNotUsed), remainingSlots);

        if (usableReferrals > 0 && baseDiscountPercent > 0) {
            // Each referral = referralBonusPercent% of base discount
            referralBonusPercent = usableReferrals * (settings.referralBonusPercent / 100 * baseDiscountPercent);
            referralDiscountDisplay = usableReferrals * settings.referralBonusPercent;
        }
    }

    const totalDiscountPercent = baseDiscountPercent + referralBonusPercent;
    const discountAmount = (baseExclGST * totalDiscountPercent) / 100;
    const discountedBase = baseExclGST - discountAmount;
    const gstAmount = discountedBase * (taxPercent / 100);
    const finalAmount = discountedBase + gstAmount;

    return {
        baseAmount,
        baseExclGST: Math.round(baseExclGST * 100) / 100,
        discountedBase: Math.round(discountedBase * 100) / 100,
        gstAmount: Math.round(gstAmount * 100) / 100,
        baseDiscountPercent,
        referralBonusPercent: Math.round(referralBonusPercent * 100) / 100,
        referralDiscountDisplay,
        totalDiscountPercent: Math.round(totalDiscountPercent * 100) / 100,
        discountAmount: Math.round(discountAmount * 100) / 100,
        finalAmount: Math.round(finalAmount * 100) / 100,
        publishCount,
        usableReferrals,
        billingCycle,
    };
};

// Credit referrals after successful payment (one time use)
const creditReferrals = async (tenantId, usableReferrals) => {
    if (usableReferrals <= 0) return;
    await pool.query(
        `UPDATE tenant_referrals 
         SET status = 'credited', credited_at = NOW()
         WHERE referrer_tenant_id = $1 
         AND status = 'pending'
         AND referred_tenant_id IN (SELECT id FROM tenants WHERE publish_count > 0)
         AND id IN (
             SELECT id FROM tenant_referrals 
             WHERE referrer_tenant_id = $1 AND status = 'pending'
             ORDER BY created_at ASC LIMIT $2
         )`,
        [tenantId, usableReferrals]
    );
    await pool.query(
        'UPDATE tenants SET referral_points_used = referral_points_used + $1 WHERE id = $2',
        [usableReferrals, tenantId]
    );
};

// Increment publish count after successful payment
const incrementPublishCount = async (tenantId) => {
    await pool.query('UPDATE tenants SET publish_count = publish_count + 1 WHERE id = $1', [tenantId]);
};

// Generate unique referral code
const generateReferralCode = async (tenantId, companyName) => {
    const base = (companyName || 'USER').replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `${base}-${suffix}`;
    await pool.query(
        'UPDATE tenants SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL',
        [code, tenantId]
    );
    return code;
};

// Save referral when new tenant signs up via ref link
const saveReferral = async (newTenantId, referralCode) => {
    try {
        const referrerResult = await pool.query(
            'SELECT id FROM tenants WHERE referral_code = $1', [referralCode]
        );
        if (!referrerResult.rows.length) return;
        const referrerTenantId = referrerResult.rows[0].id;
        if (referrerTenantId === newTenantId) return;
        await pool.query('UPDATE tenants SET referred_by = $1 WHERE id = $2', [referrerTenantId, newTenantId]);
        await pool.query(
            `INSERT INTO tenant_referrals (referrer_tenant_id, referred_tenant_id, status)
             VALUES ($1, $2, 'pending') ON CONFLICT (referred_tenant_id) DO NOTHING`,
            [referrerTenantId, newTenantId]
        );
    } catch (e) { console.error('Save referral error:', e.message); }
};

// Get referral summary for profile page
const getReferralSummary = async (tenantId) => {
    const settings = await getDiscountSettings();
    const [tenant, referrals] = await Promise.all([
        pool.query('SELECT referral_code, publish_count, referral_points_used FROM tenants WHERE id = $1', [tenantId]),
        pool.query(
            `SELECT tr.status, tr.credited_at, t.company_name, t.publish_count as referred_publish_count
             FROM tenant_referrals tr
             JOIN tenants t ON t.id = tr.referred_tenant_id
             WHERE tr.referrer_tenant_id = $1 ORDER BY tr.created_at DESC`,
            [tenantId]
        )
    ]);
    const t = tenant.rows[0];
    const creditedCount = referrals.rows.filter(r => r.status === 'credited').length;
    const pendingPublished = referrals.rows.filter(r => r.status === 'pending' && r.referred_publish_count > 0).length;
    const pointsUsed = parseInt(t.referral_points_used || 0);
    const availableBonus = Math.min(pendingPublished, settings.maxReferralCount - pointsUsed);
    return {
        referralCode: t.referral_code,
        referralLink: `https://aapnaestore.com?ref=${t.referral_code}`,
        publishCount: t.publish_count,
        referralPointsUsed: pointsUsed,
        maxReferrals: settings.maxReferralCount,
        creditedCount,
        availableBonus,
        availableBonusDisplay: availableBonus * settings.referralBonusPercent,
        referrals: referrals.rows,
        settings,
    };
};

module.exports = {
    getDiscountSettings,
    calculateDiscount,
    creditReferrals,
    incrementPublishCount,
    generateReferralCode,
    saveReferral,
    getReferralSummary,
};
