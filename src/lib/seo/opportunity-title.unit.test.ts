import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOpportunityTitles, MAX_OPPORTUNITY_TITLE } from './opportunity-title';

const getOpportunityBySlug = vi.fn();
vi.mock('@/lib/seo/opportunities', async (orig) => {
  const real = await orig<typeof import('./opportunities')>();
  return { ...real, getOpportunityBySlug: (s: string) => getOpportunityBySlug(s), getRelatedOpenOpportunities: vi.fn() };
});
vi.mock('@/components/MemberAwareCta', () => ({ default: () => null }));

function gasket(sol: string | null, extra: Record<string, unknown> = {}) {
  return {
    noticeId: 'x',
    title: '53--GASKET',
    solicitationNumber: sol,
    department: 'DEPT OF DEFENSE',
    subTier: 'DEFENSE LOGISTICS AGENCY',
    noticeType: 'Combined Synopsis/Solicitation',
    responseDeadline: '2099-11-27T00:00:00Z',
    active: true,
    awardeeName: null,
    awardDate: null,
    description: 'Gasket buy',
    naicsCode: '339991',
    ...extra,
  };
}

describe('buildOpportunityTitles', () => {
  it('gives same-titled notices distinct titles via the solicitation number', () => {
    const sols = ['SPE7LX27U0614', 'SPE7L327T2805', 'SPE7LX27U0759'];
    const titles = sols.map((s) => buildOpportunityTitles({ ...gasket(s), status: 'open' }).title);
    expect(new Set(titles).size).toBe(3);
    expect(titles[0]).toBe('53--GASKET (SPE7LX27U0614) — Federal Contract Opportunity | Mindy');
  });

  it('falls back to the agency when there is no solicitation number', () => {
    const { title } = buildOpportunityTitles({ ...gasket(null), status: 'open' });
    expect(title).toContain('DEFENSE LOGISTICS AGENCY');
    expect(title.length).toBeLessThanOrEqual(MAX_OPPORTUNITY_TITLE);
  });

  it('keeps the solicitation number whole and shortens the SAM title to fit', () => {
    const long = 'Z--REPAIR AND REPLACE HVAC SYSTEMS AT BUILDING 1234 FORT EXAMPLE PHASE II';
    const { title, ogTitle } = buildOpportunityTitles({ ...gasket('W912DY26R0042'), title: long, status: 'closed' });
    expect(title.length).toBeLessThanOrEqual(MAX_OPPORTUNITY_TITLE);
    expect(title).toContain('(W912DY26R0042)');
    expect(title.startsWith('Z--REPAIR')).toBe(true);
    expect(title).toContain('…');
    expect(ogTitle).toBe(`${long} (W912DY26R0042) — Closed Federal Solicitation | Mindy`);
  });

  it('never exceeds the limit for an absurdly long agency qualifier', () => {
    const { title } = buildOpportunityTitles({
      ...gasket(null),
      subTier: 'A'.repeat(80),
      title: 'Some long notice title about many things',
      status: 'open',
    });
    expect(title.length).toBeLessThanOrEqual(MAX_OPPORTUNITY_TITLE);
    expect(title.startsWith('Some long')).toBe(true);
  });
});

describe('/opportunity/[slug] generateMetadata (call site)', () => {
  beforeEach(() => getOpportunityBySlug.mockReset());

  it('emits distinct <title>s for notices that share a SAM title', async () => {
    const { generateMetadata } = await import('@/app/opportunity/[slug]/page');
    const out: string[] = [];
    for (const sol of ['SPE7LX27U0614', 'SPE7L327T2805']) {
      getOpportunityBySlug.mockResolvedValueOnce(gasket(sol));
      const md = await generateMetadata({ params: Promise.resolve({ slug: `53-gasket-${sol}` }) });
      out.push(String(md.title));
      expect((md.openGraph as { title?: string }).title).toContain(sol);
    }
    expect(out[0]).toBe('53--GASKET (SPE7LX27U0614) — Federal Contract Opportunity | Mindy');
    expect(out[0]).not.toBe(out[1]);
  });
});
