import { describe, it, expect } from 'vitest';
import { extractApiKey } from './auth';

describe('extractApiKey', () => {
  it('reads a Bearer token (case-insensitive scheme, trimmed)', () => {
    expect(extractApiKey({ authorization: 'Bearer mcp_live_abc' })).toBe('mcp_live_abc');
    expect(extractApiKey({ authorization: 'bearer   mcp_live_x ' })).toBe('mcp_live_x');
  });

  it('falls back to X-Mindy-API-Key', () => {
    expect(extractApiKey({ xMindyApiKey: 'mcp_live_zzz' })).toBe('mcp_live_zzz');
  });

  it('prefers Bearer over the direct header when both present', () => {
    expect(extractApiKey({ authorization: 'Bearer a', xMindyApiKey: 'b' })).toBe('a');
  });

  it('returns null when absent or malformed', () => {
    expect(extractApiKey({})).toBeNull();
    expect(extractApiKey({ authorization: 'Bearer ' })).toBeNull();
    expect(extractApiKey({ authorization: 'Basic xyz' })).toBeNull();
    expect(extractApiKey({ xMindyApiKey: '   ' })).toBeNull();
  });
});
