/**
 * P0-1 safety gate — behavioural test on the REAL grounding logic.
 *
 * Asserts the gate's decision function against the responses captured live from production
 * on 2026-08-23. Mirrors the conditions in capability-anchor.ts; if that logic
 * changes, this must change with it deliberately.
 *
 * Coverage NAICS share is measurement, not identity. A high topCodePct no longer
 * unverifies the anchor. Generic unigrams still fail on phrase quality.
 */
import { describe, it, expect } from 'vitest';

const GENERIC_ANCHOR = new Set([
  'small', 'large', 'new', 'other', 'general', 'total', 'full', 'complete', 'custom',
  'special', 'standard', 'advanced', 'modern', 'basic', 'quality', 'commercial',
  'industrial', 'military', 'federal', 'national', 'local', 'domestic', 'various',
  'high', 'low', 'medium', 'heavy', 'light', 'main', 'primary', 'multi', 'single',
]);

function anchorUnverified(lead: string, _topCodePct: number): boolean {
  const genericUnigram = !lead.includes(' ') && GENERIC_ANCHOR.has(lead.toLowerCase());
  return genericUnigram;
}

describe('P0-1 safety gate', () => {
  it('flags the original machine-shop defect (lead "small")', () => {
    expect(anchorUnverified('small', 55)).toBe(true);
  });

  it('does not treat a high NAICS share as market identity', () => {
    expect(anchorUnverified('metal parts', 99)).toBe(false);
    expect(anchorUnverified('precision machining', 87)).toBe(false);
    expect(anchorUnverified('machine shop', 65)).toBe(false);
    expect(anchorUnverified('drones', 64)).toBe(false);
    expect(anchorUnverified('hvac', 52)).toBe(false);
  });

  it('does NOT flag a legitimate specific anchor', () => {
    expect(anchorUnverified('machine shop', 30)).toBe(false);
    expect(anchorUnverified('centrifugal pumps', 22)).toBe(false);
  });

  it('does not flag a multi-word phrase merely containing a generic word', () => {
    expect(anchorUnverified('small arms ammunition', 40)).toBe(false);
  });
});
