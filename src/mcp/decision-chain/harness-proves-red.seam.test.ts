/**
 * Task 0 self-check: PROVE THE HARNESS CAN FAIL.
 *
 * A harness whose stubs accidentally remove the production conditions responsible for a bug
 * will pass on day one and prove nothing. So before any defect is fixed, we assert that the
 * assertions used by the decision-chain tests actually go RED against the observed-broken
 * responses captured live on 2026-08-23.
 *
 * These are the REAL shapes returned by production, verbatim from the PRD reproductions.
 * Each block asserts: "given what production returned, the acceptance criterion FAILS."
 *
 * When a defect is fixed, its live test flips red → green. THIS file stays green throughout —
 * it is testing the assertions, not the product.
 */
import { describe, it, expect } from 'vitest';

describe('harness self-check — the acceptance criteria reject the observed-broken responses', () => {
  it('P0-1 · the 332710 assertion rejects the Ammunition response', () => {
    // Observed live: lead keyword "small" → 332993, 55% of a $16.3B market.
    const observed = {
      market: {
        lead_keyword: 'small',
        top_naics: [
          { code: '332993', name: 'Ammunition (except Small Arms) Manufacturing' },
          { code: '332994', name: 'Small Arms, Ordnance, and Ordnance Accessories Manufacturing' },
          { code: '332992', name: 'Small Arms Ammunition Manufacturing' },
        ],
      },
      _meta: { lead_naics: '332993' },
    };
    const codes = observed.market.top_naics.map((n) => n.code);

    expect(() => expect(codes).toContain('332710')).toThrow();
    expect(() => expect(observed.market.lead_keyword).not.toBe('small')).toThrow();
    expect(() => expect(['332993', '333244']).not.toContain(observed._meta.lead_naics)).toThrow();
  });

  it('P0-1 · the same assertion also rejects the Printing Machinery response', () => {
    // Observed live after removing "small": anchored on "made-to-print" → 333244.
    const observed = {
      market: {
        lead_keyword: 'milling fabrication made-to-print',
        top_naics: [{ code: '333244', name: 'Printing Machinery and Equipment Manufacturing' }],
      },
      _meta: { lead_naics: '333244' },
    };
    expect(() => expect(observed.market.top_naics.map((n) => n.code)).toContain('332710')).toThrow();
    expect(() => expect(['332993', '333244']).not.toContain(observed._meta.lead_naics)).toThrow();
  });

  it('P0-2 · the non-empty assertion rejects a populated header on empty bodies', () => {
    // Observed live: found:true, 1278 awards, both arrays empty.
    const observed = {
      found: true,
      company: { name: 'FLUIDYNE CORPORATION', uei: 'RG3VUTDYFNF8', award_count: 1278 },
      top_agencies: [] as unknown[],
      recent_awards: [] as unknown[],
    };
    expect(observed.company.award_count).toBeGreaterThan(0); // premise holds
    expect(() => expect(observed.top_agencies.length).toBeGreaterThan(0)).toThrow();
    expect(() => expect(observed.recent_awards.length).toBeGreaterThan(0)).toThrow();
  });

  it('P0-3 · the reconciliation rejects capable_depth 0 against a real population', () => {
    // Observed live: capable_depth 0 for 561720 Small Business.
    const depth = { _meta: { capable_depth: 0 } };
    // Authoritative population, same scope, FY2025 (PRD repro):
    const performers = new Set([
      'TLS JOINT VENTURE LLC', 'DYNAMIC-HHS JV, LLC', 'TITAN FACILITY SERVICES LLC',
    ]);
    expect(performers.size).toBeGreaterThanOrEqual(2); // premise holds
    expect(() => expect(depth._meta.capable_depth).toBeGreaterThanOrEqual(2)).toThrow();
  });

  it('P1-1 · the round-trip assertion rejects an unresolved emitted name', () => {
    // Observed live: report emits the HTML-escaped form; lookup returns found:false.
    const emitted = 'LOUGHMILLER MACHINE, TOOL &amp; DESIGN';
    const lookup = (name: string) => ({ found: name === 'LOUGHMILLER MACHINE, TOOL & DESIGN' });

    expect(() => expect(lookup(emitted).found).toBe(true)).toThrow();
    // …and passes once identity is preserved, which is what the fix must achieve.
    expect(lookup('LOUGHMILLER MACHINE, TOOL & DESIGN').found).toBe(true);
  });
});
