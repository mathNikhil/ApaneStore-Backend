const ImageService = require('../services/imageService');
const StoreImage = require('../models/StoreImage');
const { getDisplayInfo } = require('../config/imageRequirements');

class ImageController {
    // Upload a single image
    static async uploadImage(req, res) {
        try {
            const { storeId, tenantId } = req.params;
            const imageType = req.imageType; // Now reliably set by the route middleware
            const referenceId = req.body.referenceId || null;

            // Check if tenant and store exist
            if (!tenantId || !storeId) {
                return res.status(400).json({
                    success: false,
                    error: 'Tenant ID and Store ID are required'
                });
            }

            // Process and save image
            const result = await ImageService.processAndSaveImage(
                req.file,
                imageType,
                tenantId,
                storeId,
                referenceId
            );

            return res.status(201).json({
                success: true,
                message: 'Image uploaded successfully',
                data: result
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Upload multiple images (gallery)
    static async uploadMultipleImages(req, res) {
        try {
            const { storeId, tenantId } = req.params;
            const imageType = req.imageType; // Now reliably set by the route middleware
            const referenceId = req.body.referenceId;

            if (!referenceId) {
                return res.status(400).json({
                    success: false,
                    error: 'Reference ID (product_id, variant_id, etc.) is required'
                });
            }

            const results = [];
            const errors = [];

            // Process each file
            for (const file of req.files) {
                try {
                    const result = await ImageService.processAndSaveImage(
                        file,
                        imageType,
                        tenantId,
                        storeId,
                        referenceId
                    );
                    results.push(result);
                } catch (error) {
                    errors.push({
                        filename: file.originalname,
                        error: error.message
                    });
                }
            }

            return res.status(201).json({
                success: true,
                message: `${results.length} images uploaded successfully`,
                data: {
                    uploaded: results,
                    failed: errors
                }
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Get all images for a store
    static async getStoreImages(req, res) {
        try {
            const { storeId } = req.params;
            
            const images = await StoreImage.findByStore(storeId);
            
            // Add URLs to each image
            const imagesWithUrls = images.map(image => ({
                ...image,
                url: ImageService.getImageUrl(storeId, image.storage_path)
            }));

            return res.status(200).json({
                success: true,
                data: imagesWithUrls
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Get branding images (logo, hero)
    static async getBrandingImages(req, res) {
        try {
            const { storeId } = req.params;
            
            const images = await StoreImage.findBrandingImages(storeId);
            
            const imagesWithUrls = images.map(image => ({
                ...image,
                url: ImageService.getImageUrl(storeId, image.storage_path)
            }));

            return res.status(200).json({
                success: true,
                data: imagesWithUrls
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Get product images
    static async getProductImages(req, res) {
        try {
            const { productId } = req.params;
            
            const images = await StoreImage.findProductImages(productId);
            
            // Group by type
            const mainImage = images.find(img => img.image_type === 'PRODUCT_MAIN');
            const galleryImages = images.filter(img => img.image_type === 'PRODUCT_GALLERY');

            return res.status(200).json({
                success: true,
                data: {
                    main: mainImage ? {
                        ...mainImage,
                        url: ImageService.getImageUrl(mainImage.store_id, mainImage.storage_path)
                    } : null,
                    gallery: galleryImages.map(img => ({
                        ...img,
                        url: ImageService.getImageUrl(img.store_id, img.storage_path)
                    }))
                }
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Delete an image
    static async deleteImage(req, res) {
        try {
            const { imageId } = req.params;
            
            const result = await ImageService.deleteImage(imageId);

            return res.status(200).json({
                success: true,
                message: 'Image deleted successfully',
                data: result
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Get image requirements/display info
    static async getRequirements(req, res) {
        try {
            const { imageType } = req.params;
            
            const displayInfo = getDisplayInfo(imageType);
            if (!displayInfo) {
                return res.status(404).json({
                    success: false,
                    error: 'Unknown image type'
                });
            }

            return res.status(200).json({
                success: true,
                data: displayInfo
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Get all requirements
    static async getAllRequirements(req, res) {
        try {
            const { IMAGE_REQUIREMENTS } = require('../config/imageRequirements');
            
            // Return only display info
            const displayInfo = {};
            for (const [key, value] of Object.entries(IMAGE_REQUIREMENTS)) {
                displayInfo[key] = value.display;
            }

            return res.status(200).json({
                success: true,
                data: displayInfo
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

    // Crop a hero image — receives natural-pixel crop rect, runs Sharp extract, overwrites file
    static async cropHeroImage(req, res) {
        try {
            const { imageId } = req.params;
            const { cropX, cropY, cropW, cropH } = req.body;

            if ([cropX, cropY, cropW, cropH].some(v => v === undefined || isNaN(Number(v)))) {
                return res.status(400).json({ success: false, error: 'cropX, cropY, cropW, cropH are required numbers' });
            }
            const cx = Math.round(Number(cropX));
            const cy = Math.round(Number(cropY));
            const cw = Math.round(Number(cropW));
            const ch = Math.round(Number(cropH));
            if (cw < 10 || ch < 10) return res.status(400).json({ success: false, error: 'Crop area too small' });

            const image = await StoreImage.findById(imageId);
            if (!image) return res.status(404).json({ success: false, error: 'Image not found' });

            const sharp = require('sharp');
            const path  = require('path');
            const fs    = require('fs');

            const filePath = path.join(__dirname, '../../', image.storage_path);
            if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Image file not found on disk' });

            // Read, extract crop region, re-encode to webp
            const cropped = await sharp(filePath)
                .extract({ left: cx, top: cy, width: cw, height: ch })
                .webp({ quality: 90, effort: 4 })
                .toBuffer();

            await fs.promises.writeFile(filePath, cropped);

            // Update DB dimensions
            const pool = require('../config/database');
            await pool.query(
                'UPDATE store_images SET width = $1, height = $2, file_size = $3 WHERE id = $4',
                [cw, ch, cropped.length, imageId]
            );

            return res.json({ success: true, message: 'Image cropped successfully', data: { width: cw, height: ch } });
        } catch (error) {
            console.error('cropHeroImage error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = ImageController;
