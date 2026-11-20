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

// Serve meta-injected HTML for bots visiting storefront subdomains
router.get('/meta', async (req, res) => {
    try {
        const ua = req.headers['user-agent'] || '';
        const host = req.query.host || req.headers['x-forwarded-host'] || req.headers['host'] || '';
        const subdomain = host.split('.')[0];

        if (!isBot(ua) && req.query.preview !== '1') {
            return res.status(200).json({ bot: false });
        }

        // Get store data from DB — check subdomain first, then custom domain
        let result = await pool.query(
            `SELECT config, store_name FROM stores WHERE subdomain=$1 LIMIT 1`,
            [subdomain]
        );

        // If not found by subdomain, try custom domain match
        if (!result.rows.length) {
            result = await pool.query(
                `SELECT config, store_name FROM stores WHERE config->>'customDomain' ILIKE $1 OR config->>'customDomain' ILIKE $2 LIMIT 1`,
                [host, `www.${host}`]
            );
        }

        if (!result.rows.length) return res.status(404).send('Not found');

        const store = result.rows[0];
        const config = store.config || {};
        const profile = config.profile || {};
        const brand = config.brand || {};

        const storeName = sanitize(store.store_name || profile.storeName || subdomain);
        const seoTitle = sanitize(profile.seoTitle || `${storeName} - Shop Online`);
        const seoDescription = sanitize(profile.seoDescription || profile.aboutUs?.substring(0, 160) || `Shop at ${storeName}`);
        const seoKeywords = sanitize(profile.seoKeywords || '');
        const ogImage = brand.logoUrl || profile.logoUrl || 'https://aapnaestore.com/og-default.png';
        let url = `https://${host}`;

        // Product deep link? The Worker/nginx should pass the original path as
        // ?path=/product/paneer-puff-123 (or an x-forwarded-uri header).
        const reqPath = String(req.query.path || req.headers['x-forwarded-uri'] || '').split('?')[0];
        const productId = parseProductIdFromPath(reqPath);
        let product = null;
        if (productId) {
            for (const cat of (config.products?.categories || [])) {
                product = (cat.products || []).find(p => String(p.id) === String(productId) && !p._archived);
                if (product) break;
            }
        }

        // Read storefront index.html
        const indexPath = path.join('/home/ubuntu/apps/ApaneStore-Storefront/dist/index.html');
        let html = fs.readFileSync(indexPath, 'utf8');

        // Inject meta tags
        let pageTitle = seoTitle, pageDesc = seoDescription, pageImage = ogImage, ogType = 'website', jsonLd = '';
        if (product) {
            const firstImg = (product.images || []).map(i => typeof i === 'string' ? i : (i?.url || i?.preview)).find(Boolean);
            const prices = (product.variations || []).flatMap(v => (v.sizes || []).map(sz => parseFloat(sz.price))).filter(n => !isNaN(n));
            const low = prices.length ? Math.min(...prices) : null;
            pageTitle = sanitize(`${product.name} - ${storeName}`);
            pageDesc = sanitize(product.description || `Buy ${product.name} from ${storeName}${low !== null ? ` starting at ₹${low}` : ''}.`).substring(0, 160);
            pageImage = sanitize(firstImg || ogImage);
            ogType = 'product';
            url = `https://${host}${buildProductPath(product)}`;
            const ld = {
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: product.name,
                description: product.description || undefined,
                image: firstImg ? [firstImg] : undefined,
                offers: low !== null ? {
                    '@type': 'Offer', priceCurrency: 'INR', price: String(low), url,
                    availability: 'https://schema.org/InStock',
                } : undefined,
            };
            // '<' escaped so tenant text can't close the script tag
            jsonLd = `\n    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
        }

        const metaTags = `
    <title>${pageTitle}</title>
    <meta name="description" content="${pageDesc}">
    <meta name="keywords" content="${seoKeywords}">
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:description" content="${pageDesc}">
    <meta property="og:image" content="${pageImage}">
    <meta property="og:url" content="${url}">
    <meta property="og:type" content="${ogType}">
    <meta property="og:site_name" content="${storeName}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${pageTitle}">
    <meta name="twitter:description" content="${pageDesc}">
    <meta name="twitter:image" content="${pageImage}">
    <link rel="canonical" href="${url}">${jsonLd}`;

        html = html.replace(/<title>[^<]*<\/title>/, metaTags);

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (e) {
        console.error('SEO meta error:', e);
        res.status(500).send('Error');
    }
});

// robots.txt per store
router.get('/robots', async (req, res) => {
    try {
        const host = req.query.host || req.headers['x-forwarded-host'] || req.headers['host'] || '';
        const subdomain = host.split('.')[0];
        
        // Check if valid store
        const result = await pool.query(
            'SELECT subdomain FROM stores WHERE subdomain=$1 LIMIT 1',
            [subdomain]
        );

        if (!result.rows.length) {
            return res.status(404).send('Not found');
        }

        const robotsTxt = `User-agent: *
Allow: /

Sitemap: https://${host}/sitemap.xml`;

        res.setHeader('Content-Type', 'text/plain');
        res.send(robotsTxt);
    } catch(e) {
        res.status(500).send('Error');
    }
});

// sitemap.xml per store
router.get('/sitemap', async (req, res) => {
    try {
        const host = req.query.host || req.headers['x-forwarded-host'] || req.headers['host'] || '';
        const subdomain = host.split('.')[0];

        const result = await pool.query(
            'SELECT config, store_name FROM stores WHERE subdomain=$1 LIMIT 1',
            [subdomain]
        );

        if (!result.rows.length) return res.status(404).send('Not found');

        const config = result.rows[0].config || {};
        const categories = config?.products?.categories || [];
        const baseUrl = `https://${host}`;
        const now = new Date().toISOString().split('T')[0];

        let urls = [
            `  <url><loc>${baseUrl}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`
        ];

        // Add category and product URLs
        categories.forEach(cat => {
            (cat.products || []).forEach(prod => {
                if (!prod._archived) {
                    urls.push(`  <url><loc>${baseUrl}${buildProductPath(prod)}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
                }
            });
        });

        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

        res.setHeader('Content-Type', 'application/xml');
        res.send(sitemap);
    } catch(e) {
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
