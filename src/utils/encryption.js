const crypto = require('crypto');

// ✅ AES-256 encryption for Store Admin passwords.
//
// This is deliberately ENCRYPTION (reversible), not HASHING (one-way).
// Hashing is correct for the tenant's own OTP-based login, where we only
// ever need to verify a value, never see it again. Here the tenant needs
// to view/copy the current Store Admin password anytime from their
// dashboard, so it must be reversible — but it must never sit in the
// database as plain readable text. A raw database leak should expose only
// unreadable encrypted noise, not usable passwords.
//
// The key lives in an environment variable (STORE_ADMIN_PASSWORD_KEY),
// never in the database, never in source control. It must be a 64-character
// hex string (32 bytes) for AES-256. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const ALGORITHM = 'aes-256-cbc';

function getKey() {
    const key = process.env.STORE_ADMIN_PASSWORD_KEY;
    if (!key || key.length !== 64) {
        throw new Error(
            'STORE_ADMIN_PASSWORD_KEY is missing or invalid. Set it in .env to a ' +
            '64-character hex string (32 bytes). Generate one with: ' +
            'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }
    return Buffer.from(key, 'hex');
}

function encrypt(plainText) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // IV is stored alongside the ciphertext (not secret, but must be unique
    // per encryption and available to decrypt) — standard practice.
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
    const [ivHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !encrypted) {
        throw new Error('Malformed encrypted value');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Generates a random alphanumeric password. Excludes visually ambiguous
// characters (0/O, 1/l/I) so it's easy to read aloud or copy correctly.
function generatePassword(length = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars[crypto.randomInt(chars.length)];
    }
    return password;
}

module.exports = { encrypt, decrypt, generatePassword };
