const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const authenticateTenant = authenticate;
const VideoService = require('../services/videoService');
const pool = require('../config/database');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB raw upload limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'video/mp4') return cb(null, true);
        cb(new Error('Only MP4 videos are allowed'));
    }
});

// POST /api/products/:productId/video — upload product video
router.post('/:productId/video', authenticateTenant, upload.single('video'), async (req, res) => {
    try {
        const { productId } = req.params;
        const tenantId = req.tenantId;

        if (!req.file) return res.status(400).json({ success: false, error: 'No video file uploaded' });

        // Get store info and check video_enabled
        const storeResult = await pool.query(
            `SELECT s.id, s.video_enabled, s.video_used_bytes 
             FROM stores s
             JOIN products p ON p.store_id = s.id
             WHERE p.id = $1 AND s.tenant_id = $2`,
            [productId, tenantId]
        );

        if (storeResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const store = storeResult.rows[0];

        if (!store.video_enabled) {
            return res.status(403).json({ success: false, error: 'Video uploads are not enabled for this store' });
        }

        // Check if product already has a video — delete old one first
        const existing = await pool.query(
            `SELECT id, storage_path, file_size FROM store_images 
             WHERE reference_id = $1 AND mime_type = 'video/mp4'
             LIMIT 1`,
            [productId]
        );

        if (existing.rows.length > 0) {
            const old = existing.rows[0];
            await VideoService.deleteVideo(old.storage_path, store.id, old.file_size);
            await pool.query('DELETE FROM store_images WHERE id = $1', [old.id]);
        }

        // Process and save video
        const result = await VideoService.processAndSave(req.file, tenantId, store.id, productId);

        // Save to store_images table
        await pool.query(
            `INSERT INTO store_images 
             (tenant_id, store_id, image_type, reference_id, original_filename, storage_path, file_size, mime_type)
             VALUES ($1, $2, 'PRODUCT_VIDEO', $3, $4, $5, $6, 'video/mp4')`,
            [tenantId, store.id, productId, req.file.originalname, result.path, result.size]
        );

        res.json({
            success: true,
            video: {
                path: result.path,
                size: result.size,
                duration: result.duration,
                url: `/${result.path}`
            }
        });

    } catch (err) {
        console.error('Video upload error:', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

// DELETE /api/products/:productId/video — remove product video
router.delete('/:productId/video', authenticateTenant, async (req, res) => {
    try {
        const { productId } = req.params;
        const tenantId = req.tenantId;

        const storeResult = await pool.query(
            `SELECT s.id FROM stores s
             JOIN products p ON p.store_id = s.id
             WHERE p.id = $1 AND s.tenant_id = $2`,
            [productId, tenantId]
        );

        if (storeResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const storeId = storeResult.rows[0].id;

        const existing = await pool.query(
            `SELECT id, storage_path, file_size FROM store_images 
             WHERE reference_id = $1 AND mime_type = 'video/mp4' LIMIT 1`,
            [productId]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No video found for this product' });
        }

        const video = existing.rows[0];
        await VideoService.deleteVideo(video.storage_path, storeId, video.file_size);
        await pool.query('DELETE FROM store_images WHERE id = $1', [video.id]);

        res.json({ success: true, message: 'Video deleted' });

    } catch (err) {
        console.error('Video delete error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/products/:productId/video — get product video info
router.get('/:productId/video', async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(
            `SELECT storage_path, file_size, created_at FROM store_images 
             WHERE reference_id = $1 AND mime_type = 'video/mp4' LIMIT 1`,
            [productId]
        );

        if (result.rows.length === 0) {
            return res.json({ success: true, video: null });
        }

        const video = result.rows[0];
        res.json({
            success: true,
            video: { url: `/${video.storage_path}`, size: video.file_size, created_at: video.created_at }
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
