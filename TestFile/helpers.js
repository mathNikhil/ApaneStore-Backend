/**
 * Test helpers for AapnaEstore
 * Provides: JWT factory, mock DB pool, mock gateway, request builder
 */

const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-secret-do-not-use-in-production';

// ─── JWT Factory ────────────────────────────────────────────────────────────

function makeToken(payload = {}) {
  const defaults = { tenantId: 1, mobile: '9999999999', role: 'tenant' };
  return jwt.sign({ ...defaults, ...payload }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

function makeAdminToken() {
  return jwt.sign({ adminId: 1, role: 'super_admin' }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

// ─── Mock DB Pool ────────────────────────────────────────────────────────────
// Returns a jest mock that behaves like pg.Pool
// Each test can configure what .query() returns via mockResolvedValueOnce

function makeMockPool(defaultRows = []) {
  const mockQuery = jest.fn().mockResolvedValue({ rows: defaultRows, rowCount: defaultRows.length });
  const mockClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  const mockConnect = jest.fn().mockResolvedValue(mockClient);

  return {
    query: mockQuery,
    connect: mockConnect,
    // Expose for assertions
    _mockQuery: mockQuery,
    _mockClient: mockClient,
    _mockConnect: mockConnect,
  };
}

// ─── Mock Payment Gateway ─────────────────────────────────────────────────────

function makeMockGateway(overrides = {}) {
  return {
    isTestTenant: jest.fn().mockReturnValue(false),
    isEnabled: jest.fn().mockResolvedValue(true),
    createOrder: jest.fn().mockResolvedValue({
      payment_session_id: 'test_session_abc123',
      order_id: 'store_1_1234567890',
    }),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    parseWebhookEvent: jest.fn().mockReturnValue({
      status: 'SUCCESS',
      orderId: 'store_1_1234567890',
      transactionId: 'txn_test_001',
      amount: 419.4,
    }),
    ...overrides,
  };
}

// ─── Fixture Data ─────────────────────────────────────────────────────────────

const fixtures = {
  tenant: {
    id: 1,
    mobile: '9999999999',
    email: 'test@example.com',
    business_name: 'Test Store',
    business_type: 'retail',
    full_name: 'Test Owner',
  },
  store: {
    id: 1,
    tenant_id: 1,
    subdomain: 'test-store',
    status: 'draft',
    config: JSON.stringify({ brand: { name: 'Test Store' } }),
  },
  publishedStore: {
    id: 2,
    tenant_id: 1,
    subdomain: 'live-store',
    status: 'published',
    config: JSON.stringify({ brand: { name: 'Live Store' } }),
  },
  plan: {
    id: 1,
    name: 'Starter',
    price: '419.00',
    billing_cycle: 'monthly',
  },
  pendingPayment: {
    id: 1,
    store_id: 1,
    plan_id: 1,
    order_id: 'store_1_1234567890',
    amount: '419.40',
    status: 'pending',
  },
};

// Test mobile numbers that bypass payment (from doc)
const TEST_MOBILES = ['5555555555', '6666666666', '7777777777'];

module.exports = {
  makeToken,
  makeAdminToken,
  makeMockPool,
  makeMockGateway,
  fixtures,
  TEST_MOBILES,
  TEST_JWT_SECRET,
};
