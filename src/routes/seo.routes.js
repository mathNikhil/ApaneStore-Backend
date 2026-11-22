const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const { buildProductPath, parseProductIdFromPath } = require('../utils/productSlug');

const BOT_AGENTS = ['googlebot', 'bingbot', 'facebookexternalhit', 'twitterbot', 'whatsapp', 'telegrambot', 'linkedinbot', 'slackbot', 'discordbot', 'applebot'];

const isBot = (ua = '') => BOT_AGENTS.some(bot => ua.toLowerCase().includes(bot));

// Sanitize tenant input — prevent HTML injection
const sanitize = (str = '') => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .substring(0, 500);

// ─── Structured data (JSON-LD) builders ─────────────────────────────────────
// Only claims what is actually on the page. No ratings/reviews (none exist),
// no availability (live stock is not available here — a hard-coded "InStock"
// on a sold-out product is a mismatch Google can penalise), no brand (the
// store name is not necessarily the product's brand).
const CURRENCY = 'INR';
const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : null);
const clean = (obj) => JSON.parse(JSON.stringify(obj)); // drops undefined
const ldScript = (obj) =>
    `\n    <script type="application/ld+json">${JSON.stringify(clean(obj)).replace(/</g, '\\u003c')}</script>`;

function buildStoreJsonLd({ storeName, baseUrl, logo, description, profile }) {
    const social = profile.socialLinks || {};
    const sameAs = ['facebook', 'instagram', 'twitter', 'youtube']
        .map(k => httpsUrl(social[k])).filter(Boolean);
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Organization', '@id': `${baseUrl}/#organization`,
                name: storeName, url: `${baseUrl}/`,
                logo: httpsUrl(logo) || undefined,
                description: description || undefined,
                sameAs: sameAs.length ? sameAs : undefined,
            },
            {
                '@type': 'WebSite', '@id': `${baseUrl}/#website`,
                name: storeName, url: `${baseUrl}/`,
                publisher: { '@id': `${baseUrl}/#organization` },
            },
        ],
    };
}

function buildProductJsonLd({ product, storeName, baseUrl, pageUrl }) {
    const prices = (product.variations || [])
        .flatMap(v => (v.sizes || []).map(sz => parseFloat(sz.price)))
        .filter(n => Number.isFinite(n) && n >= 0);
    const low = prices.length ? Math.min(...prices) : null;
    const high = prices.length ? Math.max(...prices) : null;
    const fmt = (n) => String(Math.round(n * 100) / 100);
    const seller = { '@type': 'Organization', name: storeName, url: `${baseUrl}/` };

    let offers;
    if (low !== null && low === high) {
        offers = { '@type': 'Offer', url: pageUrl, priceCurrency: CURRENCY, price: fmt(low), seller };
    } else if (low !== null) {
        offers = { '@type': 'AggregateOffer', url: pageUrl, priceCurrency: CURRENCY,
                   lowPrice: fmt(low), highPrice: fmt(high), offerCount: prices.length, seller };
    }
    const images = productImageUrls(product, 5);
    return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': `${pageUrl}#product`,
        name: product.name,
        description: product.description ? String(product.description).substring(0, 1000) : undefined,
        image: images.length ? images : undefined,
        sku: String(product.id),
        url: pageUrl,
        offers,
    };
}

// Serve meta-injected HTML for bots visiting storefront subdomains / custom domains
router.get('/meta', async (req, res) => {
    try {
        const ua = req.headers['user-agent'] || '';
        res.setHeader('Vary', 'User-Agent');
        if (!isBot(ua) && req.query.preview !== '1') {
            return res.status(200).json({ bot: false });
        }

        // Same rule as sitemap/robots: validated host, published + not deleted only.
        const host = cleanHost(req);
        const store = host ? await findPublishedStore(host) : null;
        if (!store) return res.status(404).send('Not found');

        const config = store.config || {};
        const profile = config.profile || {};
        const brand = config.brand || {};

        const storeNameRaw = store.store_name || profile.storeName || store.subdomain || host;
        const storeName = sanitize(storeNameRaw);
        const seoTitle = sanitize(profile.seoTitle || `${storeNameRaw} - Shop Online`);
        const aboutShort = (profile.aboutUs || '').substring(0, 160);
        const seoDescription = sanitize(profile.seoDescription || aboutShort || `Shop at ${storeNameRaw}`);
        const seoKeywords = sanitize(profile.seoKeywords || '');
        const logoUrl = httpsUrl(brand.logoUrl) || httpsUrl(profile.logoUrl);
        const ogImage = logoUrl || 'https://aapnaestore.com/og-default.png';
        const baseUrl = `https://${host}`;

        // Which page is this? The Worker/nginx must pass the original path as
        // ?path=/product/<slug>-<id> (or an x-forwarded-uri header). If it is
        // missing we do NOT guess: a wrong canonical (e.g. every page -> home)
        // is worse than none.
        const reqPath = String(req.query.path || req.headers['x-forwarded-uri'] || '')
            .split('?')[0].split('#')[0];
        const pathKnown = reqPath !== '';
        const isHome = reqPath === '/';
        const isProductPath = reqPath.startsWith('/product/');

        let product = null;
        if (isProductPath) {
            const productId = parseProductIdFromPath(reqPath);
            for (const cat of (config.products?.categories || [])) {
                product = (cat.products || []).find(p => String(p.id) === String(productId) && !p._archived && p.name);
                if (product) break;
            }
        }

        let pageTitle = seoTitle, pageDesc = seoDescription, pageImage = ogImage, ogType = 'website';
        let canonical = '', robotsMeta = '', jsonLd = '', status = 200;

        if (product) {
            const pageUrl = `${baseUrl}${buildProductPath(product)}`;
            const firstImg = productImageUrls(product, 1)[0];
            const prices = (product.variations || []).flatMap(v => (v.sizes || []).map(sz => parseFloat(sz.price))).filter(Number.isFinite);
            const low = prices.length ? Math.min(...prices) : null;
            pageTitle = sanitize(`${product.name} - ${storeNameRaw}`);
            pageDesc = sanitize(product.description || `Buy ${product.name} from ${storeNameRaw}${low !== null ? ` starting at ₹${low}` : ''}.`).substring(0, 160);
            pageImage = sanitize(firstImg || ogImage);
            ogType = 'product';
            canonical = pageUrl; // current slug: old names, bare-ID links and ?utm= variants all consolidate here
            jsonLd = ldScript(buildProductJsonLd({ product, storeName: storeNameRaw, baseUrl, pageUrl }));
        } else if (isProductPath) {
            // /product/<unknown or deleted id>: tell crawlers it is gone instead of
            // serving it as a 200 copy of the homepage (soft-404).
            status = 404;
            robotsMeta = '<meta name="robots" content="noindex, nofollow">';
        } else if (isHome) {
            canonical = `${baseUrl}/`;
            jsonLd = ldScript(buildStoreJsonLd({
                storeName: storeNameRaw, baseUrl, logo: logoUrl,
                description: (profile.seoDescription || profile.aboutUs || '').substring(0, 300) || undefined, profile,
            }));
        } else if (pathKnown) {
            // Any other path (/cart, /orders, /profile, ...) is an app screen, not content.
            robotsMeta = '<meta name="robots" content="noindex, follow">';
        }
        const pageOgUrl = canonical || `${baseUrl}/`;

        // Read storefront index.html and swap its static head tags for the real ones.
        // index.html ships hard-coded description/og/twitter tags; leaving them in
        // would put duplicates next to ours (crawlers pick the first one).
        const indexPath = path.join('/home/ubuntu/apps/ApaneStore-Storefront/dist/index.html');
        let html = fs.readFileSync(indexPath, 'utf8');
        html = html.replace(/<meta\s+(?:name|property)="(?:description|keywords|og:[^"]*|twitter:[^"]*|robots)"[^>]*>\s*/gi, '');
        html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');

        const metaTags = `
    <title>${pageTitle}</title>
    <meta name="description" content="${pageDesc}">
    ${seoKeywords ? `<meta name="keywords" content="${seoKeywords}">` : ''}
    ${robotsMeta}
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:description" content="${pageDesc}">
    <meta property="og:image" content="${pageImage}">
    <meta property="og:url" content="${pageOgUrl}">
    <meta property="og:type" content="${ogType}">
    <meta property="og:site_name" content="${storeName}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${pageTitle}">
    <meta name="twitter:description" content="${pageDesc}">
    <meta name="twitter:image" content="${pageImage}">
    ${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${jsonLd}`;

        html = html.replace(/<title>[^<]*<\/title>/, () => metaTags);

        res.status(status);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Output depends on who asks (bot vs human): tell caches, and don't let them keep it.
        res.setHeader('Vary', 'User-Agent');
        res.setHeader('Cache-Control', 'no-store');
        res.send(html);
    } catch (e) {
        console.error('SEO meta error:', e);
        res.status(500).send('Error');
    }
});

// ─── Shared helpers for robots.txt / sitemap.xml ────────────────────────────
const PLATFORM_DOMAIN = 'aapnaestore.com';
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const MAX_SITEMAP_URLS = 50000; // sitemap protocol limit per file

const xmlEsc = (v) => String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Validated host from ?host= (Worker) or forwarded/host headers. null if junk.
function cleanHost(req) {
    const raw = String(req.query.host || req.headers['x-forwarded-host'] || req.headers['host'] || '')
        .split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
    return HOST_RE.test(raw) ? raw : null;
}

// Published, non-deleted stores only — same rule the storefront itself uses.
// Subdomain match is only allowed on our own domain, so bakewala.evil.com
// can't pull bakewala's sitemap.
async function findPublishedStore(host) {
    if (host.endsWith('.' + PLATFORM_DOMAIN)) {
        const sub = host.slice(0, -(PLATFORM_DOMAIN.length + 1));
        if (!sub || sub.includes('.')) return null;
        const r = await pool.query(
            `SELECT config, store_name, subdomain, updated_at FROM stores
             WHERE subdomain = $1 AND status = 'published' AND deleted_at IS NULL LIMIT 1`, [sub]);
        return r.rows[0] || null;
    }
    const clean = host.replace(/^www\./, '');
    const r = await pool.query(
        `SELECT s.config, s.store_name, s.subdomain, s.updated_at
         FROM stores s JOIN store_domain_config sdc ON sdc.store_id = s.id
         WHERE sdc.custom_domain IN ($1, $2) AND sdc.dns_status = 'verified'
           AND s.status = 'published' AND s.deleted_at IS NULL LIMIT 1`,
        [clean, `www.${clean}`]);
    return r.rows[0] || null;
}

const isoDay = (d) => (d ? new Date(d) : new Date()).toISOString().split('T')[0];

// Absolute https image URLs only (data: / blob: / relative URLs are useless to Google)
function productImageUrls(prod, max = 3) {
    return (prod.images || [])
        .map(i => (typeof i === 'string' ? i : (i && (i.url || i.preview))))
        .filter(u => typeof u === 'string' && /^https:\/\//i.test(u))
        .slice(0, max);
}

// robots.txt per store
router.get('/robots', async (req, res) => {
    try {
        const host = cleanHost(req);
        if (!host || !(await findPublishedStore(host))) return res.status(404).send('Not found');

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(`User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`);
    } catch (e) {
        console.error('robots error:', e.message);
        res.status(500).send('Error');
    }
});

// sitemap.xml per store
router.get('/sitemap', async (req, res) => {
    try {
        const host = cleanHost(req);
        const store = host ? await findPublishedStore(host) : null;
        if (!store) return res.status(404).send('Not found');

        const baseUrl = `https://${host}`;
        // Real change date from the store record, not "today" on every request.
        // Google stops trusting lastmod once it sees it lie, so don't fake it.
        const storeLastmod = isoDay(store.updated_at);

        const entries = [`  <url>\n    <loc>${xmlEsc(baseUrl + '/')}</loc>\n    <lastmod>${storeLastmod}</lastmod>\n  </url>`];
        const seen = new Set();

        for (const cat of (store.config?.products?.categories || [])) {
            for (const prod of (cat.products || [])) {
                if (prod._archived || prod.id === undefined || prod.id === null || !prod.name) continue;
                if (seen.has(String(prod.id))) continue;          // same product in 2 categories
                seen.add(String(prod.id));
                if (entries.length >= MAX_SITEMAP_URLS) break;

                const lastmod = isoDay(prod.updatedAt || prod.updated_at || store.updated_at);
                const images = productImageUrls(prod)
                    .map(u => `    <image:image><image:loc>${xmlEsc(u)}</image:loc></image:image>`).join('\n');
                entries.push(
                    `  <url>\n    <loc>${xmlEsc(baseUrl + buildProductPath(prod))}</loc>\n    <lastmod>${lastmod}</lastmod>` +
                    (images ? `\n${images}` : '') + `\n  </url>`
                );
            }
        }

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join('\n')}\n</urlset>`);
    } catch (e) {
        console.error('sitemap error:', e.message);
        res.status(500).send('Error');
    }
});

// Main platform sitemap for aapnaestore.com
router.get('/platform-sitemap', async (req, res) => {
    try {
        const now = new Date().toISOString().split('T')[0];
        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://aapnaestore.com</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://aapnaestore.com/profile/about</loc><lastmod>${now}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://aapnaestore.com/profile/pricing</loc><lastmod>${now}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://aapnaestore.com/profile/privacy</loc><lastmod>${now}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>https://aapnaestore.com/profile/terms</loc><lastmod>${now}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>
</urlset>`;
        res.setHeader('Content-Type', 'application/xml');
        res.send(sitemap);
    } catch(e) {
        res.status(500).send('Error');
    }
});

module.exports = router;

// Public platform SEO settings endpoint (used by Cloudflare Worker)
router.get('/platform-settings', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT value FROM platform_settings WHERE key='seo_settings' LIMIT 1"
        );
        if (result.rows.length) {
            res.json({ success: true, data: JSON.parse(result.rows[0].value) });
        } else {
            res.json({ success: true, data: {
                title: 'AapnaEstore - Create Your Online Store in Minutes',
                description: 'AapnaEstore helps Indian businesses launch their own online store.',
                ogDescription: 'Launch your own branded online store with WhatsApp ordering.',
                keywords: 'online store builder india, create estore',
                ogImage: 'https://aapnaestore.com/og-banner.png',
                siteName: 'AapnaEstore'
            }});
        }
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});
module.exports = router;
