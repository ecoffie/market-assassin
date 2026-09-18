/**
 * Potato P3 — market understanding on FIND (evidence classes, one FIND).
 */
import { describe, it, expect } from 'vitest';
import {
  buildFindPresentation,
  comingBackHostClaim,
  comingBackSummary,
  headlineFor,
  HOST_RULES_FIND_FIRST_VALUE,
  type HorizonResult,
} from '@/lib/opportunities/find-opportunities';
import { P2_FIRST_TURN_INSTRUCTIONS, POTATO_JOURNEY_INSTRUCTIONS } from '@/lib/mcp/potato-journey';
import { MCP_CONNECTOR_INSTRUCTIONS } from '@/lib/mcp/schedule-discovery';
import { creditsFor, TOOL_CREDITS } from '@/lib/mcp/tool-registry';
import { resolveForecastAgencies, resolveForecastAgencyIdentity } from '@/lib/forecasts/agency-identity';
import { classifyRecord, interpretCapability, interpretMarket } from '@/lib/opportunities/market-interpretation';

function hz(
  status: HorizonResult['status'],
  matched: number | null,
  extra: Partial<HorizonResult> = {},
): HorizonResult {
  return {
    status,
    matched_count: matched,
    returned_count: extra.items?.length ?? 0,
    items: extra.items ?? [],
    source: 'test',
    as_of: null,
    filters_consumed: [],
    filters_unsupported: [],
    unmapped_count: 0,
    error: extra.error ?? null,
    allowed_handoffs: [],
    semantics_note: extra.semantics_note ?? null,
    evidence_counts: extra.evidence_counts ?? null,
  };
}

describe('P3 presentation contract', () => {
  it('keeps P2 one-FIND first value', () => {
    const haystack = `${P2_FIRST_TURN_INSTRUCTIONS}\n${HOST_RULES_FIND_FIRST_VALUE.join('\n')}\n${MCP_CONNECTOR_INSTRUCTIONS}`;
    expect(haystack).toMatch(/find_opportunities ONCE/i);
    expect(haystack).toMatch(/Do not call find_opportunities again before presenting/i);
    expect(haystack).not.toMatch(/call find_opportunities three times/i);
  });

  it('requires DIRECT vs RELATED distinction in host rules and journey', () => {
    const rules = HOST_RULES_FIND_FIRST_VALUE.join('\n');
    expect(rules).toMatch(/DIRECT_MATCH/);
    expect(rules).toMatch(/RELATED_MARKET_CANDIDATE/);
    expect(rules).toMatch(/Never count related-market rows as confirmed cyber/i);
    expect(rules).toMatch(/Never say you searched all of DoD/i);
    expect(rules).toMatch(/coverage not established/i);
    expect(rules).toMatch(/COMING BACK SPLIT/);
    expect(rules).toMatch(/Never say “N\+M cybersecurity recompetes/i);
    expect(POTATO_JOURNEY_INSTRUCTIONS).toMatch(/broader IT contracts, not confirmed cybersecurity/i);
    const p = buildFindPresentation();
    expect(p.sections.related.display_title).toMatch(/Related market/i);
  });
});

describe('A–B DIRECT and RELATED stay split in counts, items, and host summary', () => {
  const ev = { DIRECT_MATCH: 8, RELATED_MARKET_CANDIDATE: 31 };
  const items = [
    { identity: { id: 'a' }, evidence_class: 'DIRECT_MATCH', title: 'Cyber support' },
    { identity: { id: 'b' }, evidence_class: 'RELATED_MARKET_CANDIDATE', title: 'PaaS' },
  ] as HorizonResult['items'];

  it('per-horizon counts + returned items keep separate classes', () => {
    const back = hz('grounded', 39, { evidence_counts: ev, items });
    expect(back.evidence_counts?.DIRECT_MATCH).toBe(8);
    expect(back.evidence_counts?.RELATED_MARKET_CANDIDATE).toBe(31);
    expect(back.evidence_counts!.DIRECT_MATCH + back.evidence_counts!.RELATED_MARKET_CANDIDATE).toBe(39);
    expect(back.items.map((i) => i.evidence_class)).toEqual(['DIRECT_MATCH', 'RELATED_MARKET_CANDIDATE']);
    expect(back.items.every((i) => i.evidence_class !== undefined)).toBe(true);
  });

  it('customer-facing summary metadata carries the split, not only 39', () => {
    const back = hz('grounded', 39, { evidence_counts: ev, items });
    const summary = comingBackSummary(back);
    expect(summary.matched_count).toBe(39);
    expect(summary.direct_match).toBe(8);
    expect(summary.related_market_candidate).toBe(31);
    expect(summary.direct_match).not.toBe(summary.matched_count);
  });

  it('a host cannot truthfully say “39 cybersecurity recompetes” for 8+31', () => {
    const claim = comingBackHostClaim('cybersecurity', ev);
    expect(claim).toMatch(/8 contracts with direct cybersecurity evidence/);
    expect(claim).toMatch(/31 related-market candidates worth reviewing/);
    expect(claim).not.toMatch(/39 cybersecurity/);
    expect(claim).toMatch(/Do not call the combined 39 "cybersecurity contracts"/);

    const headline = headlineFor({
      open_now: hz('empty', 0),
      coming_back: hz('grounded', 39, { evidence_counts: ev, items }),
      coming_soon: hz('unavailable', null, {
        error: { class: 'coverage_unestablished', message: 'no publisher' },
      }),
    });
    expect(headline).toMatch(/8 direct/);
    expect(headline).toMatch(/31 related-market/);
    expect(headline).toMatch(/coming soon unavailable/);
    expect(headline).not.toMatch(/0 coming soon/);
    expect(headline).not.toMatch(/39 cybersecurity/);
  });
});

describe('C–E capability negatives', () => {
  it('generic 541511/541512/541519 is RELATED, not cyber by itself', () => {
    const cap = interpretCapability('cybersecurity');
    for (const code of ['541511', '541512', '541519'] as const) {
      expect(classifyRecord({ title: 'IT support', naics_code: code }, cap)).toBe('RELATED_MARKET_CANDIDATE');
    }
    expect(cap.direct.naics).not.toContain('541511');
    expect(cap.direct.naics).not.toContain('541512');
    expect(cap.direct.naics).not.toContain('541519');
  });

  it('physical security does not enter cyber expansion', () => {
    expect(interpretCapability('physical security').related_market).toBeNull();
    expect(interpretMarket('physical security', 'SOCOM').retrieval_plan.related_market_applied).toBe(false);
  });

  it('bare “security” does not trigger the cyber related-market family', () => {
    expect(interpretCapability('security').related_market).toBeNull();
    expect(interpretMarket('security', 'SOCOM').retrieval_plan.related_market_applied).toBe(false);
  });
});

describe('F buyer normalization', () => {
  it('SOCOM / USSOCOM / U.S. Special Operations Command are one buyer without DoD widening', () => {
    const aliases = ['SOCOM', 'USSOCOM', 'U.S. Special Operations Command'];
    const canons = aliases.map((a) => interpretMarket('cybersecurity', a).buyer);
    expect(canons.every((b) => b.kind === 'normalization')).toBe(true);
    expect(new Set(canons.map((b) => b.canonical)).size).toBe(1);
    for (const b of canons) {
      expect(b.parent_department_applied).toBe(false);
      expect(b.canonical).toMatch(/Special Operations Command/i);
      expect(b.needles.join(' ').toUpperCase()).toMatch(/SOCOM/);
      expect(b.needles.join(' ').toUpperCase()).not.toMatch(/\bDEPARTMENT OF DEFENSE\b/);
    }
  });
});

describe('G forecast no publisher coverage is unavailable, never 0', () => {
  it('SOCOM identity is coverage none, not empty DoD rows', () => {
    for (const term of ['SOCOM', 'USSOCOM', 'U.S. Special Operations Command']) {
      const id = resolveForecastAgencyIdentity(term);
      expect(id?.key, term).toBe('SOCOM');
      expect(id?.coverage).toBe('none');
      expect(id?.codes).toEqual([]);
      expect(resolveForecastAgencies(term).codes).toEqual([]);
    }
    const headline = headlineFor({
      open_now: hz('empty', 0),
      coming_back: hz('empty', 0),
      coming_soon: hz('unavailable', null, {
        error: { class: 'coverage_unestablished', message: 'No forecast publisher for this buyer' },
      }),
    });
    expect(headline).toBe('0 open now · 0 coming back · coming soon unavailable');
    expect(headline).not.toMatch(/0 coming soon/);
  });
});

describe('H P2 sequencing and FIND price stay locked', () => {
  it('one naive prompt → one FIND → 10 credits → first value → one refine', () => {
    expect(creditsFor('find_opportunities')).toBe(10);
    expect(TOOL_CREDITS.find_opportunities).toBe(10);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/Call find_opportunities ONCE/);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/Ask at most ONE plain-English refinement question/);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/do NOT:[\s\S]*auto-call understand_customer/i);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/do NOT:[\s\S]*auto-call get_current_acquisition_intelligence/i);
  });
});

describe('forecast SOCOM is coverage-none, not DoD substitution', () => {
  it('SOCOM and USSOCOM resolve to an identity with no publisher', () => {
    for (const term of ['SOCOM', 'USSOCOM', 'U.S. Special Operations Command']) {
      const id = resolveForecastAgencyIdentity(term);
      expect(id?.key, term).toBe('SOCOM');
      expect(id?.coverage).toBe('none');
      expect(id?.codes).toEqual([]);
      expect(resolveForecastAgencies(term).codes).toEqual([]);
      expect(resolveForecastAgencies(term).unresolved).toEqual([]);
    }
  });

  it('does not inherit Navy/USACE DoD forecast codes', () => {
    expect(resolveForecastAgencies('SOCOM').codes).not.toContain('NAVY');
    expect(resolveForecastAgencies('SOCOM').codes).not.toContain('USACE');
    expect(resolveForecastAgencyIdentity('SOCOM')?.parentWithData).toBe('DOD');
  });
});
