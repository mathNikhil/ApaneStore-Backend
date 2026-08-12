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
        // ✅ FIX: extension must match the ACTUAL output format, not the
        // uploaded file's original extension. LOGO stays PNG; everything
        // else (HERO, PRODUCT_MAIN, PRODUCT_GALLERY, VARIANT, CATEGORY) gets
        // re-encoded to JPEG below regardless of what was uploaded — using
        // the original extension here previously saved JPEG-encoded bytes
        // under a .png filename, causing express.static to send the wrong
        // Content-Type header (image/png for actual JPEG data).
        const outputExtension = imageType === 'LOGO' ? '.png' : '.jpg';
        const uniqueFilename = `${imageType.toLowerCase()}_${timestamp}${outputExtension}`;
        
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
        } else if (imageType === 'RETURN') {
            // ✅ This branch was missing entirely — RETURN was added to
            // validation config, routes, and the controller call, but
            // never here, so every return-photo upload threw "Unknown
            // image type: RETURN" before ever reaching the database,
            // regardless of the UUID/reference_id/format fixes applied
            // elsewhere in this chain.
            if (!referenceId) {
                throw new Error('Return ID is required for return images');
            }
            folderPath = `tenants/${tenantId}/stores/${storeId}/returns/${referenceId}`;
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
            } else {
                processedBuffer = await sharp(file.buffer)
                    .jpeg({ quality: 85, progressive: true })
                    .toBuffer();
                finalMimeType = 'image/jpeg';
            }
        }
        // For product images - use JPEG with good quality
        else if (['PRODUCT_MAIN', 'PRODUCT_GALLERY', 'VARIANT', 'CATEGORY', 'RETURN'].includes(imageType)) {
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
        // ✅ FIX: server.js serves uploads at `/uploads`, not `/api/uploads`
        // (app.use('/uploads', express.static(...))). relativePath already
        // starts with "uploads/...", so prefixing with /api here produced a
        // URL that always 404'd — images uploaded and saved fine, but never
        // actually rendered anywhere they were displayed from stored URLs.
        const baseUrl = process.env.API_URL || `http://localhost:5002`;
        const imageUrl = `${baseUrl}/${relativePath.replace(/\\/g, '/')}`;

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
        // ✅ FIX: same /api prefix bug as processAndSaveImage above — server.js
        // serves uploads at /uploads, not /api/uploads.
        const baseUrl = process.env.API_URL || `http://localhost:5002`;
        return `${baseUrl}/${storagePath.replace(/\\/g, '/')}`;
    }
}

module.exports = ImageService;