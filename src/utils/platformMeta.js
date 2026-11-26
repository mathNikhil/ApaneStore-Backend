const fs = require('fs');
const pool = require('../config/database');

const BASE = 'https://aapnaestore.com';
const HOSTS = new Set(['aapnaestore.com', 'www.aapnaestore.com', 'app.aapnaestore.com', 'dev.aapnaestore.com']);
const NOINDEX_HOSTS = new Set(['app.aapnaestore.com', 'dev.aapnaestore.com']);
const INDEX_FILE = '/home/ubuntu/apps/ApaneStore-Frontend/dist/index.html';
const BOTS = ['googlebot', 'google-inspectiontool', 'bingbot', 'facebookexternalhit', 'twitterbot', 'whatsapp', 'telegrambot', 'linkedinbot', 'slackbot', 'discordbot', 'applebot', 'oai-searchbot', 'chatgpt-user', 'gptbot', 'perplexitybot', 'claudebot'];

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;').trim();
const clip = (s, n) => String(s || '').trim().substring(0, n);
const getHost = (req) => String(req.query.host || req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');

async function loadSettings() {
    try {
        const r = await pool.query("SELECT value FROM platform_settings WHERE key='seo_settings' LIMIT 1");
        return r.rows.length ? JSON.parse(r.rows[0].value) : {};
    } catch (e) { console.error('platform seo settings:', e.message); return {}; }
}

// Handles /seo/meta for the AapnaEstore platform domain only.
// For any other host (tenant stores) it calls next(), so the existing code runs untouched.
exports.meta = async (req, res, next) => {
    try {
        const host = getHost(req);
        if (!HOSTS.has(host)) return next();

        const ua = String(req.headers['user-agent'] || '').toLowerCase();
        res.setHeader('Vary', 'User-Agent');
        if (!BOTS.some(b => ua.includes(b)) && req.query.preview !== '1') return res.status(200).json({ bot: false });

        let path = String(req.query.path || req.headers['x-forwarded-uri'] || '/').split('?')[0].split('#')[0];
        if (path.length > 1) path = path.replace(/\/+$/, '');

        const s = await loadSettings();
        const page = (Array.isArray(s.pages) ? s.pages : []).find(p => p && p.path === path);
        const isHome = path === '/';
        const indexable = !NOINDEX_HOSTS.has(host) && (isHome || (page && !page.noindex));
        const src = page || {};

        const title = esc(clip(src.title || s.title || 'AapnaEstore', 70));
        const desc = esc(clip(src.description || s.description || '', 200));
        const ogDesc = esc(clip(src.description || s.ogDescription || s.description || '', 200));
        const img = /^https:\/\//i.test(s.ogImage || '') ? esc(s.ogImage) : BASE + '/og-banner.png';
        const siteName = esc(s.siteName || 'AapnaEstore');
        const canonical = BASE + (isHome ? '/' : path);
        const shareUrl = isHome && /^https:\/\//i.test(s.marketingUrl || '') ? esc(s.marketingUrl) : canonical;

        let content = '';
        if (page && page.h1) content += `<h1>${esc(clip(page.h1, 150))}</h1>`;
        if (page && page.body) content += clip(page.body, 6000).split(/\n{2,}/).map(t => `<p>${esc(t)}</p>`).join('');

        let html = fs.readFileSync(INDEX_FILE, 'utf8');
        html = html.replace(/<meta\s+(?:name|property)="(?:description|keywords|og:[^"]*|twitter:[^"]*|robots)"[^>]*>\s*/gi, '');
        html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');

        const tags = `
    <title>${title}</title>
    <meta name="description" content="${desc}">
    ${indexable ? '' : '<meta name="robots" content="noindex, follow">'}
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${ogDesc}">
    <meta property="og:image" content="${img}">
    <meta property="og:url" content="${shareUrl}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${siteName}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${ogDesc}">
    <meta name="twitter:image" content="${img}">
    ${indexable ? `<link rel="canonical" href="${canonical}">` : ''}`;

        html = html.replace(/<title>[^<]*<\/title>/, () => tags);
        if (content) html = html.replace(/<div id="root">\s*<\/div>/, () => `<div id="root"><main>${content}</main></div>`);

        res.status(200);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(html);
    } catch (e) {
        console.error('platform meta error:', e.message);
        if (!res.headersSent) next();
    }
};

// Replaces the old hard-coded platform sitemap: lists the pages saved in the admin.
exports.sitemap = async (req, res) => {
    try {
        const s = await loadSettings();
        const paths = ['/', ...(Array.isArray(s.pages) ? s.pages : [])
            .filter(p => p && p.path && p.path !== '/' && !p.noindex).map(p => p.path)];
        const urls = paths.map(p => `  <url><loc>${esc(BASE + (p === '/' ? '' : p))}</loc></url>`).join('\n');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
    } catch (e) { res.status(500).send('Error'); }
};
