const crypto = require('crypto');

/**
 * Generate a signed QR token for a product.
 * Token = base64url(JSON({ store_id, product_id, variant_id, sku, price, ts, sig }))
 * Signature covers: store_id|product_id|variant_id|sku|ts
 * Expiry is NOT in the token — it is checked against qr_service_subscriptions in DB.
 */
function generateQRToken({ store_id, product_id, variant_id = '', sku = '', price }) {
  if (!process.env.QR_SECRET) throw new Error('QR_SECRET env variable is not set');

  const ts = Math.floor(Date.now() / 1000);
  const data = `${store_id}|${product_id}|${variant_id}|${sku}|${ts}`;

  const sig = crypto
    .createHmac('sha256', process.env.QR_SECRET)
    .update(data)
    .digest('hex');

  const payload = { store_id, product_id, variant_id, sku, price, ts, sig };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Validate a QR token scanned on the storefront.
 * Returns { valid: true, product_id, variant_id } or { valid: false, reason }
 * Reasons: invalid_token | store_mismatch | invalid_signature
 */
function validateQRToken(token, scanning_store_id) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'invalid_token' };
  }

  const { store_id, product_id, variant_id = '', sku = '', price, ts, sig } = payload;

  // Must be missing required fields
  if (!store_id || !product_id || !ts || !sig) {
    return { valid: false, reason: 'invalid_token' };
  }

  // Cross-store scan protection
  if (String(store_id) !== String(scanning_store_id)) {
    return { valid: false, reason: 'store_mismatch' };
  }

  // Reconstruct and verify signature
  const data = `${store_id}|${product_id}|${variant_id}|${sku}|${ts}`;
  const expected = crypto
    .createHmac('sha256', process.env.QR_SECRET)
    .update(data)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  return { valid: true, product_id, variant_id, sku, price };
}

module.exports = { generateQRToken, validateQRToken };
