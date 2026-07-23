const { v4: uuidv4 } = require('uuid');

module.exports = {
    generateId: () => uuidv4(),
    
    generateTenantId: () => {
        const timestamp = Date.now().toString().slice(-6);
        return `TEN-${timestamp}-${Math.floor(Math.random() * 10000)}`;
    },
    
    generateStoreId: () => {
        const timestamp = Date.now().toString().slice(-6);
        return `STR-${timestamp}-${Math.floor(Math.random() * 10000)}`;
    },
    
    generateOrderId: () => {
        const timestamp = Date.now().toString().slice(-6);
        return `ORD-${timestamp}-${Math.floor(Math.random() * 10000)}`;
    },
    
    formatDate: (date) => {
        return new Date(date).toISOString();
    },
    
    getCurrentTimestamp: () => {
        return new Date().toISOString();
    }
};