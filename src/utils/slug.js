// Shared subdomain-slug generation. Used by StoreController.create() and
// StoreController.update() so both paths apply the same rules.

// Words that shouldn't be claimable as a tenant subdomain — either because
// they're used by our own infra (www, api, admin) or would be confusing/
// impersonation-prone as a store URL.
const RESERVED_SUBDOMAINS = new Set([
    'www', 'admin', 'api', 'app', 'mail', 'ftp', 'store-builder',
    'dashboard', 'support', 'help', 'blog', 'shop', 'static', 'cdn',
    'assets', 'aapnaestore', 'apnaestore', 'login', 'signup', 'test',
]);

function generateSlug(storeName) {
    let slug = String(storeName || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    // Store names made entirely of special characters/emoji would
    // otherwise produce an empty string, which fails the unique/format
    // constraints in an unhelpful way — fall back to a timestamped slug.
    if (!slug) {
        slug = `store-${Date.now()}`;
    }

    if (RESERVED_SUBDOMAINS.has(slug)) {
        slug = `${slug}-store`;
    }

    return slug;
}

module.exports = { generateSlug, RESERVED_SUBDOMAINS };