const sharp = require('sharp');
const { getValidationRules } = require('../config/imageRequirements');

// Detect real MIME type using file signature (magic bytes)
async function detectRealMimeType(buffer) {
    const bytes = buffer.slice(0, 12);
    
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return 'image/png';
    }
    
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
    }
    
    // GIF: 47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif';
    }
    
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
            return 'image/webp';
        }
    }
    
    throw new Error('Unsupported or corrupted file format');
}

// Main validation function
async function validateImage(file, imageType) {
    const validationRules = getValidationRules(imageType);
    if (!validationRules) {
        throw new Error(`Unknown image type: ${imageType}`);
    }

    // 1. Check if file exists
    if (!file || !file.buffer) {
        throw new Error('No file uploaded');
    }

    // 2. MIME Type Validation (browser reported)
    if (!validationRules.allowedMimeTypes.includes(file.mimetype)) {
        throw new Error(
            `Invalid file format. Allowed formats: ${validationRules.allowedMimeTypes.join(', ')}`
        );
    }

    // 3. Real MIME Detection (using file magic bytes - security)
    let detectedMime;
    try {
        detectedMime = await detectRealMimeType(file.buffer);
    } catch (error) {
        throw new Error('Unable to detect file type. File may be corrupted.');
    }

    if (!validationRules.allowedMimeTypes.includes(detectedMime)) {
        throw new Error(
            `File appears to be ${detectedMime}, but expected ${validationRules.allowedMimeTypes.join(', ')}. Possible file rename detected.`
        );
    }

    // 4. File Size Validation
    // ✅ Only enforce a maximum — real user files are rarely pixel-perfect
    // or exactly within a narrow KB range, so the minimum-size check was
    // rejecting legitimate small files. Removed per client request.
    if (file.size > validationRules.maxSize) {
        throw new Error(
            `File size exceeds ${(validationRules.maxSize / 1024).toFixed(0)}KB limit. ` +
            `Current size: ${(file.size / 1024).toFixed(1)}KB`
        );
    }

    // 5. Dimension check using Sharp
    // ✅ DIMENSION RANGE VALIDATION REMOVED (per client request) — only the
    // format (MIME) and max file-size checks above are enforced now. We
    // still read metadata below since processAndSaveImage/StoreImage store
    // width/height, but we no longer reject uploads for not matching an
    // exact px range.
    let metadata;
    try {
        metadata = await sharp(file.buffer).metadata();
    } catch (error) {
        throw new Error('Unable to read image dimensions. File may be corrupted.');
    }

    const { width, height } = metadata;

    // ✅ ASPECT RATIO CHECK REMOVED HERE TO FIX 400 ERROR

    return {
        valid: true,
        metadata: {
            width,
            height,
            format: metadata.format,
            size: file.size,
            mimeType: detectedMime,
        }
    };
}

// Middleware for validating single image
async function validateSingleImage(req, res, next) {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        // The route middleware sets req.imageType (e.g. LOGO, HERO) based on the
        // endpoint that was hit. Fall back to body/query for callers that still
        // send it explicitly (e.g. direct API/Postman usage).
        const imageType = req.imageType || req.body.imageType || req.query.imageType;
        if (!imageType) {
            return res.status(400).json({
                success: false,
                error: 'Image type is required (LOGO, HERO, PRODUCT_MAIN, etc.)'
            });
        }

        const validation = await validateImage(req.file, imageType);
        req.imageValidation = validation;
        req.imageType = imageType;
        next();

    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
}

// Middleware for validating multiple images
async function validateMultipleImages(req, res, next) {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }

        // Same fix as validateSingleImage: prefer req.imageType set by the route.
        const imageType = req.imageType || req.body.imageType || req.query.imageType;
        if (!imageType) {
            return res.status(400).json({
                success: false,
                error: 'Image type is required (PRODUCT_GALLERY, etc.)'
            });
        }

        const validations = [];
        const errors = [];

        for (const file of req.files) {
            try {
                const validation = await validateImage(file, imageType);
                validations.push({
                    file: file,
                    validation: validation,
                    success: true
                });
            } catch (error) {
                errors.push({
                    filename: file.originalname,
                    error: error.message
                });
            }
        }

        // If all files failed
        if (errors.length === req.files.length) {
            return res.status(400).json({
                success: false,
                error: 'All files failed validation',
                errors: errors
            });
        }

        req.imageValidations = validations;
        req.imageErrors = errors;
        req.imageType = imageType;
        next();

    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    validateImage,
    validateSingleImage,
    validateMultipleImages,
    detectRealMimeType
};