/**
 * Tests: /api/webhooks/cashfree
 * Covers: signature verify, order ID parsing, DB transaction, store publish
 * This is the most critical path — payment success must always publish the store.
 */

const request = require('supertest');
const express = require('express');
const { makeMockPool, makeMockGateway, fixtures } = require('./helpers');

// ─── App Factory ──────────────────────────────────────────────────────────────

function buildApp(pool, gateway) {
  const app = express();
  app.use(express.json());

  app.post('/api/webhooks/cashfree', async (req, res) => {
    try {
      // 1. Verify signature
      const isValid = gateway.verifyWebhookSignature(req.body, req.headers, 'secret', 'cashfree');
      if (!isValid) return res.status(400).json({ error: 'Invalid signature' });

      // 2. Parse event
      const event = gateway.parseWebhookEvent(req.body, 'cashfree');
      if (event.status !== 'SUCCESS') return res.status(200).json({ received: true });

      // 3. Parse store ID from order ID  e.g. "store_54_1788235369023"
      const match = event.orderId.match(/^store_(\d+)_/);
      if (!match) return res.status(200).json({ received: true, skipped: 'bad_order_id' });
      const storeId = parseInt(match[1]);

      // 4. Find pending payment
      const pendingResult = await pool.query(
        `SELECT * FROM pending_payments WHERE store_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`,
        [storeId]
      );
      if (!pendingResult.rows.length) {
        return res.status(200).json({ received: true, skipped: 'no_pending_payment' });
      }
      const pending = pendingResult.rows[0];

      // 5. Run transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE pending_payments SET status='completed', transaction_id=$1, completed_at=NOW() WHERE id=$2`,
          [event.transactionId, pending.id]
        );
        await client.query(
          `INSERT INTO store_subscriptions (store_id,plan_id,status,started_at,amount_paid)
           VALUES ($1,$2,'active',NOW(),$3)
           ON CONFLICT (store_id) DO UPDATE SET status='active', started_at=NOW(), amount_paid=$3`,
          [storeId, pending.plan_id, event.amount]
        );
        await client.query(`UPDATE stores SET status='published' WHERE id=$1`, [storeId]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return res.status(200).json({ success: true, storeId });
    } catch (err) {
      console.error('[Webhook]', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/cashfree', () => {
  let pool, gateway, app;

  beforeEach(() => {
    pool = makeMockPool([fixtures.pendingPayment]);
    gateway = makeMockGateway();
    app = buildApp(pool, gateway);
  });

  // ── Signature Verification ──────────────────────────────────────────────────

  test('returns 400 if webhook signature is invalid', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(false);
    const res = await request(app)
      .post('/api/webhooks/cashfree')
      .send({ data: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  test('returns 200 (not 400/500) for non-SUCCESS payment events', async () => {
    gateway.parseWebhookEvent.mockReturnValue({ status: 'FAILED', orderId: 'store_1_123' });
    const res = await request(app)
      .post('/api/webhooks/cashfree')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    // Should NOT update anything
    expect(pool._mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE stores')
    );
  });

  // ── Order ID Parsing ────────────────────────────────────────────────────────

  test('parses store ID correctly from order ID format store_54_TIMESTAMP', async () => {
    gateway.parseWebhookEvent.mockReturnValue({
      status: 'SUCCESS',
      orderId: 'store_54_1788235192372',
      transactionId: 'txn_001',
      amount: 419.4,
    });
    pool._mockQuery.mockResolvedValueOnce({ rows: [{ ...fixtures.pendingPayment, store_id: 54 }], rowCount: 1 });

    const res = await request(app).post('/api/webhooks/cashfree').send({});
    expect(res.status).toBe(200);
    expect(res.body.storeId).toBe(54);
  });

  test('gracefully skips webhook with unrecognised order ID format', async () => {
    gateway.parseWebhookEvent.mockReturnValue({
      status: 'SUCCESS',
      orderId: 'random_order_abc',
      transactionId: 'txn_002',
      amount: 100,
    });
    const res = await request(app).post('/api/webhooks/cashfree').send({});
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe('bad_order_id');
  });

  // ── Happy Path ──────────────────────────────────────────────────────────────

  test('publishes store on successful payment — full happy path', async () => {
    const res = await request(app).post('/api/webhooks/cashfree').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // BEGIN + 3 queries + COMMIT
    expect(pool._mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(pool._mockClient.query).toHaveBeenCalledWith('COMMIT');

    // pending_payment marked completed
    expect(pool._mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE pending_payments'),
      expect.arrayContaining(['txn_test_001', 1])
    );

    // subscription created/updated
    expect(pool._mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO store_subscriptions'),
      expect.anything()
    );

    // store published
    expect(pool._mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE stores SET status='published'"),
      [1]
    );
  });

  test('returns 200 and skips when no pending payment found (idempotency)', async () => {
    pool._mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no pending payment
    const res = await request(app).post('/api/webhooks/cashfree').send({});
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe('no_pending_payment');
    // No DB writes should have happened
    expect(pool._mockClient.query).not.toHaveBeenCalledWith('BEGIN');
  });

  // ── Transaction Safety ──────────────────────────────────────────────────────

  test('rolls back transaction if store update fails', async () => {
    // Make the UPDATE stores query fail
    pool._mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE pending_payments
      .mockResolvedValueOnce({}) // INSERT store_subscriptions
      .mockRejectedValueOnce(new Error('DB constraint error')) // UPDATE stores fails
      .mockResolvedValueOnce({}); // ROLLBACK

    const res = await request(app).post('/api/webhooks/cashfree').send({});
    expect(res.status).toBe(500);
    expect(pool._mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('always calls client.release() even on error', async () => {
    pool._mockClient.query.mockRejectedValueOnce(new Error('Sudden failure'));

    await request(app).post('/api/webhooks/cashfree').send({});
    expect(pool._mockClient.release).toHaveBeenCalled();
  });
});

// ── Real-world scenario: Vijay Rathi's payment ──────────────────────────────
describe('Webhook: Vijay Rathi scenario (store_54_1788235192372)', () => {
  test('correctly identifies store 54 and publishes it', async () => {
    const pool = makeMockPool([{ id: 1, store_id: 54, plan_id: 1, status: 'pending', amount: '419.40' }]);
    const gateway = makeMockGateway({
      parseWebhookEvent: jest.fn().mockReturnValue({
        status: 'SUCCESS',
        orderId: 'store_54_1788235192372',
        transactionId: '6373675994',
        amount: 419.4,
      }),
    });
    const app = buildApp(pool, gateway);

    const res = await request(app)
      .post('/api/webhooks/cashfree')
      .send({ /* Cashfree payload */ });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(54);

    // Verify store 54 was published
    expect(pool._mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE stores SET status='published'"),
      [54]
    );
  });
});
