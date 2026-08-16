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
        display: { hint: 'Recommended: 1200×400px • Max 3MB • JPG/PNG' },
        validation: {
            maxSize: 3 * 1024 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        processing: { width: 1200, height: 400, fit: 'cover' }
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
    }
};

function getRequirements(imageType) { return IMAGE_REQUIREMENTS[imageType] || null; }
function getDisplayInfo(imageType) { const r = IMAGE_REQUIREMENTS[imageType]; return r ? r.display : null; }
function getValidationRules(imageType) { const r = IMAGE_REQUIREMENTS[imageType]; return r ? r.validation : null; }
function getProcessingRules(imageType) { const r = IMAGE_REQUIREMENTS[imageType]; return r ? r.processing : null; }

module.exports = { IMAGE_REQUIREMENTS, getRequirements, getDisplayInfo, getValidationRules, getProcessingRules };
