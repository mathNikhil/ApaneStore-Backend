const imageService = require('../services/imageService');

class ImageController {
    async uploadImage(req, res) {
        try {
            const { tenantId, storeId, productId, categoryId, usageType } = req.body;
            
            if (!req.file) {
                return res.status(400).json({ 
                    success: false,
                    error: 'No file uploaded' 
                });
            }

            const result = await imageService.uploadImage(req.file, {
                tenantId,
                storeId: storeId || null,
                productId: productId || null,
                categoryId: categoryId || null,
                usageType: usageType || 'product',
            });

            res.json(result);
        } catch (error) {
            console.error('Upload error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    async uploadMultipleImages(req, res) {
        try {
            const { tenantId, storeId, productId, categoryId, usageType } = req.body;
            
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ 
                    success: false,
                    error: 'No files uploaded' 
                });
            }

            const results = await imageService.batchUploadImages(req.files, {
                tenantId,
                storeId: storeId || null,
                productId: productId || null,
                categoryId: categoryId || null,
                usageType: usageType || 'product',
            });

            res.json({ 
                success: true, 
                results,
                totalUploaded: results.filter(r => r.success).length,
                totalFailed: results.filter(r => !r.success).length
            });
        } catch (error) {
            console.error('Batch upload error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    async deleteImage(req, res) {
        try {
            const { filePath } = req.body;
            if (!filePath) {
                return res.status(400).json({ 
                    success: false,
                    error: 'File path required' 
                });
            }
            const result = await imageService.deleteImage(filePath);
            res.json(result);
        } catch (error) {
            console.error('Delete error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    async deleteProductImages(req, res) {
        try {
            const { tenantId, storeId, productId } = req.body;
            if (!tenantId || !storeId || !productId) {
                return res.status(400).json({ 
                    success: false,
                    error: 'tenantId, storeId, and productId required' 
                });
            }
            const result = await imageService.deleteProductImages(tenantId, storeId, productId);
            res.json(result);
        } catch (error) {
            console.error('Delete product error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    async getStorageUsage(req, res) {
        try {
            const { tenantId } = req.params;
            if (!tenantId) {
                return res.status(400).json({ 
                    success: false,
                    error: 'tenantId required' 
                });
            }
            const usage = imageService.getStorageUsage(tenantId);
            res.json({ 
                success: true, 
                data: usage 
            });
        } catch (error) {
            console.error('Storage usage error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }
}

module.exports = new ImageController();