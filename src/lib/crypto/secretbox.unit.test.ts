/**
 * secretbox: authenticated encryption for stored credentials. The scrypt key is derived once per (secret, salt) per
 * process (it ran on every encrypt and decrypt), and a dedicated key can carry an id written into the ciphertext so
 * it can be rotated later.
 */
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret, secretKeyId } from './secretbox';

const K = { secret: 'unit-test-secret-0123456789abcdef0123', salt: 'unit-salt' };

describe('secretbox', () => {
  it('round-trips; v1 without an id, v2:<id> with one', () => {
    expect(decryptSecret(encryptSecret('hello', K), K)).toBe('hello');
    const v1 = encryptSecret('x', K);
    expect(v1).toMatch(/^v1:/);
    const v2 = encryptSecret('x', { ...K, id: 'k7' });
    expect(v2).toMatch(/^v2:k7:/);
    expect(secretKeyId(v2)).toBe('k7');
    expect(decryptSecret(v2, { ...K, id: 'k7' })).toBe('x');
  });

  it('refuses a ciphertext written under another key id, and a tampered one', () => {
    const v2 = encryptSecret('x', { ...K, id: 'k1' });
    expect(() => decryptSecret(v2, { ...K, id: 'k2' })).toThrow(/another key id/);
    expect(() => decryptSecret(v2, K)).toThrow(/another key id/);
    const parts = v2.split(':');
    parts[4] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'), { ...K, id: 'k1' })).toThrow();
  });

  it('still reads ciphertext written before key ids (v1)', () => {
    const old = encryptSecret('legacy', K);
    expect(decryptSecret(old, { ...K, id: 'k1' })).toBe('legacy');
  });

  it('derives the scrypt key once per (secret, salt), not on every call', () => {
    const spy = vi.spyOn(crypto, 'scryptSync');
    const key = { secret: `memo-${Math.random()}-0123456789abcdef0123`, salt: 'memo-salt' };
    for (let i = 0; i < 5; i++) decryptSecret(encryptSecret(`v${i}`, key), key);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('rejects an unsafe key id', () => {
    expect(() => encryptSecret('x', { ...K, id: 'bad:id' })).toThrow(/invalid key id/);
  });
});
