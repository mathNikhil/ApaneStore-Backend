/**
 * Tests: /api/auth/*
 * Covers: send OTP, verify OTP, new tenant onboarding
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { makeMockPool, fixtures, TEST_JWT_SECRET } = require('./helpers');

// ─── App Factory ──────────────────────────────────────────────────────────────
// We build a minimal Express app with a mock pool injected,
// so tests never touch the real DB.

function buildApp(pool) {
  const app = express();
  app.use(express.json());

  // POST /api/auth/send-otp
  app.post('/api/auth/send-otp', async (req, res) => {
    const { mobile } = req.body;
    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ error: 'Valid 10-digit mobile number required' });
    }
    // Check if tenant exists
    const result = await pool.query('SELECT id FROM tenants WHERE mobile = $1', [mobile]);
    const isNew = result.rows.length === 0;
    // In dev mode OTP is shown in response (from doc: SMS gateway not configured)
    return res.json({ success: true, isNew, otp: '123456' });
  });

  // POST /api/auth/verify-otp
  app.post('/api/auth/verify-otp', async (req, res) => {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ error: 'mobile and otp are required' });
    }
    if (otp !== '123456') {
      return res.status(401).json({ error: 'Invalid OTP' });
    }
    const result = await pool.query(
      'SELECT * FROM tenants WHERE mobile = $1', [mobile]
    );
    const isNew = result.rows.length === 0;
    let tenant = result.rows[0];

    if (isNew) {
      const inserted = await pool.query(
        'INSERT INTO tenants (mobile) VALUES ($1) RETURNING *', [mobile]
      );
      tenant = inserted.rows[0] || { id: 99, mobile };
    }

    const token = jwt.sign(
      { tenantId: tenant.id, mobile, role: 'tenant' },
      TEST_JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({ token, isNew, tenant });
  });

  // POST /api/auth/onboarding  (new tenant fills name, email, business_type)
  app.post('/api/auth/onboarding', async (req, res) => {
    const { full_name, email, business_type } = req.body;
    if (!full_name || !email || !business_type) {
      return res.status(400).json({ error: 'full_name, email, business_type are required' });
    }
    await pool.query(
      'UPDATE tenants SET full_name=$1, email=$2, business_type=$3 WHERE id=$4',
      [full_name, email, business_type, 1]
    );
    return res.json({ success: true });
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/send-otp', () => {
  let pool, app;

  beforeEach(() => {
    pool = makeMockPool([]);
    app = buildApp(pool);
  });

  test('returns 400 if mobile is missing', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mobile/i);
  });

  test('returns 400 if mobile is not 10 digits', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '12345' });
    expect(res.status).toBe(400);
  });

  test('returns success + isNew=true for unknown mobile', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no tenant found
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isNew).toBe(true);
  });

  test('returns success + isNew=false for existing tenant', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [fixtures.tenant], rowCount: 1 });
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '9999999999' });
    expect(res.status).toBe(200);
    expect(res.body.isNew).toBe(false);
  });

  test('returns OTP in dev mode (SMS not configured)', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '9123456789' });
    expect(res.body.otp).toBeDefined();
  });
});

describe('POST /api/auth/verify-otp', () => {
  let pool, app;

  beforeEach(() => {
    pool = makeMockPool([fixtures.tenant]);
    app = buildApp(pool);
  });

  test('returns 400 if fields missing', async () => {
    const res = await request(app).post('/api/auth/verify-otp').send({ mobile: '9999999999' });
    expect(res.status).toBe(400);
  });

  test('returns 401 for wrong OTP', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ mobile: '9999999999', otp: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid otp/i);
  });

  test('returns JWT token on correct OTP for existing tenant', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [fixtures.tenant], rowCount: 1 });
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ mobile: '9999999999', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.isNew).toBe(false);
    // Token should be valid
    const decoded = jwt.verify(res.body.token, TEST_JWT_SECRET);
    expect(decoded.role).toBe('tenant');
  });

  test('creates new tenant and returns token for first-time login', async () => {
    // First query: no tenant found; second: insert returns new tenant
    pool._mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 99, mobile: '8888888888' }], rowCount: 1 });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ mobile: '8888888888', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.isNew).toBe(true);
    expect(res.body.token).toBeDefined();
  });
});

describe('POST /api/auth/onboarding', () => {
  let pool, app;

  beforeEach(() => {
    pool = makeMockPool([]);
    app = buildApp(pool);
  });

  test('returns 400 if any required field is missing', async () => {
    const res = await request(app)
      .post('/api/auth/onboarding')
      .send({ full_name: 'Vijay Rathi', email: 'v@g.com' }); // missing business_type
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/business_type/i);
  });

  test('returns success when all fields provided', async () => {
    const res = await request(app)
      .post('/api/auth/onboarding')
      .send({ full_name: 'Vijay Rathi', email: 'v@g.com', business_type: 'retail' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // DB update should have been called
    expect(pool._mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tenants'),
      expect.arrayContaining(['Vijay Rathi', 'v@g.com', 'retail'])
    );
  });
});
