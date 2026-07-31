import { describe, it, expect } from 'vitest';
import { eligibleSetAsides } from '@/lib/vault/certifications';

/**
 * The PostgREST clause the query builds. Kept as a pure function here so the
 * NULL-inclusion contract is locked by a test rather than by a comment.
 */
function buildClause(elig: string[]): string | null {
  const list = (elig || []).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return null;
  const inList = list.map((s) => `"${s.replace(/"/g, '')}"`).join(',');
  return `set_aside_enriched.in.(${inList}),set_aside_enriched.is.null`;
}

describe('eligibility filter — unknown must never mean ineligible', () => {
  it('ALWAYS includes the is.null branch', () => {
    const c = buildClause(['8(a)', 'WOSB']);
    expect(c).toContain('set_aside_enriched.is.null');
  });

  it('is a no-op when the caller has no certs (never silently narrows)', () => {
    expect(buildClause([])).toBeNull();
    expect(buildClause(undefined as unknown as string[])).toBeNull();
  });

  it('quotes values so "8(a)" and "Full & Open" survive the IN list', () => {
    const c = buildClause(['8(a)', 'Full & Open']);
    expect(c).toContain('"8(a)"');
    expect(c).toContain('"Full & Open"');
  });

  it('strips embedded quotes rather than breaking the filter grammar', () => {
    expect(buildClause(['bad"value'])).toContain('"badvalue"');
  });
});

describe('vault certs -> filter, end to end', () => {
  it('an 8(a) firm gets 8(a) + SB-Total + Full & Open', () => {
    const elig = eligibleSetAsides(['8(a)']);
    expect(elig).toContain('8(a)');
    expect(elig).toContain('SB-Total');
    expect(elig).toContain('Full & Open');
    expect(buildClause(elig)).toContain('is.null');
  });

  it('a firm with only ISO/FCL gets Full & Open only — no set-aside claimed', () => {
    const elig = eligibleSetAsides(['ISO 27001', 'FCL']);
    expect(elig).toEqual(['Full & Open']);
  });

  it('state MWBE does not buy a federal set-aside lane', () => {
    expect(eligibleSetAsides(['MBE', 'WBE'])).toEqual(['Full & Open']);
  });
});
