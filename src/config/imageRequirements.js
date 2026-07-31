// Image requirements for Step 1 (Branding) and Step 2 (Products)

const IMAGE_REQUIREMENTS = {
    // ============ STEP 1: BRANDING ============
    LOGO: {
        // What we SHOW to users
        display: {
            title: 'Store Logo',
            dimensions: '200 × 200 px',
            format: 'PNG only',
            maxSize: '100 KB',
            aspectRatio: '1:1 (Square)',
            hint: 'Upload a clear, high-quality PNG logo'
        },
        // What we ACCEPT (with tolerance)
        validation: {
            minWidth: 190,
            maxWidth: 210,
            minHeight: 190,
            maxHeight: 210,
            minSize: 10 * 1024,        // 10KB
            maxSize: 120 * 1024,       // 120KB (20% tolerance)
            allowedMimeTypes: ['image/png'],
            allowTolerance: true,
        }
    },
    HERO: {
        display: {
            title: 'Hero Banner',
            dimensions: '1200 × 375 px',
            format: 'PNG or JPG',
            maxSize: '300 KB',
            aspectRatio: '3.2:1 (Wide)',
            hint: 'Use an eye-catching image that represents your store'
        },
        validation: {
            minWidth: 1180,
            maxWidth: 1220,
            minHeight: 365,
            maxHeight: 385,
            minSize: 20 * 1024,
            maxSize: 350 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg'],
            allowTolerance: true,
        }
    },
    // ============ STEP 2: PRODUCTS ============
    PRODUCT_MAIN: {
        display: {
            title: 'Product Main Image',
            dimensions: '400 × 400 px',
            format: 'JPG or PNG',
            maxSize: '200 KB',
            aspectRatio: '1:1 (Square)',
            hint: 'Main product image that customers will see first'
        },
        validation: {
            minWidth: 390,
            maxWidth: 410,
            minHeight: 390,
            maxHeight: 410,
            minSize: 20 * 1024,
            maxSize: 220 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg'],
            allowTolerance: true,
        }
    },
    PRODUCT_GALLERY: {
        display: {
            title: 'Product Gallery Images',
            dimensions: '400 × 400 px',
            format: 'JPG or PNG',
            maxSize: '160 KB',
            aspectRatio: '1:1 (Square)',
            hint: 'Additional product views (up to 5 images)'
        },
        validation: {
            minWidth: 390,
            maxWidth: 410,
            minHeight: 390,
            maxHeight: 410,
            minSize: 10 * 1024,
            maxSize: 180 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg'],
            allowTolerance: true,
        }
    },
    VARIANT: {
        display: {
            title: 'Variant Thumbnail',
            dimensions: '100 × 100 px',
            format: 'JPG or PNG',
            maxSize: '30 KB',
            aspectRatio: '1:1 (Square)',
            hint: 'Thumbnail for product variants (size, color, etc.)'
        },
        validation: {
            minWidth: 95,
            maxWidth: 105,
            minHeight: 95,
            maxHeight: 105,
            minSize: 3 * 1024,
            maxSize: 35 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg'],
            allowTolerance: true,
        }
    },
    CATEGORY: {
        display: {
            title: 'Category Image',
            dimensions: '200 × 200 px',
            format: 'JPG or PNG',
            maxSize: '70 KB',
            aspectRatio: '1:1 (Square)',
            hint: 'Category thumbnail for store navigation'
        },
        validation: {
            minWidth: 190,
            maxWidth: 210,
            minHeight: 190,
            maxHeight: 210,
            minSize: 5 * 1024,
            maxSize: 85 * 1024,
            allowedMimeTypes: ['image/png', 'image/jpeg'],
            allowTolerance: true,
        }
    }
};

// Helper function to get requirements by type
function getRequirements(imageType) {
    return IMAGE_REQUIREMENTS[imageType] || null;
}

// Helper function to get display info
function getDisplayInfo(imageType) {
    const req = IMAGE_REQUIREMENTS[imageType];
    return req ? req.display : null;
}

// Helper function to get validation rules
function getValidationRules(imageType) {
    const req = IMAGE_REQUIREMENTS[imageType];
    return req ? req.validation : null;
}

module.exports = {
    IMAGE_REQUIREMENTS,
    getRequirements,
    getDisplayInfo,
    getValidationRules
};