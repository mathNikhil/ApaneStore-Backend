/**
 * Tests: /api/stores/*
 * Covers: list stores, get store, create, publish flow, status machine
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { makeMockPool, makeToken, makeAdminToken, fixtures, TEST_JWT_SECRET } = require('./helpers');

// ─── Auth Middleware ──────────────────────────────────────────────────────────

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

function adminMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.replace('Bearer ', ''), TEST_JWT_SECRET);
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── App Factory ──────────────────────────────────────────────────────────────

function buildApp(pool) {
  const app = express();
  app.use(express.json());

  // GET /api/stores — tenant's own stores
  app.get('/api/stores', authMiddleware, async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM stores WHERE tenant_id = $1', [req.user.tenantId]
    );
    return res.json({ stores: result.rows });
  });

  // GET /api/stores/:id
  app.get('/api/stores/:id', authMiddleware, async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM stores WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Store not found' });
    return res.json({ store: result.rows[0] });
  });

  // POST /api/stores — create store
  app.post('/api/stores', authMiddleware, async (req, res) => {
    const { subdomain, config } = req.body;
    if (!subdomain) return res.status(400).json({ error: 'subdomain is required' });

    // Check subdomain uniqueness
    const existing = await pool.query('SELECT id FROM stores WHERE subdomain = $1', [subdomain]);
    if (existing.rows.length) return res.status(409).json({ error: 'Subdomain already taken' });

    const result = await pool.query(
      'INSERT INTO stores (tenant_id, subdomain, status, config) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.tenantId, subdomain, 'draft', JSON.stringify(config || {})]
    );
    return res.status(201).json({ store: result.rows[0] });
  });

  // PATCH /api/stores/:id — update store config
  app.patch('/api/stores/:id', authMiddleware, async (req, res) => {
    const storeResult = await pool.query(
      'SELECT * FROM stores WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user.tenantId]
    );
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found' });

    const { config } = req.body;
    const updated = await pool.query(
      'UPDATE stores SET config=$1 WHERE id=$2 RETURNING *',
      [JSON.stringify(config), req.params.id]
    );
    return res.json({ store: updated.rows[0] });
  });

  // POST /api/stores/:id/create-payment-order
  app.post('/api/stores/:id/create-payment-order', authMiddleware, async (req, res) => {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: 'planId is required' });

    const planResult = await pool.query('SELECT * FROM pricing_plans WHERE id=$1', [planId]);
    if (!planResult.rows.length) return res.status(404).json({ error: 'Plan not found' });

    const plan = planResult.rows[0];
    const orderId = `store_${req.params.id}_${Date.now()}`;

    await pool.query(
      'INSERT INTO pending_payments (store_id,plan_id,order_id,amount,status) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, planId, orderId, plan.price, 'pending']
    );

    return res.json({ paymentSessionId: 'mock_session_xyz', orderId });
  });

  // Admin: PATCH /api/admin/stores/:id/status
  app.patch('/api/admin/stores/:id/status', adminMiddleware, async (req, res) => {
    const { status, reason } = req.body;
    const validStatuses = ['draft', 'published', 'suspended', 'inactive'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await pool.query(
      'UPDATE stores SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Store not found' });

    return res.json({ store: result.rows[0], reason });
  });

  // GET /api/public/store/:subdomain — public storefront data (no auth)
  app.get('/api/public/store/:subdomain', async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM stores WHERE subdomain=$1 AND status=$2',
      [req.params.subdomain, 'published']
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Store not found or not published' });
    return res.json({ store: result.rows[0] });
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/stores (tenant store list)', () => {
  let pool, app, token;

  beforeEach(() => {
    pool = makeMockPool([fixtures.store]);
    app = buildApp(pool);
    token = makeToken({ tenantId: 1 });
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/stores');
    expect(res.status).toBe(401);
  });

  test('returns tenant stores', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stores).toHaveLength(1);
    expect(res.body.stores[0].subdomain).toBe('test-store');
  });

  test('returns empty array when tenant has no stores', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stores).toHaveLength(0);
  });
});

describe('GET /api/stores/:id', () => {
  let pool, app, token;

  beforeEach(() => {
    pool = makeMockPool([fixtures.store]);
    app = buildApp(pool);
    token = makeToken({ tenantId: 1 });
  });

  test('returns 404 for store not belonging to tenant', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/stores/999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('returns store when it belongs to tenant', async () => {
    const res = await request(app)
      .get('/api/stores/1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.store.id).toBe(1);
  });
});

describe('POST /api/stores (create store)', () => {
  let pool, app, token;

  beforeEach(() => {
    pool = makeMockPool([]);
    app = buildApp(pool);
    token = makeToken({ tenantId: 1 });
  });

  test('returns 400 if subdomain missing', async () => {
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ config: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subdomain/i);
  });

  test('returns 409 if subdomain already taken', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 }); // subdomain exists
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ subdomain: 'taken-name' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/subdomain already taken/i);
  });

  test('creates store with draft status', async () => {
    pool._mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // subdomain check
      .mockResolvedValueOnce({ rows: [{ ...fixtures.store, subdomain: 'new-store' }], rowCount: 1 });

    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ subdomain: 'new-store', config: { brand: { name: 'My Store' } } });
    expect(res.status).toBe(201);
    // Should always start as draft
    expect(pool._mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stores'),
      expect.arrayContaining(['draft'])
    );
  });
});

describe('POST /api/stores/:id/create-payment-order', () => {
  let pool, app, token;

  beforeEach(() => {
    pool = makeMockPool([fixtures.plan]);
    app = buildApp(pool);
    token = makeToken({ tenantId: 1 });
  });

  test('returns 400 if planId missing', async () => {
    const res = await request(app)
      .post('/api/stores/1/create-payment-order')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 for invalid plan', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // plan not found
    const res = await request(app)
      .post('/api/stores/1/create-payment-order')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: 999 });
    expect(res.status).toBe(404);
  });

  test('returns paymentSessionId and orderId on success', async () => {
    const res = await request(app)
      .post('/api/stores/1/create-payment-order')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: 1 });
    expect(res.status).toBe(200);
    expect(res.body.paymentSessionId).toBeDefined();
    expect(res.body.orderId).toMatch(/^store_1_\d+$/);
  });

  test('saves pending_payment with correct store_id and plan_id', async () => {
    await request(app)
      .post('/api/stores/1/create-payment-order')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: 1 });

    const insertCall = pool._mockQuery.mock.calls.find(c =>
      c[0].includes('INSERT INTO pending_payments')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('1');   // store_id
    expect(insertCall[1]).toContain('pending');
  });
});

describe('PATCH /api/admin/stores/:id/status (super admin store control)', () => {
  let pool, app, adminToken, tenantToken;

  beforeEach(() => {
    pool = makeMockPool([fixtures.store]);
    app = buildApp(pool);
    adminToken = makeAdminToken();
    tenantToken = makeToken({ tenantId: 1 });
  });

  test('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .patch('/api/admin/stores/1/status')
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({ status: 'suspended' });
    expect(res.status).toBe(403);
  });

  test('returns 400 for invalid status value', async () => {
    const res = await request(app)
      .patch('/api/admin/stores/1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'hacked' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be one of/i);
  });

  test.each(['draft', 'published', 'suspended', 'inactive'])(
    'allows admin to set status to "%s"', async (status) => {
      pool._mockQuery.mockResolvedValueOnce({
        rows: [{ ...fixtures.store, status }], rowCount: 1
      });
      const res = await request(app)
        .patch('/api/admin/stores/1/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status, reason: 'test reason' });
      expect(res.status).toBe(200);
      expect(res.body.store.status).toBe(status);
    }
  );
});

describe('GET /api/public/store/:subdomain (storefront public access)', () => {
  let pool, app;

  beforeEach(() => {
    pool = makeMockPool([fixtures.publishedStore]);
    app = buildApp(pool);
  });

  test('returns 404 for unknown subdomain', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/public/store/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('returns 404 for draft store (not published)', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // WHERE status='published' filters it out
    const res = await request(app).get('/api/public/store/test-store');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not published/i);
  });

  test('returns store config for published store — no auth required', async () => {
    const res = await request(app).get('/api/public/store/live-store');
    expect(res.status).toBe(200);
    expect(res.body.store.status).toBe('published');
    // No Authorization header needed
  });
});
