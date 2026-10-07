import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from APP_SECRET
 */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a string using AES-256-GCM
 * Returns: base64(iv + encrypted + authTag)
 */
export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Concatenate: iv + encrypted + tag
  const result = Buffer.concat([iv, encrypted, tag]);
  return result.toString('base64');
}

/**
 * Decrypts a string encrypted with encrypt()
 */
export function decrypt(ciphertext: string, secret: string): string {
  const key = deriveKey(secret);
  const buffer = Buffer.from(ciphertext, 'base64');

  // Extract: iv + encrypted + tag
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(buffer.length - TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH, buffer.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Hashes a string using SHA-256 (for claim codes)
 */
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Generates a random string suitable for claim codes
 */
export function generateClaimCode(): string {
  return randomBytes(16).toString('base64url');
}
