const IMAGE_REQUIREMENTS = {
    LOGO: {
        display: { hint: 'Recommended: 200×200px • Max 2MB • PNG/JPG' },
        validation: {
            maxSize: 2 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        processing: { width: 200, height: 200, fit: 'cover' }
    },
    HERO: {
        display: { hint: 'Any ratio • Max 3MB • JPG/PNG' },
        validation: {
            maxSize: 3 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        // fit:'inside' preserves full image — no cropping ever.
        // Banner adjuster handles all visual framing (focalX/Y, zoom, pan).
        processing: { width: 2400, height: 2400, fit: 'inside' }
    },
    PRODUCT_MAIN: {
        display: { hint: 'Recommended: 800×800px • Max 2MB • JPG/PNG' },
        validation: {
            maxSize: 2 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        processing: { width: 800, height: 800, fit: 'cover' }
    },
    PRODUCT_GALLERY: {
        display: { hint: 'Recommended: 800×800px • Max 2MB • JPG/PNG' },
        validation: {
            maxSize: 2 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        processing: { width: 800, height: 800, fit: 'cover' }
    },
    VARIANT: {
        display: { hint: 'Recommended: 400×400px • Max 1MB • JPG/PNG' },
        validation: {
            maxSize: 1 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        processing: { width: 400, height: 400, fit: 'cover' }
    },
    CATEGORY: {
        display: { hint: 'Recommended: 400×400px • Max 1MB • JPG/PNG' },
        validation: {
            maxSize: 1 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        processing: { width: 400, height: 400, fit: 'cover' }
    },
    RETURN: {
        display: { hint: 'Max 5MB • JPG/PNG/WebP' },
        validation: {
            maxSize: 5 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
        },
        processing: { width: 1200, height: 1200, fit: 'inside' }
    },
    STAFF_PHOTO: {
        // Output target: ~5KB — 120×120 WebP at quality 55 ≈ 3–8KB for a face photo.
        // Accept up to 2MB input; sharp handles the compression pipeline.
        display: { hint: 'Square face photo • Saved as 120×120 WebP (~5KB) • Max upload 2MB' },
        validation: {
            maxSize: 2 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
        },
        processing: { width: 120, height: 120, fit: 'cover', quality: 55 }
    }
};

function getRequirements(imageType) { return IMAGE_REQUIREMENTS[imageType] || null; }
function getDisplayInfo(imageType) { const r = IMAGE_REQUIREMENTS[imageType]; return r ? r.display : null; }
function getValidationRules(imageType) { const r = IMAGE_REQUIREMENTS[imageType]; return r ? r.validation : null; }
function getProcessingRules(imageType) { const r = IMAGE_REQUIREMENTS[imageType]; return r ? r.processing : null; }

module.exports = { IMAGE_REQUIREMENTS, getRequirements, getDisplayInfo, getValidationRules, getProcessingRules };
