import { describe, it, expect } from 'vitest';
import { selectRelevantRfp } from './select-relevant';

const filler = (n: number) => Array.from({ length: n }, () => 'Our story: general company history and values.').join('\n\n');

describe('selectRelevantRfp', () => {
  it('short text comes back whole', () => {
    expect(selectRelevantRfp('short', 'q', 100)).toBe('short');
  });

  it('a relevant passage late in a long text is kept (budget filled by rank, not by position)', () => {
    const text = `${filler(400)}\n\nBay Pines VA janitorial past performance 2019-2024.\n\n${filler(400)}`;
    const out = selectRelevantRfp(text, 'Bay Pines VA janitorial past performance', 6_000);
    expect(out.length).toBeLessThanOrEqual(6_000 + 20);
    expect(out).toContain('Bay Pines VA janitorial past performance');
    expect(out.startsWith('Our story')).toBe(true); // the first window (cover / summary) is still kept
  });

  it('kept windows read in document order', () => {
    const text = `${filler(100)}\n\nALPHA pricing value deadline.\n\n${filler(100)}\n\nOMEGA pricing value deadline.\n\n${filler(100)}`;
    const out = selectRelevantRfp(text, 'pricing value deadline', 9_000);
    expect(out.indexOf('ALPHA')).toBeLessThan(out.indexOf('OMEGA'));
  });
});
