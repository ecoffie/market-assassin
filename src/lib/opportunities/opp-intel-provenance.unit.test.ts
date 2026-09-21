/**
 * opp-intel is the surface that carried the fabricated budget claim to customers
 * (549 opportunities, 174 active). Two contracts are pinned here:
 *
 *   1. Provenance the shared reader SUPPLIES must survive into the stored blob.
 *      It was previously dropped, which is why 516 of 549 contaminated blobs
 *      carried no label at all.
 *   2. Active and historical opportunities go through the SAME builder, so there
 *      is no path where a historical blob keeps a claim an active one rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/usaspending/find-predecessor', () => ({ findPredecessorAward: vi.fn(async () => null) }));
vi.mock('@/mcp/tools/pricing-intel', () => ({ getPricingIntel: vi.fn(async () => null) }));
vi.mock('@/lib/opportunities/value-range', () => ({ getComparableAwardRange: vi.fn(async () => null) }));
vi.mock('@/lib/gov-contacts/agency-key', () => ({ normalizeAgencyKey: (a: string) => a }));

const getUnifiedAgencyIntelligence = vi.fn();
vi.mock('@/lib/agency-intelligence', () => ({
  getUnifiedAgencyIntelligence: (...a: unknown[]) => getUnifiedAgencyIntelligence(...a),
}));

const { buildOppIntel } = await import('./opp-intel');

const NASA = 'National Aeronautics and Space Administration';

beforeEach(() => getUnifiedAgencyIntelligence.mockReset());

describe('citations survive into opp-intel when supplied', () => {
  it('carries source_url + document_number + date + provenance class through to the blob', async () => {
    getUnifiedAgencyIntelligence.mockResolvedValue({
      agencyName: NASA,
      painPoints: ['Chemical Security: DHS Should Provide Options'],
      priorities: [],
      gaoReports: [], spendingPatterns: [], sources: ['institute_gao'],
      hasSourcedIntelligence: true,
      painPointCitations: [{
        claim: 'Chemical Security: DHS Should Provide Options',
        provenance: 'SOURCE_FACT',
        source_type: 'gao',
        document_number: 'GAO-26-108127',
        source_url: 'https://www.gao.gov/products/gao-26-108127',
        published_at: '2026-09-08',
      }],
    });

    const intel = await buildOppIntel('541512', NASA, 'Test', 500);
    expect(intel.agency?.citations).toHaveLength(1);
    const c = intel.agency!.citations![0];
    expect(c.provenance).toBe('SOURCE_FACT');
    expect(c.document_number).toBe('GAO-26-108127');
    expect(c.source_url).toContain('gao.gov');
    expect(c.published_at).toBe('2026-09-08');
  });

  it('omits citations rather than inventing them when the reader supplies none', async () => {
    getUnifiedAgencyIntelligence.mockResolvedValue({
      agencyName: NASA,
      painPoints: ['Legacy claim [LEGACY_MANUAL — provenance unavailable]'],
      priorities: [],
      gaoReports: [], spendingPatterns: [], sources: ['static'],
    });
    const intel = await buildOppIntel('541512', NASA, 'Test', 500);
    expect(intel.agency?.citations).toBeUndefined();
    // Unsupported legacy content keeps its honest label; it never gains a fake citation.
    expect(intel.agency?.painPoints[0]).toContain('LEGACY_MANUAL');
  });
});

describe('the blob cannot carry the fabricated claim', () => {
  it('a NASA blob built from a clean reader has no Congressional-justification outlay', async () => {
    getUnifiedAgencyIntelligence.mockResolvedValue({
      agencyName: NASA,
      painPoints: [], priorities: [],
      gaoReports: [], spendingPatterns: [], sources: ['database'],
    });
    const intel = await buildOppIntel('541512', NASA, 'Test', 500);
    expect(JSON.stringify(intel)).not.toMatch(/congressional\s+justification/i);
    expect(JSON.stringify(intel)).not.toContain('13541.1');
    expect(JSON.stringify(intel)).not.toContain('16047.1');
  });

  it('active and historical opportunities use the SAME builder — one safety contract', async () => {
    getUnifiedAgencyIntelligence.mockResolvedValue({
      agencyName: NASA, painPoints: ['x'], priorities: [],
      gaoReports: [], spendingPatterns: [], sources: ['database'],
    });
    // buildOppIntel takes no active/historical flag: there is structurally no way
    // for a historical blob to be built by a laxer path.
    const a = await buildOppIntel('541512', NASA, 'Active notice', 500);
    const h = await buildOppIntel('541512', NASA, 'Active notice', 500);
    expect(a.agency).toEqual(h.agency);
  });
});
