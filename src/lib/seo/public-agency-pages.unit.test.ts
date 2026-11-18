import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENCIES_SEO, getAgencyBySlug } from '@/data/agencies-seo';
import { staticEntries } from '@/lib/seo/sitemap-sections';
import {
  buildPublicPainSection,
  getPublicAgencyBySlug,
  listPublicAgencies,
  publicCitationHref,
  selectPublicSourced,
  type PublicSourcedClaim,
} from './public-agency-pages';

const SNAPSHOT = [
  'Cybersecurity modernization and zero-trust architecture implementation',
  'Cloud migration and DevSecOps adoption',
];

function sourced(over: Partial<PublicSourcedClaim> & { pain_point: string }): PublicSourcedClaim {
  return {
    source_type: 'gao',
    source_url: 'https://www.gao.gov/products/gao-26-000001',
    document_number: 'GAO-26-000001',
    published_at: '2026-09-10',
    provenance: 'SOURCE_FACT',
    ...over,
  };
}

describe('public agency pain points', () => {
  it('falls back to the snapshot verbatim when the live read fails', () => {
    const section = buildPublicPainSection(SNAPSHOT, { ok: false });
    expect(section.snapshotFloor).toBe(true);
    expect(section.items.map((item) => item.claim)).toEqual(SNAPSHOT);
    expect(section.items.every((item) => item.href === null)).toBe(true);
    expect(section.freshnessLabel).toMatch(/Published snapshot/);
    expect(section.freshnessLabel).toMatch(/could not be read/);
    expect(section.asOf).toBeNull();
  });

  it('falls back to the snapshot when the live read has no cited rows', () => {
    const section = buildPublicPainSection(SNAPSHOT, {
      ok: true,
      sourced: [sourced({ pain_point: 'An interpretation', provenance: 'MINDY_INTERPRETATION', source_url: null })],
    });
    expect(section.snapshotFloor).toBe(true);
    expect(section.items.map((item) => item.claim)).toEqual(SNAPSHOT);
    expect(section.freshnessLabel).toMatch(/No sourced GAO or inspector general report is on file/);
  });

  it('keeps one line when a sourced claim repeats a snapshot line, and keeps the snapshot wording', () => {
    const section = buildPublicPainSection(SNAPSHOT, {
      ok: true,
      sourced: [
        sourced({
          pain_point: 'Cybersecurity modernization and zero-trust architecture implementation (Source: GAO-26-000001)',
        }),
      ],
    });
    expect(section.items).toHaveLength(SNAPSHOT.length);
    expect(section.items[0].claim).toBe(SNAPSHOT[0]);
    expect(section.items[0].href).toBe('https://www.gao.gov/products/gao-26-000001');
    expect(section.items[0].documentNumber).toBe('GAO-26-000001');
    expect(section.items.map((item) => item.claim)).toEqual(SNAPSHOT);
  });

  it('adds a novel cited row without dropping the snapshot', () => {
    const section = buildPublicPainSection(SNAPSHOT, {
      ok: true,
      sourced: [
        sourced({
          pain_point: 'Open recommendations on product recalls remain unresolved.',
          source_type: 'ig_report',
          source_url: 'https://www.oversight.gov/reports/recommendations',
          document_number: 'OIG-26-0001',
          published_at: '2026-11-01T00:00:00Z',
        }),
      ],
    });
    expect(section.snapshotFloor).toBe(false);
    expect(section.items.map((item) => item.claim)).toEqual([
      ...SNAPSHOT,
      'Open recommendations on product recalls remain unresolved.',
    ]);
    const novel = section.items[2];
    expect(novel.href).toBe('https://www.oversight.gov/reports/recommendations');
    expect(novel.documentNumber).toBe('OIG-26-0001');
    expect(novel.sourceLabel).toBe('Inspector General');
    expect(novel.publishedAt).toBe('2026-11-01');
    expect(section.asOf).toBe('2026-11-01');
    expect(section.freshnessLabel).toMatch(/as of 2026-11-01/);
    expect(section.freshnessLabel).toMatch(/refreshes weekly/);
  });

  it('does not link a non-government or non-https source', () => {
    expect(publicCitationHref('http://www.gao.gov/products/gao-26-1')).toBeNull();
    expect(publicCitationHref('https://example.com/secret')).toBeNull();
    expect(publicCitationHref('javascript:alert(1)')).toBeNull();
    const section = buildPublicPainSection([], {
      ok: true,
      sourced: [sourced({ pain_point: 'Cited in prose only.', source_url: 'https://example.com/x' })],
    });
    expect(section.items[0].href).toBeNull();
    expect(section.items[0].documentNumber).toBe('GAO-26-000001');
  });

  it('drops internal fields when selecting public rows', () => {
    const [row] = selectPublicSourced([
      {
        ...sourced({ pain_point: 'A public claim.' }),
        institute_source_id: 'c870f3c7-dea2-46ef-9943-3018d566afc9',
        recommendation: 'Do not publish this recommendation.',
        resolution_status: 'open',
        resolution_flag: 'confirmed_unresolved',
      },
    ]);
    expect(row).toEqual(sourced({ pain_point: 'A public claim.' }));
    expect(JSON.stringify(row)).not.toContain('c870f3c7');
    expect(JSON.stringify(row)).not.toContain('Do not publish');
    expect(JSON.stringify(row)).not.toContain('confirmed_unresolved');
  });
});

describe('public agency directory', () => {
  it('serves CPSC, ARC, and EAC, and gives USITC code 034 so 061 is not shared', () => {
    const cpsc = getPublicAgencyBySlug('consumer-product-safety-commission');
    const arc = getPublicAgencyBySlug('appalachian-regional-commission');
    const eac = getPublicAgencyBySlug('election-assistance-commission');
    expect(cpsc?.name).toBe('Consumer Product Safety Commission');
    expect(cpsc?.cgac).toBe('061');
    expect(arc?.cgac).toBe('309');
    expect(eac?.cgac).toBe('525');
    expect(getAgencyBySlug('consumer-product-safety-commission')).toBeUndefined();

    const usitc = getPublicAgencyBySlug('us-international-trade-commission');
    expect(usitc?.cgac).toBe('034');
    expect(getAgencyBySlug('us-international-trade-commission')?.cgac).toBe('061');

    const codes = new Map<string, string[]>();
    for (const agency of listPublicAgencies()) {
      const names = codes.get(agency.cgac) ?? [];
      names.push(agency.name);
      codes.set(agency.cgac, names);
    }
    expect(codes.get('061')).toEqual(['Consumer Product Safety Commission']);
    expect(codes.get('034')).toEqual(['U.S. International Trade Commission']);
    expect(listPublicAgencies()).toHaveLength(AGENCIES_SEO.length + 3);
    const urls = new Set(staticEntries().map((entry) => entry.url));
    expect(urls.has('https://getmindy.ai/agencies/consumer-product-safety-commission')).toBe(true);
    expect(urls.has('https://getmindy.ai/agencies/appalachian-regional-commission')).toBe(true);
    expect(urls.has('https://getmindy.ai/agencies/election-assistance-commission')).toBe(true);
  });
});

vi.mock('@/lib/bigquery/agencies', () => ({
  getAgencyProfile: vi.fn(async () => null),
  getTopRecipientsForAgency: vi.fn(async () => []),
  getTopNaicsForAgency: vi.fn(async () => []),
  getSubAgenciesForAgency: vi.fn(async () => []),
}));

vi.mock('@/lib/seo/forecast-pages', () => ({
  getForecastLinksForAgencySlug: vi.fn(async () => null),
}));

const intel = vi.hoisted(() => ({
  getAgencySourcedIntelligence: vi.fn(),
}));

vi.mock('@/lib/strategic-intel/sourced-pain-points', () => ({
  getAgencySourcedIntelligence: intel.getAgencySourcedIntelligence,
}));

describe('agency pages', () => {
  it('returns a page for CPSC, ARC, and EAC', async () => {
    intel.getAgencySourcedIntelligence.mockResolvedValue({
      sourced: [],
      agency: '',
      canonicalAgency: null,
      legacy: [],
      painPoints: [],
      priorities: [],
      meta: { sourcedCount: 0, legacyCount: 0, legacyPriorityCount: 0, provenanceAvailable: false },
    });
    const { default: AgencyPage } = await import('@/app/agencies/[slug]/page');
    for (const slug of [
      'consumer-product-safety-commission',
      'appalachian-regional-commission',
      'election-assistance-commission',
    ]) {
      const element = await AgencyPage({ params: Promise.resolve({ slug }) });
      const html = renderToStaticMarkup(element);
      expect(html).toContain('Contract Opportunities');
      expect(html).toContain(getPublicAgencyBySlug(slug)!.name);
      expect(html).not.toContain('Agency not found');
    }
    await expect(
      AgencyPage({ params: Promise.resolve({ slug: 'not-a-real-agency' }) }),
    ).rejects.toThrow();
  });

  it('renders the citation link and does not repeat a snapshot line', async () => {
    intel.getAgencySourcedIntelligence.mockResolvedValue({
      sourced: [
        {
          ...sourced({
            pain_point: 'Cybersecurity modernization and zero-trust architecture implementation (Source: GAO-26-000001)',
          }),
          institute_source_id: 'c870f3c7-dea2-46ef-9943-3018d566afc9',
          recommendation: 'Hidden recommendation',
        },
        sourced({
          pain_point: 'A newly acquired sustainment gap.',
          source_url: 'https://www.gao.gov/products/gao-26-000099',
          document_number: 'GAO-26-000099',
          published_at: '2026-10-02',
        }),
      ],
      meta: { sourcedReadFailed: false },
    });
    const { default: AgencyPage } = await import('@/app/agencies/[slug]/page');
    const element = await AgencyPage({
      params: Promise.resolve({ slug: 'department-of-defense' }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('https://www.gao.gov/products/gao-26-000001');
    expect(html).toContain('GAO-26-000099');
    expect(html).toContain('A newly acquired sustainment gap.');
    expect(html).not.toContain('c870f3c7-dea2-46ef-9943-3018d566afc9');
    expect(html).not.toContain('Hidden recommendation');
    const snapshotLine = 'Cybersecurity modernization and zero-trust architecture implementation';
    expect(html.split(snapshotLine)).toHaveLength(2);
    expect(html).toContain('as of 2026-10-02');
  });
});
