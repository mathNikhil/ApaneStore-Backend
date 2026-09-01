/**
 * Tests: /api/products/* and /api/store/:id/orders/*
 * Covers: CRUD products, customer orders, store isolation
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { makeMockPool, makeToken, fixtures, TEST_JWT_SECRET } = require('./helpers');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), TEST_JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function buildApp(pool) {
  const app = express();
  app.use(express.json());

  // GET /api/products?storeId=x
  app.get('/api/products', authMiddleware, async (req, res) => {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId query param required' });
    const result = await pool.query(
      'SELECT * FROM products WHERE store_id=$1 ORDER BY created_at DESC',
      [storeId]
    );
    return res.json({ products: result.rows });
  });

  // POST /api/products
  app.post('/api/products', authMiddleware, async (req, res) => {
    const { storeId, name, price, category, images } = req.body;
    if (!storeId || !name || price === undefined) {
      return res.status(400).json({ error: 'storeId, name, price are required' });
    }
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    // Verify store belongs to this tenant
    const storeCheck = await pool.query(
      'SELECT id FROM stores WHERE id=$1 AND tenant_id=$2',
      [storeId, req.user.tenantId]
    );
    if (!storeCheck.rows.length) return res.status(403).json({ error: 'Access denied' });

    const result = await pool.query(
      'INSERT INTO products (store_id,name,price,category,images) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [storeId, name, price, category || null, JSON.stringify(images || [])]
    );
    return res.status(201).json({ product: result.rows[0] });
  });

  // DELETE /api/products/:id
  app.delete('/api/products/:id', authMiddleware, async (req, res) => {
    // Must verify product belongs to tenant's store
    const result = await pool.query(
      `DELETE FROM products p
       USING stores s
       WHERE p.id=$1 AND p.store_id=s.id AND s.tenant_id=$2
       RETURNING p.id`,
      [req.params.id, req.user.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found' });
    return res.json({ deleted: true });
  });

  // GET /api/store/:storeId/orders — customer orders for a store
  app.get('/api/store/:storeId/orders', authMiddleware, async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM orders WHERE store_id=$1 AND customer_id=$2 ORDER BY created_at DESC',
      [req.params.storeId, req.user.customerId]
    );
    return res.json({ orders: result.rows });
  });

  // POST /api/store/:storeId/orders — place order
  app.post('/api/store/:storeId/orders', authMiddleware, async (req, res) => {
    const { items, address, paymentMethod } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'items are required' });
    if (!address) return res.status(400).json({ error: 'address is required' });
    if (!paymentMethod) return res.status(400).json({ error: 'paymentMethod is required' });

    // Validate store is published
    const storeResult = await pool.query(
      "SELECT id FROM stores WHERE id=$1 AND status='published'",
      [req.params.storeId]
    );
    if (!storeResult.rows.length) {
      return res.status(403).json({ error: 'Store is not available' });
    }

    const total = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const result = await pool.query(
      'INSERT INTO orders (store_id,customer_id,items,address,payment_method,total,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.params.storeId, req.user.customerId, JSON.stringify(items), JSON.stringify(address), paymentMethod, total, 'pending']
    );
    return res.status(201).json({ order: result.rows[0] });
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/products', () => {
  let pool, app, token;

  beforeEach(() => {
    pool = makeMockPool([{ id: 1, store_id: 1, name: 'Book', price: 199 }]);
    app = buildApp(pool);
    token = makeToken({ tenantId: 1 });
  });

  test('returns 400 without storeId query param', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test('returns products for a store', async () => {
    const res = await request(app)
      .get('/api/products?storeId=1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].name).toBe('Book');
  });
});

describe('POST /api/products', () => {
  let pool, app, token;

  beforeEach(() => {
    pool = makeMockPool([fixtures.store]);
    app = buildApp(pool);
    token = makeToken({ tenantId: 1 });
  });

  test('returns 400 if required fields missing', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeId: 1, name: 'Book' }); // missing price
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price/i);
  });

  test('returns 400 for negative price', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeId: 1, name: 'Book', price: -50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price/i);
  });

  test('returns 403 if store does not belong to tenant', async () => {
    pool._mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // store check fails
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeId: 999, name: 'Hacked Product', price: 0 });
    expect(res.status).toBe(403);
  });

  test('creates product successfully', async () => {
    pool._mockQuery
      .mockResolvedValueOnce({ rows: [fixtures.store], rowCount: 1 }) // store ownership check
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Kindle Book', price: 299, store_id: 1 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeId: 1, name: 'Kindle Book', price: 299, category: 'books' });
    expect(res.status).toBe(201);
    expect(res.body.product.name).toBe('Kindle Book');
  });
});

describe('DELETE /api/products/:id', () => {
  let pool, app, token;

  beforeEach(() => {
    pool = makeMockPool([{ id: 1 }]);
    app = buildApp(pool);
    token = makeToken({ tenantId: 1 });
  });

  test('returns 404 if product not in tenant store', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/products/999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('deletes product successfully', async () => {
    const res = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

describe('POST /api/store/:storeId/orders (place order)', () => {
  let pool, app, token;
  const orderPayload = {
    items: [{ productId: 1, name: 'Book', price: 199, qty: 2 }],
    address: { line1: '123 Main St', city: 'Delhi', pincode: '110001' },
    paymentMethod: 'UPI',
  };

  beforeEach(() => {
    pool = makeMockPool([fixtures.publishedStore]);
    app = buildApp(pool);
    token = makeToken({ customerId: 42 });
  });

  test('returns 400 if items missing', async () => {
    const res = await request(app)
      .post('/api/store/2/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...orderPayload, items: [] });
    expect(res.status).toBe(400);
  });

  test('returns 403 if store is not published', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // published check fails
    const res = await request(app)
      .post('/api/store/1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(orderPayload);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not available/i);
  });

  test('places order and calculates total correctly', async () => {
    pool._mockQuery
      .mockResolvedValueOnce({ rows: [fixtures.publishedStore], rowCount: 1 }) // store published
      .mockResolvedValueOnce({ rows: [{ id: 10, total: 398, status: 'pending' }], rowCount: 1 }); // insert

    const res = await request(app)
      .post('/api/store/2/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(orderPayload);
    expect(res.status).toBe(201);

    // Verify total calculation: 199 * 2 = 398
    const insertCall = pool._mockQuery.mock.calls.find(c =>
      c[0].includes('INSERT INTO orders')
    );
    expect(insertCall[1]).toContain(398);
    expect(insertCall[1]).toContain('pending');
  });
});
