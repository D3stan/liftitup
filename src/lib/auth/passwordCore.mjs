import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}

/**
 * Hashes a password with Node's scrypt and a per-user 16-byte random salt.
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

/**
 * Constant-time password verification against a stored `scrypt:<salt>:<hash>` string.
 */
export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash ?? '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (expectedBuf.length !== SCRYPT_KEYLEN) return false;

  const derived = await scryptAsync(password, salt);
  if (derived.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(derived, expectedBuf);
}
