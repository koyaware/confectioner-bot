import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, hash, generateClaimCode } from '../src/lib/crypto.js';

describe('crypto', () => {
  const secret = 'a'.repeat(32);

  describe('encrypt/decrypt', () => {
    it('encrypts and decrypts text correctly', () => {
      const plaintext = 'Hello, world!';
      const encrypted = encrypt(plaintext, secret);
      const decrypted = decrypt(encrypted, secret);

      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for same plaintext', () => {
      const plaintext = 'Hello, world!';
      const encrypted1 = encrypt(plaintext, secret);
      const encrypted2 = encrypt(plaintext, secret);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decrypt(encrypted1, secret)).toBe(plaintext);
      expect(decrypt(encrypted2, secret)).toBe(plaintext);
    });

    it('encrypts bot tokens', () => {
      const token = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';
      const encrypted = encrypt(token, secret);

      expect(encrypted).not.toContain(token);
      expect(decrypt(encrypted, secret)).toBe(token);
    });

    it('handles unicode text', () => {
      const plaintext = '🎂 торт с надписью "С днём рождения!"';
      const encrypted = encrypt(plaintext, secret);
      const decrypted = decrypt(encrypted, secret);

      expect(decrypted).toBe(plaintext);
    });

    it('throws on wrong secret', () => {
      const plaintext = 'secret data';
      const encrypted = encrypt(plaintext, secret);

      expect(() => decrypt(encrypted, 'wrong' + secret.slice(5))).toThrow();
    });

    it('throws on tampered ciphertext', () => {
      const plaintext = 'secret data';
      const encrypted = encrypt(plaintext, secret);
      const tampered = encrypted.slice(0, -4) + 'XXXX';

      expect(() => decrypt(tampered, secret)).toThrow();
    });
  });

  describe('hash', () => {
    it('produces consistent hash', () => {
      const value = 'claim_12345';
      const hash1 = hash(value);
      const hash2 = hash(value);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hash('claim_12345');
      const hash2 = hash('claim_12346');

      expect(hash1).not.toBe(hash2);
    });

    it('is one-way', () => {
      const value = 'claim_secret';
      const hashed = hash(value);

      expect(hashed).not.toContain(value);
    });
  });

  describe('generateClaimCode', () => {
    it('generates random claim codes', () => {
      const code1 = generateClaimCode();
      const code2 = generateClaimCode();

      expect(code1).not.toBe(code2);
      expect(code1.length).toBeGreaterThan(20);
      expect(code2.length).toBeGreaterThan(20);
    });

    it('generates URL-safe codes', () => {
      const code = generateClaimCode();

      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
