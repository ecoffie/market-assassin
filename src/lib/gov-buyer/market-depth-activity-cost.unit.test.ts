import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  ACTIVITY_MAX_BYTES,
  REAL_541512_ACTIVITY_UEIS,
  REAL_541512_PARENT_BATCH_UEIS,
} from './evaluation-bound';
import {
  PARENT_EDGE_BATCH_MAX_BYTES,
  PARENT_EDGE_SINGLE_MAX_BYTES,
} from '@/lib/mrr/corporate-family';

describe('real-UEI activity cost contract', () => {
  it('uses ten distinct real UEIs and a 1 GiB billed-bytes cap', () => {
    const unique = [...new Set(REAL_541512_ACTIVITY_UEIS.map((u) => u.toUpperCase()))];
    expect(unique).toHaveLength(10);
    for (const uei of unique) {
      expect(uei).toMatch(/^[A-Z0-9]{12}$/);
      expect(uei).not.toMatch(/^0+$|^TEST|^SYNTH|^FAKE/);
    }
    expect(ACTIVITY_MAX_BYTES).toBe(1024 * 1024 * 1024);
    const fingerprint = createHash('sha1').update([...unique].sort().join(',')).digest('hex');
    expect(fingerprint).toHaveLength(40);
  });

  it('keeps the activity ceiling at 1 GiB while the parent-edge batch ceiling is 2 GiB', () => {
    expect(ACTIVITY_MAX_BYTES).toBe(1024 * 1024 * 1024);
    expect(PARENT_EDGE_SINGLE_MAX_BYTES).toBe(1024 * 1024 * 1024);
    expect(PARENT_EDGE_BATCH_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(PARENT_EDGE_BATCH_MAX_BYTES).not.toBe(ACTIVITY_MAX_BYTES);
    const parentUeis = [...new Set(REAL_541512_PARENT_BATCH_UEIS.map((u) => u.toUpperCase()))];
    expect(parentUeis).toHaveLength(50);
  });
});
