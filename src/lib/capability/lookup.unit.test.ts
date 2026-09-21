import { describe, it, expect } from 'vitest';
import { toCapabilityBadge, type CapabilityProfile } from './lookup';

const base: CapabilityProfile = {
  rollup_uei: 'ABC123',
  rollup_name: 'ACME SERVICES LLC',
  capability_label: 'Custodial & janitorial services',
  capability_summary: 'Custodial & janitorial services specialist — 92% of contract dollars',
  specialty_tier: 'specialist',
  specialty_score: 0.92,
  top_pscs: [{ code: 'S201', description: 'HOUSEKEEPING- CUSTODIAL JANITORIAL', share: 0.92 }],
  top_agencies: [{ agency: 'Department of Defense', share: 0.61 }],
  set_asides_won: ['SMALL BUSINESS SET ASIDE - TOTAL'],
  award_count: 14,
  total_obligated: 19_500_000,
};

describe('toCapabilityBadge', () => {
  it('returns null when there is no profile or no label (never a placeholder)', () => {
    expect(toCapabilityBadge(undefined)).toBeNull();
    expect(toCapabilityBadge({ ...base, capability_label: null })).toBeNull();
  });

  it('converts the dollar share to a whole percentage', () => {
    expect(toCapabilityBadge(base)!.sharePct).toBe(92);
  });

  it('shows the top agency only at >= 40% share (below that it is noise)', () => {
    expect(toCapabilityBadge(base)!.topAgency).toBe('Department of Defense');
    const diluted = toCapabilityBadge({ ...base, top_agencies: [{ agency: 'GSA', share: 0.22 }] })!;
    expect(diluted.topAgency).toBeNull();
    expect(diluted.topAgencyPct).toBeNull();
  });

  it('reports set-aside as behavior, and ignores the NO SET ASIDE sentinel', () => {
    expect(toCapabilityBadge(base)!.wonSetAside).toBe(true);
    expect(toCapabilityBadge({ ...base, set_asides_won: ['NO SET ASIDE USED.'] })!.wonSetAside).toBe(false);
    expect(toCapabilityBadge({ ...base, set_asides_won: null })!.wonSetAside).toBe(false);
  });

  it('carries the tier through for the UI chip', () => {
    expect(toCapabilityBadge(base)!.tier).toBe('specialist');
    expect(toCapabilityBadge({ ...base, specialty_tier: 'diversified' })!.tier).toBe('diversified');
  });

  it('tolerates a missing specialty score rather than emitting 0%', () => {
    expect(toCapabilityBadge({ ...base, specialty_score: null })!.sharePct).toBeNull();
  });
});

/**
 * The holding-company guard lives inside getCapabilityProfilesByUei (which needs a DB), so these
 * assert the RULE it encodes. Regression context: COPPER RIVER CYBER SOLUTIONS inherited its
 * parent ALASKA NATIVE GOVERNMENT SERVICES' top PSC and rendered as "Small craft" — a confidently
 * wrong capability for a cyber firm.
 */
describe('holding-company inheritance rule', () => {
  const MIN_INHERITABLE_SHARE = 0.2; // must mirror lookup.ts
  const inherits = (share: number) => share >= MIN_INHERITABLE_SHARE;

  it('blocks inheritance from a diluted holding company (the Copper River bug)', () => {
    // ALASKA NATIVE GOVERNMENT SERVICES: 0.114 top-PSC share across 111 PSCs.
    expect(inherits(0.114)).toBe(false);
  });

  it('allows inheritance from a large but genuinely characteristic parent', () => {
    // LOCKHEED MARTIN CORP: 0.304 share — "Fixed-wing aircraft" is apt despite 181 children.
    expect(inherits(0.304)).toBe(true);
    // RTX CORP: 0.216 — just above the line, "Guided missiles" is apt.
    expect(inherits(0.216)).toBe(true);
  });

  it('uses dollar concentration, NOT child count, as the discriminator', () => {
    // Lockheed has 181 children vs the holding company's 8 — a child-count threshold would have
    // blocked exactly the firms whose profile is correct (it did: Lockheed went 0/10).
    const lockheed = { children: 181, share: 0.304 };
    const holdingCo = { children: 8, share: 0.114 };
    expect(inherits(lockheed.share)).toBe(true);
    expect(inherits(holdingCo.share)).toBe(false);
    expect(lockheed.children).toBeGreaterThan(holdingCo.children); // count would invert the rule
  });
});
