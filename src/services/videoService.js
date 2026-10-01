const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');

const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
const MAX_DURATION = 3; // seconds
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB after compression

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration || 0);
        });
    });
}

function compressVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-crf 28',           // quality (lower = better, 28 = good compression)
                '-preset fast',      // encoding speed
                '-vf scale=720:-2',  // max 720px wide, maintain aspect ratio
                '-movflags +faststart', // web optimized
                '-t 3'               // hard cap at 3 seconds
            ])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

const VideoService = {
    async processAndSave(file, tenantId, storeId, productId) {
        ensureDir(TEMP_DIR);

        const tempInput = path.join(TEMP_DIR, `input_${uuidv4()}.mp4`);
        const tempOutput = path.join(TEMP_DIR, `output_${uuidv4()}.mp4`);

        try {
            // Write uploaded buffer to temp file
            await fs.promises.writeFile(tempInput, file.buffer);

            // Check duration before compression
            const duration = await getVideoDuration(tempInput);
            if (duration > MAX_DURATION + 0.5) {
                throw new Error(`Video too long (${duration.toFixed(1)}s). Maximum is 3 seconds.`);
            }

            // Compress
            await compressVideo(tempInput, tempOutput);

            // Check compressed size
            const stats = await fs.promises.stat(tempOutput);
            if (stats.size > MAX_SIZE_BYTES) {
                throw new Error(`Compressed video too large (${(stats.size/1024/1024).toFixed(1)}MB). Maximum is 5MB.`);
            }

            // Save to final location
            const folderPath = `tenants/${tenantId}/stores/${storeId}/products/${productId}`;
            const fullFolder = path.join(__dirname, '../../uploads', folderPath);
            ensureDir(fullFolder);

            const filename = `video_${uuidv4()}.mp4`;
            const finalPath = path.join(fullFolder, filename);
            const relativePath = path.join('uploads', folderPath, filename);

            await fs.promises.copyFile(tempOutput, finalPath);

            // Update store video usage
            await pool.query(
                'UPDATE stores SET video_used_bytes = COALESCE(video_used_bytes, 0) + $1 WHERE id = $2',
                [stats.size, storeId]
            ).catch(e => console.warn('Video storage tracking failed:', e.message));

            return {
                success: true,
                path: relativePath,
                size: stats.size,
                duration: Math.min(duration, 3)
            };
        } finally {
            // Cleanup temp files
            [tempInput, tempOutput].forEach(f => {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {}
            });
        }
    },

    async deleteVideo(relativePath, storeId, fileSize) {
        try {
            const fullPath = path.join(__dirname, '../../uploads', relativePath);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

            await pool.query(
                'UPDATE stores SET video_used_bytes = GREATEST(0, COALESCE(video_used_bytes, 0) - $1) WHERE id = $2',
                [fileSize || 0, storeId]
            ).catch(e => console.warn('Video storage deduction failed:', e.message));

            return { success: true };
        } catch (err) {
            console.error('Video delete error:', err);
            return { success: false, error: err.message };
        }
    }
};

module.exports = VideoService;
