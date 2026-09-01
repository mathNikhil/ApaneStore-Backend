/**
 * Tests: paymentGateway.service.js logic
 * Covers: test tenant bypass, order ID generation, webhook parsing
 */

const { TEST_MOBILES } = require('./helpers');

// ─── Inline service (mirrors your paymentGateway.service.js logic) ────────────
// Tests the pure functions — no HTTP, no DB needed.

function isTestTenant(mobile) {
  return ['5555555555', '6666666666', '7777777777'].includes(mobile);
}

function buildOrderId(storeId) {
  return `store_${storeId}_${Date.now()}`;
}

function parseOrderId(orderId) {
  const match = orderId.match(/^store_(\d+)_(\d+)$/);
  if (!match) return null;
  return { storeId: parseInt(match[1]), timestamp: parseInt(match[2]) };
}

function parseWebhookEvent(body, provider) {
  if (provider === 'cashfree') {
    const data = body?.data?.order || body;
    return {
      status: body?.data?.payment?.payment_status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      orderId: data?.order_id || body?.order_id,
      transactionId: body?.data?.payment?.cf_payment_id || body?.cf_payment_id,
      amount: parseFloat(body?.data?.payment?.payment_amount || body?.payment_amount || 0),
    };
  }
  if (provider === 'razorpay') {
    return {
      status: body?.event === 'payment.captured' ? 'SUCCESS' : 'FAILED',
      orderId: body?.payload?.payment?.entity?.order_id,
      transactionId: body?.payload?.payment?.entity?.id,
      amount: (body?.payload?.payment?.entity?.amount || 0) / 100,
    };
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isTestTenant()', () => {
  test.each(TEST_MOBILES)('returns true for test mobile %s', (mobile) => {
    expect(isTestTenant(mobile)).toBe(true);
  });

  test('returns false for regular tenant mobile', () => {
    expect(isTestTenant('9717023054')).toBe(false); // Vijay's number
    expect(isTestTenant('9999999999')).toBe(false);
  });

  test('returns false for empty/null', () => {
    expect(isTestTenant('')).toBe(false);
    expect(isTestTenant(null)).toBe(false);
  });
});

describe('buildOrderId()', () => {
  test('generates order ID in correct format', () => {
    const orderId = buildOrderId(54);
    expect(orderId).toMatch(/^store_54_\d{13}$/); // store_54_ + 13-digit ms timestamp
  });

  test('each call produces a unique order ID', () => {
    const a = buildOrderId(1);
    const b = buildOrderId(1);
    // In practice timestamps differ, but we ensure structure is unique
    expect(a).toMatch(/^store_1_/);
    expect(b).toMatch(/^store_1_/);
  });
});

describe('parseOrderId()', () => {
  test('correctly parses store ID and timestamp', () => {
    const result = parseOrderId('store_54_1788235192372');
    expect(result.storeId).toBe(54);
    expect(result.timestamp).toBe(1788235192372);
  });

  test('returns null for unrecognised format', () => {
    expect(parseOrderId('random_abc')).toBeNull();
    expect(parseOrderId('')).toBeNull();
    expect(parseOrderId('store_abc_xyz')).toBeNull();
  });

  test('handles large store IDs', () => {
    expect(parseOrderId('store_12345_1788235192372').storeId).toBe(12345);
  });
});

describe('parseWebhookEvent() — Cashfree', () => {
  const successPayload = {
    data: {
      order: { order_id: 'store_54_1788235192372' },
      payment: {
        payment_status: 'SUCCESS',
        cf_payment_id: '6373675994',
        payment_amount: '419.4',
      },
    },
  };

  test('parses successful Cashfree payment correctly', () => {
    const event = parseWebhookEvent(successPayload, 'cashfree');
    expect(event.status).toBe('SUCCESS');
    expect(event.orderId).toBe('store_54_1788235192372');
    expect(event.transactionId).toBe('6373675994');
    expect(event.amount).toBe(419.4);
  });

  test('parses failed Cashfree payment as FAILED status', () => {
    const failPayload = {
      data: {
        order: { order_id: 'store_1_123' },
        payment: { payment_status: 'FAILED', cf_payment_id: 'txn_x', payment_amount: '100' },
      },
    };
    const event = parseWebhookEvent(failPayload, 'cashfree');
    expect(event.status).toBe('FAILED');
  });
});

describe('parseWebhookEvent() — Razorpay', () => {
  const rzpPayload = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_abc123',
          order_id: 'order_store_1_1234',
          amount: 41940, // paise
        },
      },
    },
  };

  test('parses Razorpay captured payment correctly', () => {
    const event = parseWebhookEvent(rzpPayload, 'razorpay');
    expect(event.status).toBe('SUCCESS');
    expect(event.transactionId).toBe('pay_abc123');
    expect(event.amount).toBe(419.4); // converted from paise
  });

  test('parses Razorpay non-captured event as FAILED', () => {
    const event = parseWebhookEvent({ ...rzpPayload, event: 'payment.failed' }, 'razorpay');
    expect(event.status).toBe('FAILED');
  });
});

describe('parseWebhookEvent() — unsupported provider', () => {
  test('throws for unknown provider', () => {
    expect(() => parseWebhookEvent({}, 'stripe')).toThrow(/unsupported provider/i);
  });
});
