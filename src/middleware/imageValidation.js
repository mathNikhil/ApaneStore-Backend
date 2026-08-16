const sharp = require('sharp');
const { getValidationRules, getProcessingRules } = require('../config/imageRequirements');

async function detectRealMimeType(buffer) {
    const bytes = buffer.slice(0, 12);
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    throw new Error('Unsupported or corrupted file format');
}

async function processImage(buffer, imageType) {
    const processing = getProcessingRules(imageType);
    if (!processing) return buffer;
    try {
        return await sharp(buffer)
            .rotate()
            .resize(processing.width, processing.height, { fit: processing.fit || 'cover', position: 'center' })
            .webp({ quality: 82, effort: 4 })
            .withMetadata(false)
            .toBuffer();
    } catch (error) {
        console.error('Sharp processing error:', error);
        throw new Error('Failed to process image. Please try a different file.');
    }
}

async function validateImage(file, imageType) {
    const validationRules = getValidationRules(imageType);
    if (!validationRules) throw new Error("Unknown image type: " + imageType);
    if (!file || !file.buffer) throw new Error('No file uploaded');

    if (!validationRules.allowedMimeTypes.includes(file.mimetype)) {
        throw new Error('Invalid format. Accepted: JPG, PNG, WebP');
    }

    let detectedMime;
    try { detectedMime = await detectRealMimeType(file.buffer); }
    catch (e) { throw new Error('Unable to detect file type. File may be corrupted.'); }

    if (!validationRules.allowedMimeTypes.includes(detectedMime)) {
        throw new Error('File type mismatch. Please upload a genuine JPG or PNG.');
    }

    if (file.size > validationRules.maxSize) {
        const limitMB = (validationRules.maxSize / 1024 / 1024).toFixed(0);
        const fileMB = (file.size / 1024 / 1024).toFixed(1);
        throw new Error("File too large (" + fileMB + "MB). Maximum: " + limitMB + "MB");
    }

    let metadata;
    try { metadata = await sharp(file.buffer).metadata(); }
    catch (e) { throw new Error('Unable to read image. File may be corrupted.'); }

    return { valid: true, metadata: { width: metadata.width, height: metadata.height, format: metadata.format, size: file.size, mimeType: detectedMime } };
}

async function validateSingleImage(req, res, next) {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
        const imageType = req.imageType || req.body.imageType || req.query.imageType;
        if (!imageType) return res.status(400).json({ success: false, error: 'Image type is required' });

        const validation = await validateImage(req.file, imageType);
        const processedBuffer = await processImage(req.file.buffer, imageType);
        req.file.buffer = processedBuffer;
        req.file.mimetype = 'image/webp';
        req.file.size = processedBuffer.length;
        req.file.originalname = req.file.originalname.replace(/\.[^/.]+$/, '.webp');
        req.imageValidation = validation;
        req.imageType = imageType;
        next();
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
}

async function validateMultipleImages(req, res, next) {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No files uploaded' });
        const imageType = req.imageType || req.body.imageType || req.query.imageType;
        if (!imageType) return res.status(400).json({ success: false, error: 'Image type is required' });

        const validations = [];
        const errors = [];
        for (const file of req.files) {
            try {
                const validation = await validateImage(file, imageType);
                const processedBuffer = await processImage(file.buffer, imageType);
                file.buffer = processedBuffer;
                file.mimetype = 'image/webp';
                file.size = processedBuffer.length;
                file.originalname = file.originalname.replace(/\.[^/.]+$/, '.webp');
                validations.push({ file, validation, success: true });
            } catch (error) {
                errors.push({ filename: file.originalname, error: error.message });
            }
        }

        if (errors.length === req.files.length) return res.status(400).json({ success: false, error: 'All files failed validation', errors });
        req.imageValidations = validations;
        req.imageErrors = errors;
        req.imageType = imageType;
        next();
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
}

module.exports = { validateImage, validateSingleImage, validateMultipleImages, detectRealMimeType, processImage };
