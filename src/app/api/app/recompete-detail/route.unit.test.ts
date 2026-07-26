/**
 * Guard for the Awarded (Recompete) drawer's on-demand intel endpoint + drawer wiring.
 *
 * The Awarded drawer was brought to FULL section parity with the open-opp drawer (GOS #9):
 * it replicates the market-intelligence sections (agency intel + pricing) via this endpoint,
 * plus a Contract-history/incumbent section + task-order spend from the row in hand. This test
 * pins:
 *   1. the endpoint returns ONLY { agency, pricing } — NOT predecessor/valueRange (GOS #9c: a
 *      recompete already carries a real incumbent + contract value, so an M-Estimate is N/A);
 *   2. it fails soft (a thrown intel build → success:true + null sections, never a 500);
 *   3. no key → an honest empty intel (not an error);
 *   4. the drawer wiring survives: rcIntelBox placeholder, loadRecompeteIntel is called from
 *      openRecompeteDrawer, and the task-order spend section (#472) is NOT disturbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock the shared intel engine so the test is hermetic (no USASpending / GSA CALC calls).
vi.mock('@/lib/opportunities/opp-intel', () => ({ buildOppIntel: vi.fn() }));

import { GET } from './route';
import { buildOppIntel as buildOppIntelImport } from '@/lib/opportunities/opp-intel';
const buildOppIntel = vi.mocked(buildOppIntelImport);

function req(qs: string) {
  return { nextUrl: new URL(`https://x.test/api/app/recompete-detail?${qs}`) } as unknown as import('next/server').NextRequest;
}

describe('recompete-detail endpoint', () => {
  beforeEach(() => buildOppIntel.mockReset());

  it('returns ONLY agency + pricing, dropping predecessor/valueRange (GOS #9c)', async () => {
    buildOppIntel.mockResolvedValue({
      predecessor: { incumbent: 'ACME', value: '$10M' },
      valueRange: { low: 1, median: 2, high: 3, label: 'x', source: 'predecessor' },
      agency: { priorities: ['modernize'], painPoints: ['legacy IT'] },
      pricing: { rates: [{ labor_category: 'Engineer', hourly_rate: 120, size: 'SB' }], summary: '3 vendors' },
    });
    const res = await GET(req('naics=541512&agency=DOD&title=IT+support'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Object.keys(body.intel).sort()).toEqual(['agency', 'pricing']);
    expect(body.intel).not.toHaveProperty('predecessor');
    expect(body.intel).not.toHaveProperty('valueRange');
    expect(body.intel.agency.priorities).toContain('modernize');
    expect(body.intel.pricing.rates[0].hourly_rate).toBe(120);
  });

  it('is keyed on naics+agency (passes them to buildOppIntel)', async () => {
    buildOppIntel.mockResolvedValue({ predecessor: null, valueRange: null, agency: null, pricing: null });
    await GET(req('naics=236220&agency=Army&title=paving'));
    expect(buildOppIntel).toHaveBeenCalledWith('236220', 'Army', 'paving');
  });

  it('returns an honest empty intel when nothing to key on (not an error)', async () => {
    const res = await GET(req(''));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.intel).toEqual({ agency: null, pricing: null });
    expect(buildOppIntel).not.toHaveBeenCalled();
  });

  it('fails soft — a thrown intel build yields success:true + null sections, never a 500', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    buildOppIntel.mockRejectedValueOnce(new Error('USASpending down'));
    const res = await GET(req('naics=541512&agency=DOD'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.intel).toEqual({ agency: null, pricing: null });
    errSpy.mockRestore();
  });
});

describe('Awarded drawer wiring (full-parity, do-not-disturb invariants)', () => {
  const routeSrc = readFileSync(join(__dirname, '../../../opportunity-map/route.ts'), 'utf8');

  it('recompeteRender adds the Contract-history/incumbent section + rcIntelBox placeholder', () => {
    expect(routeSrc).toContain("'incumbent'"); // the contract-history section id
    expect(routeSrc).toContain('rcIntelBox');
    expect(routeSrc).toContain('Contract history');
  });

  it('openRecompeteDrawer calls loadRecompeteIntel (the on-demand agency intel + pricing + roster)', () => {
    expect(routeSrc).toContain('loadRecompeteIntel(o)');
    expect(routeSrc).toContain('/api/app/recompete-detail?naics=');
  });

  it('renders the agency-intel + pricing sections from the fetched intel', () => {
    expect(routeSrc).toContain("'agencyintel'");
    expect(routeSrc).toContain('Know your buyer');
    expect(routeSrc).toContain('Pricing intel');
  });

  it('DOES NOT disturb the task-order spend section (#472) — still fetched via loadTaskOrders', () => {
    expect(routeSrc).toContain('Actual task-order spend');
    expect(routeSrc).toContain('loadTaskOrders(o)');
    expect(routeSrc).toContain('rcTaskOrders');
  });

  it('reuses the shared loadRoster for the BD roster (into the recompete intel box)', () => {
    expect(routeSrc).toContain("loadRoster(o.agency,'rcIntelBox')");
  });
});
