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

    async uploadImage(file, options = {}) {
        const {
            tenantId,
            storeId,
            productId = null,
            categoryId = null,
            usageType = 'product',
            variantId = null,
        } = options;

        // Validate tenantId
        if (!tenantId) {
            throw new Error('tenantId is required');
        }

        // Validate file
        if (!file) {
            throw new Error('No file provided');
        }

        if (!this.allowedFormats.includes(file.mimetype)) {
            throw new Error(`File format not supported. Allowed: ${this.allowedFormats.join(', ')}`);
        }

        if (file.size > this.maxFileSize) {
            throw new Error(`File size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit`);
        }

        // Generate unique filename
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const baseFilename = `${timestamp}_${random}`;
        
        // Determine folder structure
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

        // Ensure upload folder exists
        if (!fs.existsSync(uploadFolder)) {
            fs.mkdirSync(uploadFolder, { recursive: true });
        }

        // Read file buffer
        const buffer = fs.readFileSync(file.path);
        const ext = path.extname(file.originalname).toLowerCase();

        // Generate multiple versions
        const versions = {};

        // 1. ORIGINAL (optimized)
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

        // Delete temp file
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

    async deleteImage(filePath) {
        try {
            // Delete all versions
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

    async deleteProductImages(tenantId, storeId, productId) {
        try {
            const productPath = this.getProductPath(tenantId, storeId, productId);
            if (fs.existsSync(productPath)) {
                fs.rmSync(productPath, { recursive: true, force: true });
            }
            return { success: true };
        } catch (error) {
            console.error('Delete product error:', error);
            return { success: false, error: error.message };
        }
    }

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