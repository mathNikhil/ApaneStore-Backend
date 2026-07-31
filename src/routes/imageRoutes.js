const express = require('express');
const router = express.Router();
const ImageController = require('../controllers/imageController');
const { uploadSingle, uploadMultiple, handleMulterError } = require('../middleware/upload');
const { validateSingleImage, validateMultipleImages } = require('../middleware/imageValidation');

// ==================== PUBLIC ROUTES ====================
// Get image requirements
router.get('/images/requirements', ImageController.getAllRequirements);
router.get('/images/requirements/:imageType', ImageController.getRequirements);

// ==================== PROTECTED ROUTES ====================
// (Add auth middleware here when ready)

// ==================== STORE IMAGES ====================
// Get all images for a store
router.get('/stores/:storeId/images', ImageController.getStoreImages);
router.get('/stores/:storeId/images/branding', ImageController.getBrandingImages);

// ==================== BRANDING IMAGES (STEP 1) ====================
// Upload Logo (Step 1)
router.post(
    '/stores/:tenantId/:storeId/images/branding/logo',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'LOGO'; next(); }, // Set imageType manually
    validateSingleImage,
    ImageController.uploadImage
);

// Upload Hero Banner (Step 1)
router.post(
    '/stores/:tenantId/:storeId/images/branding/hero',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'HERO'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

// ==================== PRODUCT IMAGES (STEP 2) ====================
// Upload Product Main Image (Step 2)
router.post(
    '/stores/:tenantId/:storeId/images/products/main',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'PRODUCT_MAIN'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

// Upload Product Gallery Images (Step 2)
router.post(
    '/stores/:tenantId/:storeId/images/products/gallery',
    uploadMultiple('images', 5),
    handleMulterError,
    (req, res, next) => { req.imageType = 'PRODUCT_GALLERY'; next(); },
    validateMultipleImages,
    ImageController.uploadMultipleImages
);

// ==================== VARIANT IMAGES (STEP 2) ====================
// Upload Variant Thumbnail
router.post(
    '/stores/:tenantId/:storeId/images/variants',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'VARIANT'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

// ==================== CATEGORY IMAGES (STEP 2) ====================
// Upload Category Image
router.post(
    '/stores/:tenantId/:storeId/images/categories',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'CATEGORY'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

// ==================== PRODUCT SPECIFIC ROUTES ====================
// Get images for a specific product
router.get('/stores/products/:productId/images', ImageController.getProductImages);

// ==================== DELETE ROUTES ====================
// Delete an image
router.delete('/images/:imageId', ImageController.deleteImage);

module.exports = router;