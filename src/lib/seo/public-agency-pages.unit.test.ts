import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENCIES_SEO, getAgencyBySlug } from '@/data/agencies-seo';
import { staticEntries } from '@/lib/seo/sitemap-sections';
import {
  agencyAwardCacheConfig,
  agencyIntelCacheConfig,
} from './public-agency-intel-cache';
import {
  buildPublicPainSection,
  classifyPublicPriority,
  getPublicAgencyBySlug,
  listPublicAgencies,
  PUBLIC_PRIORITY_DOLLAR_NOTE,
  publicCitationHref,
  publicFindingClaim,
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
    const section = buildPublicPainSection(SNAPSHOT, {
      ok: false,
      checkedAt: '2026-11-18T23:40:00.000Z',
    });
    expect(section.snapshotFloor).toBe(true);
    expect(section.items.map((item) => item.claim)).toEqual(SNAPSHOT);
    expect(section.cited).toEqual([]);
    expect(section.unsourced.map((item) => item.claim)).toEqual(SNAPSHOT);
    expect(section.items.every((item) => item.href === null)).toBe(true);
    expect(section.freshnessLabel).toBe('');
    expect(section.unsourcedLabel).toMatch(/Published snapshot/);
    expect(section.unsourcedLabel).toMatch(/could not be read/);
    expect(section.unsourcedLabel).toMatch(/Mindy last checked 2026-11-18 23:40 UTC/);
    expect(section.unsourcedLabel).toMatch(/refreshes daily/);
    expect(section.unsourcedLabel).not.toMatch(/Sourced from GAO/);
    expect(section.asOf).toBeNull();
    expect(section.checkedAt).toBe('2026-11-18 23:40 UTC');
  });

  it('falls back to the snapshot when the live read has no cited rows', () => {
    const section = buildPublicPainSection(SNAPSHOT, {
      ok: true,
      sourced: [sourced({ pain_point: 'An interpretation', provenance: 'MINDY_INTERPRETATION', source_url: null })],
    });
    expect(section.snapshotFloor).toBe(true);
    expect(section.items.map((item) => item.claim)).toEqual(SNAPSHOT);
    expect(section.cited).toEqual([]);
    expect(section.freshnessLabel).toBe('');
    expect(section.unsourcedLabel).toMatch(/No sourced GAO or inspector general report is on file/);
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
      checkedAt: '2026-11-18T15:05:00.000Z',
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
    expect(section.cited.map((item) => item.claim)).toEqual([
      'Open recommendations on product recalls remain unresolved.',
    ]);
    expect(section.unsourced.map((item) => item.claim)).toEqual(SNAPSHOT);
    expect(section.freshnessLabel).toMatch(/as of 2026-11-01/);
    expect(section.freshnessLabel).toMatch(/Sourced from GAO/);
    expect(section.unsourcedLabel).toMatch(/not covered by the sourced report date/);
    expect(section.unsourcedLabel).not.toMatch(/as of/);
    expect(section.freshnessLabel).toMatch(/Mindy last checked 2026-11-18 15:05 UTC/);
    expect(section.freshnessLabel).toMatch(/refreshes daily/);
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

  it('does not print a recommendation that was stored as the finding', () => {
    const recommendation = 'Strengthen key monitoring controls to ensure control effectiveness throughout the financial reporting process.';
    const claim = `${recommendation} (Source: OIG-REC:reports~audit~cpsc:1)`;
    expect(publicFindingClaim(claim, recommendation)).not.toContain('monitoring controls');
    expect(publicFindingClaim(claim, recommendation)).toContain('OIG-REC:reports~audit~cpsc:1');
    const [row] = selectPublicSourced([
      {
        ...sourced({
          pain_point: claim,
          source_type: 'ig_report',
          document_number: 'OIG-REC:reports~audit~cpsc:1',
          source_url: 'https://www.oversight.gov/reports/audit/example',
        }),
        recommendation,
        resolution_status: 'open',
        resolution_flag: 'confirmed_unresolved',
      },
    ]);
    expect(row.pain_point).not.toContain('monitoring controls');
    expect(JSON.stringify(row)).not.toContain('confirmed_unresolved');
    expect(publicFindingClaim(
      'Audit of the fiscal year financial statements (Source: OIG-REC:reports~audit~cpsc:1)',
      recommendation,
    )).toMatch(/financial statements/i);
  });
});

describe('agency page caches', () => {
  it('keeps intelligence on a one-day agency tag and awards on seven days', () => {
    const intel = agencyIntelCacheConfig('Consumer Product Safety Commission');
    expect(intel.revalidate).toBe(86_400);
    expect(intel.tags).toEqual(['agency-intel:Consumer Product Safety Commission']);
    expect(intel.key).toContain('Consumer Product Safety Commission');
    const awards = agencyAwardCacheConfig('Department of Defense');
    expect(awards.revalidate).toBe(604_800);
    expect(awards.tags).toEqual(['agency-bq:Department of Defense']);
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

vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

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
    expect(html).toMatch(/Mindy last checked \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    expect(html).toContain('The intelligence refreshes daily.');
    const sourcedAt = html.indexOf('Sourced from GAO');
    const snapshotAt = html.indexOf('Published snapshot');
    expect(sourcedAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeGreaterThan(sourcedAt);
    const uncited = 'Cloud migration and DevSecOps adoption';
    expect(html.indexOf(uncited)).toBeGreaterThan(snapshotAt);
    expect(html.slice(sourcedAt, snapshotAt)).not.toContain(uncited);
  });

  it('keeps VA snapshot lines and dollar priorities out of the sourced heading', async () => {
    intel.getAgencySourcedIntelligence.mockResolvedValue({
      sourced: [
        sourced({
          pain_point: 'A newly acquired sustainment gap.',
          source_url: 'https://www.gao.gov/products/gao-26-000099',
          document_number: 'GAO-26-000099',
          published_at: '2026-09-30',
        }),
      ],
      meta: { sourcedReadFailed: false },
    });
    const { default: AgencyPage } = await import('@/app/agencies/[slug]/page');
    const element = await AgencyPage({
      params: Promise.resolve({ slug: 'department-of-veterans-affairs' }),
    });
    const html = renderToStaticMarkup(element);
    const sourcedAt = html.indexOf('Sourced from GAO and inspectors general, as of 2026-09-30');
    const snapshotAt = html.indexOf('>Published snapshot<');
    expect(sourcedAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeGreaterThan(sourcedAt);
    expect(html.slice(sourcedAt, snapshotAt)).not.toContain('Claims processing automation');
    expect(html.slice(sourcedAt, snapshotAt)).not.toContain('Electronic health records (EHR) modernization');
    expect(html.indexOf('Claims processing automation')).toBeGreaterThan(snapshotAt);
    expect(html).toContain('$5.1B allocated for Electronic Health Record Modernization');
    expect(html).toContain(PUBLIC_PRIORITY_DOLLAR_NOTE);
    expect(html).not.toContain('Where the money is moving');
    expect(html).toContain('Not an obligation and not spending');
  });
});

describe('public priority dollars stay curated figures', () => {
  it('keeps the dollar text and marks it as not an obligation', () => {
    const line = classifyPublicPriority(
      '$5.1B allocated for Electronic Health Record Modernization (EHRM)',
    );
    expect(line.text).toContain('$5.1B');
    expect(line.unsourcedDollar).toBe(true);
    expect(classifyPublicPriority('Claims processing automation').unsourcedDollar).toBe(false);
  });
});
