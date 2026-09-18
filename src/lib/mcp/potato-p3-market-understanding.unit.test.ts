/**
 * Potato P3 — market understanding on FIND (evidence classes, one FIND).
 */
import { describe, it, expect } from 'vitest';
import {
  buildFindPresentation,
  HOST_RULES_FIND_FIRST_VALUE,
} from '@/lib/opportunities/find-opportunities';
import { P2_FIRST_TURN_INSTRUCTIONS, POTATO_JOURNEY_INSTRUCTIONS } from '@/lib/mcp/potato-journey';
import { MCP_CONNECTOR_INSTRUCTIONS } from '@/lib/mcp/schedule-discovery';
import { resolveForecastAgencies, resolveForecastAgencyIdentity } from '@/lib/forecasts/agency-identity';

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
    expect(POTATO_JOURNEY_INSTRUCTIONS).toMatch(/broader IT contracts, not confirmed cybersecurity/i);
    const p = buildFindPresentation();
    expect(p.sections.related.display_title).toMatch(/Related market/i);
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
