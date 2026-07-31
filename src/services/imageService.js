const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { ensureDirectoryExists } = require('../middleware/upload');
const StoreImage = require('../models/StoreImage');

class ImageService {
    // Process and save a single image
    static async processAndSaveImage(file, imageType, tenantId, storeId, referenceId = null) {
        // Generate unique filename
        const timestamp = Date.now();
        const extension = path.extname(file.originalname);
        const uniqueFilename = `${imageType.toLowerCase()}_${timestamp}${extension}`;
        
        // Build storage path
        let folderPath;
        if (imageType === 'LOGO' || imageType === 'HERO') {
            folderPath = `tenants/${tenantId}/stores/${storeId}/branding`;
        } else if (imageType === 'PRODUCT_MAIN' || imageType === 'PRODUCT_GALLERY') {
            if (!referenceId) {
                throw new Error('Product ID is required for product images');
            }
            folderPath = `tenants/${tenantId}/stores/${storeId}/products/${referenceId}`;
            if (imageType === 'PRODUCT_GALLERY') {
                folderPath += '/gallery';
            }
        } else if (imageType === 'VARIANT') {
            if (!referenceId) {
                throw new Error('Variant ID is required for variant images');
            }
            folderPath = `tenants/${tenantId}/stores/${storeId}/variants/${referenceId}`;
        } else if (imageType === 'CATEGORY') {
            if (!referenceId) {
                throw new Error('Category ID is required for category images');
            }
            folderPath = `tenants/${tenantId}/stores/${storeId}/categories/${referenceId}`;
        } else {
            throw new Error(`Unknown image type: ${imageType}`);
        }

        // Full storage path
        const fullPath = path.join(__dirname, '../../uploads', folderPath);
        ensureDirectoryExists(fullPath);

        const filePath = path.join(fullPath, uniqueFilename);
        const relativePath = path.join('uploads', folderPath, uniqueFilename);

        // Get image metadata
        const metadata = await sharp(file.buffer).metadata();

        // Process and save image
        let processedBuffer;
        let finalMimeType = file.mimetype;

        // For logos (PNG) - keep as PNG with compression
        if (imageType === 'LOGO') {
            processedBuffer = await sharp(file.buffer)
                .png({ quality: 85, compressionLevel: 9 })
                .toBuffer();
            finalMimeType = 'image/png';
        } 
        // For hero banners - optimize for web
        else if (imageType === 'HERO') {
            // If JPEG, compress; if PNG, convert to JPEG
            if (file.mimetype === 'image/png') {
                processedBuffer = await sharp(file.buffer)
                    .jpeg({ quality: 85, progressive: true })
                    .toBuffer();
                finalMimeType = 'image/jpeg';
                // Update filename extension
                const newFilename = uniqueFilename.replace(/\.png$/i, '.jpg');
                // We'll handle this differently - let's just use the original extension
            } else {
                processedBuffer = await sharp(file.buffer)
                    .jpeg({ quality: 85, progressive: true })
                    .toBuffer();
                finalMimeType = 'image/jpeg';
            }
        }
        // For product images - use JPEG with good quality
        else if (['PRODUCT_MAIN', 'PRODUCT_GALLERY', 'VARIANT', 'CATEGORY'].includes(imageType)) {
            if (file.mimetype === 'image/png') {
                processedBuffer = await sharp(file.buffer)
                    .jpeg({ quality: 80, progressive: true })
                    .toBuffer();
                finalMimeType = 'image/jpeg';
            } else {
                processedBuffer = await sharp(file.buffer)
                    .jpeg({ quality: 80, progressive: true })
                    .toBuffer();
                finalMimeType = 'image/jpeg';
            }
        } else {
            processedBuffer = file.buffer;
        }

        // Save file
        await fs.promises.writeFile(filePath, processedBuffer);

        // Get final file size
        const stats = await fs.promises.stat(filePath);

        // Save to database
        const imageData = {
            tenant_id: tenantId,
            store_id: storeId,
            image_type: imageType,
            reference_id: referenceId || null,
            original_filename: file.originalname,
            storage_path: relativePath,
            file_size: stats.size,
            width: metadata.width,
            height: metadata.height,
            mime_type: finalMimeType
        };

        const savedImage = await StoreImage.create(imageData);

        // Return image URL
        const baseUrl = process.env.API_URL || `http://localhost:5002`;
        const imageUrl = `${baseUrl}/api/${relativePath.replace(/\\/g, '/')}`;

        return {
            ...savedImage,
            url: imageUrl
        };
    }

    // Delete an image (hard delete)
    static async deleteImage(imageId) {
        // Get image record
        const image = await StoreImage.findById(imageId);
        if (!image) {
            throw new Error('Image not found');
        }

        // Delete file from filesystem
        const filePath = path.join(__dirname, '../../', image.storage_path);
        try {
            await fs.promises.unlink(filePath);
        } catch (error) {
            // File doesn't exist, continue with database deletion
            console.warn(`File not found: ${filePath}`);
        }

        // Delete from database
        await StoreImage.hardDelete(imageId);

        return { success: true, imageId };
    }

    // Delete all images for a store
    static async deleteStoreImages(storeId) {
        // Get all images
        const images = await StoreImage.findByStore(storeId);
        
        // Delete files
        for (const image of images) {
            const filePath = path.join(__dirname, '../../', image.storage_path);
            try {
                await fs.promises.unlink(filePath);
            } catch (error) {
                console.warn(`File not found: ${filePath}`);
            }
        }

        // Delete from database
        await StoreImage.hardDeleteByStore(storeId);

        return { success: true, storeId, count: images.length };
    }

    // Delete all images for a product
    static async deleteProductImages(productId) {
        // Get all images for product
        const images = await StoreImage.findByReference(productId);
        
        // Delete files
        for (const image of images) {
            const filePath = path.join(__dirname, '../../', image.storage_path);
            try {
                await fs.promises.unlink(filePath);
            } catch (error) {
                console.warn(`File not found: ${filePath}`);
            }
        }

        // Delete from database
        await StoreImage.hardDeleteByReference(productId);

        return { success: true, productId, count: images.length };
    }

    // Cleanup orphaned images (images in filesystem but not in database)
    static async cleanupOrphanedImages() {
        const uploadsPath = path.join(__dirname, '../../uploads');
        const orphaned = [];

        // Recursive function to walk directory
        async function walkDir(dir) {
            const files = await fs.promises.readdir(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = await fs.promises.stat(fullPath);
                if (stat.isDirectory()) {
                    await walkDir(fullPath);
                } else {
                    // Check if file exists in database
                    const relativePath = path.relative(path.join(__dirname, '../..'), fullPath);
                    const dbRecord = await StoreImage.findByStoragePath(relativePath);
                    if (!dbRecord) {
                        orphaned.push(fullPath);
                    }
                }
            }
        }

        await walkDir(uploadsPath);

        // Delete orphaned files
        for (const file of orphaned) {
            try {
                await fs.promises.unlink(file);
                console.log(`Deleted orphaned file: ${file}`);
            } catch (error) {
                console.error(`Failed to delete orphaned file: ${file}`, error);
            }
        }

        return { orphanedCount: orphaned.length };
    }

    // Get image URL
    static getImageUrl(storeId, storagePath) {
        const baseUrl = process.env.API_URL || `http://localhost:5002`;
        return `${baseUrl}/api/${storagePath.replace(/\\/g, '/')}`;
    }
}

module.exports = ImageService;