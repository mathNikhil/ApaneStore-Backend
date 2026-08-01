const express = require('express');
const router = express.Router();
const ImageController = require('../controllers/imageController');
const { uploadSingle, uploadMultiple, handleMulterError } = require('../middleware/upload');
const { validateSingleImage, validateMultipleImages } = require('../middleware/imageValidation');

// ==================== PUBLIC ROUTES ====================
router.get('/images/requirements', ImageController.getAllRequirements);
router.get('/images/requirements/:imageType', ImageController.getRequirements);

// ==================== STORE IMAGES ====================
router.get('/:storeId/images', ImageController.getStoreImages);
router.get('/:storeId/images/branding', ImageController.getBrandingImages);

// ==================== BRANDING IMAGES (STEP 1) ====================
router.post(
    '/:tenantId/:storeId/images/logo',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'LOGO'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

router.post(
    '/:tenantId/:storeId/images/hero',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'HERO'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

// ==================== PRODUCT IMAGES (STEP 2) ====================
router.post(
    '/:tenantId/:storeId/images/products/main',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'PRODUCT_MAIN'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

router.post(
    '/:tenantId/:storeId/images/products/gallery',
    // ✅ Raised from 5 to 20 to match the frontend's per-product image cap
    // (Step2_ProductConfig.jsx maxImages = 20). Multer's .array() rejects
    // every file past maxCount with "Unexpected field" — was silently
    // breaking any product with more than 6 total images (1 main + 5+ gallery).
    uploadMultiple('images', 20),
    handleMulterError,
    (req, res, next) => { req.imageType = 'PRODUCT_GALLERY'; next(); },
    validateMultipleImages,
    ImageController.uploadMultipleImages
);

// ==================== VARIANT IMAGES ====================
router.post(
    '/:tenantId/:storeId/images/variants',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'VARIANT'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

// ==================== CATEGORY IMAGES ====================
router.post(
    '/:tenantId/:storeId/images/categories',
    uploadSingle('image'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'CATEGORY'; next(); },
    validateSingleImage,
    ImageController.uploadImage
);

// ==================== PRODUCT SPECIFIC ROUTES ====================
router.get('/products/:productId/images', ImageController.getProductImages);

// ==================== DELETE ROUTES ====================
router.delete('/images/:imageId', ImageController.deleteImage);

module.exports = router;