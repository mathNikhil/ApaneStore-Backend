const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

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
        const url = `https://${host}`;

        // Read storefront index.html
        const indexPath = path.join('/home/ubuntu/apps/ApaneStore-Storefront/dist/index.html');
        let html = fs.readFileSync(indexPath, 'utf8');

        // Inject meta tags
        const metaTags = `
    <title>${seoTitle}</title>
    <meta name="description" content="${seoDescription}">
    <meta name="keywords" content="${seoKeywords}">
    <meta property="og:title" content="${seoTitle}">
    <meta property="og:description" content="${seoDescription}">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:url" content="${url}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${storeName}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${seoTitle}">
    <meta name="twitter:description" content="${seoDescription}">
    <meta name="twitter:image" content="${ogImage}">
    <link rel="canonical" href="${url}">`;

        html = html.replace('<title>Storefront - Apna eStore</title>', metaTags);

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
                    urls.push(`  <url><loc>${baseUrl}?product=${prod.id}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
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

module.exports = router;
