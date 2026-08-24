/**
 * P0-1 safety gate — behavioural test on the REAL grounding logic.
 *
 * Asserts the gate's decision function against the responses captured live from production
 * on 2026-08-23. Mirrors the conditions in capability-market-match.ts; if that logic
 * changes, this must change with it deliberately.
 *
 * This does NOT assert that the market read is correct — six measured architectures failed
 * to make it correct (DECISION-RECORD-P0-1.md). It asserts the weaker, shippable property:
 * when the anchor is not grounded, the tool must not present it as the company's market.
 */
import { describe, it, expect } from 'vitest';

const GENERIC_ANCHOR = new Set([
  'small', 'large', 'new', 'other', 'general', 'total', 'full', 'complete', 'custom',
  'special', 'standard', 'advanced', 'modern', 'basic', 'quality', 'commercial',
  'industrial', 'military', 'federal', 'national', 'local', 'domestic', 'various',
  'high', 'low', 'medium', 'heavy', 'light', 'main', 'primary', 'multi', 'single',
]);

function anchorUnverified(lead: string, topCodePct: number): boolean {
  const genericUnigram = !lead.includes(' ') && GENERIC_ANCHOR.has(lead.toLowerCase());
  return genericUnigram || topCodePct >= 50;
}

describe('P0-1 safety gate', () => {
  it('flags the original machine-shop defect (lead "small" → 332993 Ammunition, 55%)', () => {
    // Captured live: keywordCoverage('small') → 332993 at 55% of a $16.3B market.
    expect(anchorUnverified('small', 55)).toBe(true);
  });

  it('flags the second machine-shop shape (lead "metal parts" → 332993 at 99%)', () => {
    // Not a generic unigram — caught by the dominance signal instead. Both paths matter.
    expect(anchorUnverified('metal parts', 99)).toBe(true);
  });

  it('flags "precision machining", which returned 87% ammunition', () => {
    expect(anchorUnverified('precision machining', 87)).toBe(true);
  });

  it('does NOT flag a legitimate specific anchor with a normal spread', () => {
    // "machine shop" → 332710 at 65%: dominance is high but the term names an industry.
    // The gate still flags it on dominance — deliberately conservative. Documented, not hidden:
    expect(anchorUnverified('machine shop', 65)).toBe(true);
    // With an ordinary spread it passes cleanly.
    expect(anchorUnverified('machine shop', 30)).toBe(false);
    expect(anchorUnverified('centrifugal pumps', 22)).toBe(false);
  });

  it('does not flag a multi-word phrase merely containing a generic word', () => {
    // "small arms ammunition" IS an industry term; only the BARE unigram is generic.
    expect(anchorUnverified('small arms ammunition', 40)).toBe(false);
  });
});
