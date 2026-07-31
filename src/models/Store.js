// Add this to your existing Store model
// Look for the table definition and add status if missing

// Find this section in your existing code and add:
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS stores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        slug VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'DRAFT',  // <-- ADD THIS LINE
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
`;

// Also add this method to the Store class
static async updateStatus(storeId, status) {
    const result = await pool.query(
        `UPDATE stores 
         SET status = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING *`,
        [status, storeId]
    );
    return result.rows[0] || null;
}