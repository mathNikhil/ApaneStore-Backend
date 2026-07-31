const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const ensureDirectoryExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Configure multer for memory storage (better for validation)
const storage = multer.memoryStorage();

// File filter for initial MIME check
const fileFilter = (req, file, cb) => {
    // Allow only images
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

// Create multer instance
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max initial limit
        files: 10, // Max 10 files per request
    },
    fileFilter: fileFilter,
});

// Single file upload middleware
const uploadSingle = (fieldName) => {
    return upload.single(fieldName);
};

// Multiple files upload middleware
const uploadMultiple = (fieldName, maxCount = 5) => {
    return upload.array(fieldName, maxCount);
};

// Error handler for multer
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'FILE_TOO_LARGE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 5MB.'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files. Maximum is 10 files.'
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: 'Unexpected file field.'
            });
        }
        return res.status(400).json({
            success: false,
            error: `Upload error: ${err.message}`
        });
    }
    
    if (err) {
        return res.status(400).json({
            success: false,
            error: err.message
        });
    }
    
    next();
};

module.exports = {
    upload,
    uploadSingle,
    uploadMultiple,
    handleMulterError,
    ensureDirectoryExists
};