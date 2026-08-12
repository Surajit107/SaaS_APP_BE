import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Symmetric encryption for secrets the server must be able to read back
 * (e.g. TOTP shared secrets). Passwords and one-time codes must keep using
 * bcrypt — this is only for values that cannot be hashed.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = 'v1';

export class SecretCipherKeyError extends Error {}
export class SecretCipherPayloadError extends Error {}

/**
 * Accepts a base64, base64url, or hex encoded key and validates it decodes to
 * exactly 32 bytes. Generate one with:
 * `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
 */
export function parseEncryptionKey(rawKey: string | undefined): Buffer {
  const trimmed = (rawKey ?? '').trim();
  if (trimmed.length === 0) {
    throw new SecretCipherKeyError('Encryption key is not configured.');
  }

  const decoded = /^[0-9a-fA-F]+$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new SecretCipherKeyError(
      `Encryption key must decode to ${KEY_BYTES} bytes, received ${decoded.length}.`,
    );
  }
  return decoded;
}

/** Returns `v1.<iv>.<authTag>.<ciphertext>` with each segment base64url encoded. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const segments = payload.split('.');
  if (segments.length !== 4 || segments[0] !== FORMAT_VERSION) {
    throw new SecretCipherPayloadError('Malformed encrypted payload.');
  }

  const [, rawIv, rawAuthTag, rawCiphertext] = segments;
  const iv = Buffer.from(rawIv, 'base64url');
  const authTag = Buffer.from(rawAuthTag, 'base64url');
  const ciphertext = Buffer.from(rawCiphertext, 'base64url');

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new SecretCipherPayloadError('Malformed encrypted payload.');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM auth failure: wrong key, or the stored value was tampered with.
    throw new SecretCipherPayloadError(
      'Encrypted payload failed authentication.',
    );
  }
}

/**
 * Deterministic keyed digest, used to store high-entropy single-use codes
 * (recovery codes) so a submitted code can be matched with a single indexed
 * query instead of comparing against every stored hash in turn.
 *
 * Deliberately not bcrypt: bcrypt salts each hash, which would force a slow
 * compare against all ten stored codes. Keying the digest with the server-side
 * encryption key means a database-only leak still cannot be brute-forced.
 * Never use this for passwords, which are low-entropy and need a slow KDF.
 */
export function deriveLookupHash(value: string, key: Buffer): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

/** Constant-time comparison for user-supplied codes of equal expected length. */
export function safeCompareStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
