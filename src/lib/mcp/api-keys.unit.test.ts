import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey } from './api-keys';

describe('mcp api-keys — pure crypto logic', () => {
  it('hashApiKey is deterministic sha256 hex (64 chars)', () => {
    const h1 = hashApiKey('mcp_live_abc');
    const h2 = hashApiKey('mcp_live_abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs hash differently', () => {
    expect(hashApiKey('mcp_live_a')).not.toBe(hashApiKey('mcp_live_b'));
  });

  it('generateApiKey mints a prefixed key whose hash matches, with a display prefix', () => {
    const { key, keyHash, keyPrefix } = generateApiKey();
    expect(key).toMatch(/^mcp_live_[0-9a-f]{64}$/); // prefix + 32 bytes hex
    expect(keyHash).toBe(hashApiKey(key)); // stored hash verifies the plaintext
    expect(key.startsWith(keyPrefix)).toBe(true); // prefix is a real leading slice
    expect(keyPrefix).toMatch(/^mcp_live_[0-9a-f]{6}$/); // short, non-secret display id
    expect(keyPrefix.length).toBeLessThan(key.length); // never the full secret
  });

  it('every generated key is unique (entropy sanity)', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
    expect(keys.size).toBe(200);
  });
});
