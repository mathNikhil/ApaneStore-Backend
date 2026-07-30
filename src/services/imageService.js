const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

class ImageService {
    constructor() {
        this.uploadBasePath = process.env.UPLOAD_PATH || './uploads';
        this.allowedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        this.maxFileSize = 5 * 1024 * 1024; // 5MB
        
        this.ensureDirectories();
    }

    ensureDirectories() {
        const dirs = [
            this.uploadBasePath,
            path.join(this.uploadBasePath, 'tenants'),
            path.join(this.uploadBasePath, 'temp'),
        ];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    getTenantPath(tenantId) {
        const tenantPath = path.join(this.uploadBasePath, 'tenants', tenantId);
        if (!fs.existsSync(tenantPath)) {
            fs.mkdirSync(tenantPath, { recursive: true });
        }
        return tenantPath;
    }

    getStorePath(tenantId, storeId) {
        const storePath = path.join(this.getTenantPath(tenantId), 'stores', storeId);
        if (!fs.existsSync(storePath)) {
            fs.mkdirSync(storePath, { recursive: true });
        }
        return storePath;
    }

    getProductPath(tenantId, storeId, productId) {
        const productPath = path.join(this.getStorePath(tenantId, storeId), 'products', productId);
        if (!fs.existsSync(productPath)) {
            fs.mkdirSync(productPath, { recursive: true });
        }
        return productPath;
    }

    getCategoryPath(tenantId, storeId, categoryId) {
        const categoryPath = path.join(this.getStorePath(tenantId, storeId), 'categories', categoryId);
        if (!fs.existsSync(categoryPath)) {
            fs.mkdirSync(categoryPath, { recursive: true });
        }
        return categoryPath;
    }

    getBrandPath(tenantId) {
        const brandPath = path.join(this.getTenantPath(tenantId), 'brand');
        if (!fs.existsSync(brandPath)) {
            fs.mkdirSync(brandPath, { recursive: true });
        }
        return brandPath;
    }

    // ============================================
    // UPLOAD METHODS (Existing)
    // ============================================

    async uploadImage(file, options = {}) {
        const {
            tenantId,
            storeId,
            productId = null,
            categoryId = null,
            usageType = 'product',
            variantId = null,
        } = options;

        if (!tenantId) {
            throw new Error('tenantId is required');
        }

        if (!file) {
            throw new Error('No file provided');
        }

        if (!this.allowedFormats.includes(file.mimetype)) {
            throw new Error(`File format not supported. Allowed: ${this.allowedFormats.join(', ')}`);
        }

        if (file.size > this.maxFileSize) {
            throw new Error(`File size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit`);
        }

        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const baseFilename = `${timestamp}_${random}`;
        
        let uploadFolder;
        let urlPrefix;

        switch (usageType) {
            case 'logo':
            case 'brand':
                uploadFolder = this.getBrandPath(tenantId);
                urlPrefix = `/uploads/tenants/${tenantId}/brand`;
                break;
            case 'banner':
                if (!storeId) throw new Error('storeId required for banner upload');
                uploadFolder = path.join(this.getStorePath(tenantId, storeId), 'banner');
                urlPrefix = `/uploads/tenants/${tenantId}/stores/${storeId}/banner`;
                break;
            case 'category':
                if (!storeId || !categoryId) throw new Error('storeId and categoryId required for category upload');
                uploadFolder = this.getCategoryPath(tenantId, storeId, categoryId);
                urlPrefix = `/uploads/tenants/${tenantId}/stores/${storeId}/categories/${categoryId}`;
                break;
            case 'product':
            case 'product-main':
            case 'product-gallery':
                if (!storeId || !productId) throw new Error('storeId and productId required for product upload');
                uploadFolder = this.getProductPath(tenantId, storeId, productId);
                if (variantId) {
                    uploadFolder = path.join(uploadFolder, 'variants', variantId);
                    urlPrefix = `/uploads/tenants/${tenantId}/stores/${storeId}/products/${productId}/variants/${variantId}`;
                } else {
                    urlPrefix = `/uploads/tenants/${tenantId}/stores/${storeId}/products/${productId}`;
                }
                break;
            default:
                uploadFolder = path.join(this.getTenantPath(tenantId), 'misc');
                urlPrefix = `/uploads/tenants/${tenantId}/misc`;
        }

        if (!fs.existsSync(uploadFolder)) {
            fs.mkdirSync(uploadFolder, { recursive: true });
        }

        const buffer = fs.readFileSync(file.path);
        const ext = path.extname(file.originalname).toLowerCase();

        const versions = {};

        // 1. ORIGINAL
        const originalFilename = `${baseFilename}_original${ext}`;
        const originalPath = path.join(uploadFolder, originalFilename);
        await sharp(buffer)
            .jpeg({ quality: 95, mozjpeg: true })
            .png({ quality: 95 })
            .webp({ quality: 95 })
            .toFile(originalPath);
        versions.original = `${urlPrefix}/${originalFilename}`;

        // 2. WEB OPTIMIZED (800x800)
        const webFilename = `${baseFilename}_web.webp`;
        const webPath = path.join(uploadFolder, webFilename);
        await sharp(buffer)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(webPath);
        versions.web = `${urlPrefix}/${webFilename}`;

        // 3. THUMBNAIL (200x200)
        const thumbFilename = `${baseFilename}_thumb.webp`;
        const thumbPath = path.join(uploadFolder, thumbFilename);
        await sharp(buffer)
            .resize(200, 200, { fit: 'cover' })
            .webp({ quality: 70 })
            .toFile(thumbPath);
        versions.thumbnail = `${urlPrefix}/${thumbFilename}`;

        // 4. MOBILE (400x400)
        const mobileFilename = `${baseFilename}_mobile.webp`;
        const mobilePath = path.join(uploadFolder, mobileFilename);
        await sharp(buffer)
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 70 })
            .toFile(mobilePath);
        versions.mobile = `${urlPrefix}/${mobileFilename}`;

        // 5. HD (1200x1200)
        const hdFilename = `${baseFilename}_hd.webp`;
        const hdPath = path.join(uploadFolder, hdFilename);
        await sharp(buffer)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 90 })
            .toFile(hdPath);
        versions.hd = `${urlPrefix}/${hdFilename}`;

        try {
            fs.unlinkSync(file.path);
        } catch (err) {
            console.warn('Could not delete temp file:', err.message);
        }

        return {
            success: true,
            urls: versions,
            publicId: `${tenantId}/${storeId || ''}/${productId || ''}/${baseFilename}`,
            size: file.size,
            format: file.mimetype.split('/')[1],
            width: 0,
            height: 0,
            usageType: usageType,
        };
    }

    async batchUploadImages(files, options = {}) {
        const results = [];
        for (const file of files) {
            try {
                const result = await this.uploadImage(file, options);
                results.push(result);
            } catch (error) {
                results.push({ 
                    success: false, 
                    error: error.message,
                    fileName: file.originalname 
                });
            }
        }
        return results;
    }

    // ============================================
    // DELETE METHODS (Existing + New)
    // ============================================

    /**
     * Delete a single image (all versions)
     */
    async deleteImage(filePath) {
        try {
            const fullPath = path.join(this.uploadBasePath, filePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
            return { success: true };
        } catch (error) {
            console.error('Delete error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete all images for a product
     */
    async deleteProductImages(tenantId, storeId, productId) {
        try {
            const productPath = this.getProductPath(tenantId, storeId, productId);
            if (fs.existsSync(productPath)) {
                const fileCount = this.countFiles(productPath);
                const size = this.getFolderSize(productPath);
                fs.rmSync(productPath, { recursive: true, force: true });
                console.log(`🗑️ Deleted product images: ${productId} (${fileCount} files, ${(size / 1024 / 1024).toFixed(2)} MB)`);
            }
            return { success: true };
        } catch (error) {
            console.error('Delete product error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * ✅ NEW: Delete ALL images for a store
     * Recursively deletes the entire store folder
     */
    async deleteStoreImages(tenantId, storeId) {
        try {
            const storePath = path.join(
                this.uploadBasePath, 
                'tenants', 
                tenantId, 
                'stores', 
                storeId
            );
            
            if (fs.existsSync(storePath)) {
                const fileCount = this.countFiles(storePath);
                const size = this.getFolderSize(storePath);
                
                // Delete the entire folder
                fs.rmSync(storePath, { recursive: true, force: true });
                
                console.log(`🗑️ Deleted store images: ${storeId} (${fileCount} files, ${(size / 1024 / 1024).toFixed(2)} MB)`);
                
                return {
                    success: true,
                    filesDeleted: fileCount,
                    sizeDeleted: size,
                    sizeDeletedMB: (size / 1024 / 1024).toFixed(2)
                };
            }
            
            return {
                success: true,
                filesDeleted: 0,
                sizeDeleted: 0,
                sizeDeletedMB: '0.00',
                message: 'No images found for this store'
            };
        } catch (error) {
            console.error('Error deleting store images:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * ✅ NEW: Delete a category folder and its images
     */
    async deleteCategoryImages(tenantId, storeId, categoryId) {
        try {
            const categoryPath = this.getCategoryPath(tenantId, storeId, categoryId);
            if (fs.existsSync(categoryPath)) {
                const fileCount = this.countFiles(categoryPath);
                const size = this.getFolderSize(categoryPath);
                fs.rmSync(categoryPath, { recursive: true, force: true });
                console.log(`🗑️ Deleted category images: ${categoryId} (${fileCount} files)`);
            }
            return { success: true };
        } catch (error) {
            console.error('Delete category error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * ✅ NEW: Delete brand images (logo, banner, etc.)
     */
    async deleteBrandImages(tenantId) {
        try {
            const brandPath = this.getBrandPath(tenantId);
            if (fs.existsSync(brandPath)) {
                const fileCount = this.countFiles(brandPath);
                const size = this.getFolderSize(brandPath);
                fs.rmSync(brandPath, { recursive: true, force: true });
                console.log(`🗑️ Deleted brand images for tenant: ${tenantId} (${fileCount} files)`);
            }
            return { success: true };
        } catch (error) {
            console.error('Delete brand error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // HELPER METHODS (Existing + New)
    // ============================================

    /**
     * ✅ NEW: Count files in a directory (recursive)
     */
    countFiles(dir) {
        let count = 0;
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    count += this.countFiles(filePath);
                } else {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * ✅ NEW: Get total size of a directory (recursive)
     */
    getFolderSize(dir) {
        let size = 0;
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    size += this.getFolderSize(filePath);
                } else {
                    size += stat.size;
                }
            }
        }
        return size;
    }

    /**
     * Get storage usage for a tenant
     */
    getStorageUsage(tenantId) {
        const tenantPath = this.getTenantPath(tenantId);
        let totalSize = 0;
        let totalFiles = 0;
        let totalFolders = 0;

        const walkDir = (dir) => {
            try {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isDirectory()) {
                        totalFolders++;
                        walkDir(filePath);
                    } else {
                        totalSize += stat.size;
                        totalFiles++;
                    }
                }
            } catch (err) {
                console.warn('Error walking directory:', err);
            }
        };

        if (fs.existsSync(tenantPath)) {
            walkDir(tenantPath);
        }

        return {
            totalSize: totalSize,
            totalFiles: totalFiles,
            totalFolders: totalFolders,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
            totalSizeGB: (totalSize / (1024 * 1024 * 1024)).toFixed(2),
        };
    }
}

module.exports = new ImageService();