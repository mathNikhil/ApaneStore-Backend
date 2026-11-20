// Mirror of storefront src/utils/productSlug.js — keep the two in sync.
// URL shape: /product/<name-slug>-<id>. Lookup is by trailing ID only.
function slugify(name = '') {
    return String(name)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');
}

function buildProductPath(product) {
    if (!product || product.id === undefined || product.id === null) return '/';
    const slug = slugify(product.name);
    return slug ? `/product/${slug}-${product.id}` : `/product/${product.id}`;
}

function parseProductIdFromPath(pathname = '') {
    const m = String(pathname).match(/^\/product\/([^/?#]+)/);
    if (!m) return null;
    let seg = m[1];
    try { seg = decodeURIComponent(seg); } catch (_) {}
    const idMatch = seg.match(/(?:^|-)(\d+)$/);
    return idMatch ? idMatch[1] : seg;
}

module.exports = { slugify, buildProductPath, parseProductIdFromPath };

