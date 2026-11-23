/**
 * Search-result titles: the suffix must survive Google's ~600px cut, and a
 * shortened name ends at a whole word. Covers the helper and both call sites
 * (/naics/<code> and /forecasts/<slug> generateMetadata).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNaicsTitles, clipAtWord, MAX_SEO_TITLE } from './seo-title-clip';
import { NAICS_TOP_100 } from '@/data/naics-top100';

const lookup = vi.fn();
vi.mock('@/lib/bigquery/naics', () => ({
  lookupNaicsProfile: (code: string) => lookup(code),
  getTopRecipientsForNaics: vi.fn(async () => []),
  getTopAgenciesForNaics: vi.fn(async () => []),
  getNaicsSetAsideAndPsc: vi.fn(async () => null),
}));

const getForecastById = vi.fn();
vi.mock('@/lib/seo/forecast-pages', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/forecast-pages')>()),
  getForecastById: (id: string) => getForecastById(id),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  permanentRedirect: () => { throw new Error('NEXT_REDIRECT'); },
}));

import { generateMetadata as naicsMetadata } from '@/app/naics/[code]/page';
import { generateMetadata as forecastMetadata } from '@/app/forecasts/[id]/page';

const LONG_334513 =
  'Instruments and Related Products Manufacturing for Measuring, Displaying, and Controlling Industrial Process Variables';

describe('clipAtWord', () => {
  it('leaves a short name alone', () => {
    expect(clipAtWord('Custom Computer Programming Services', 60)).toBe('Custom Computer Programming Services');
  });

  it('cuts at a word boundary, never mid-word', () => {
    const out = clipAtWord('Invasive Plant Treatment - Hobe Sound National Wildlife Refuge', 35);
    expect(out.length).toBeLessThanOrEqual(35);
    expect(out).toBe('Invasive Plant Treatment - Hobe…');
  });

  it('never ends on a connector word or an unclosed bracket', () => {
    expect(clipAtWord(LONG_334513, 29)).toBe('Instruments and Related…');
    expect(
      clipAtWord('Research and Development in the Physical, Engineering, and Life Sciences (except Nanotechnology and Biotechnology)', 80),
    ).toBe('Research and Development in the Physical, Engineering, and Life Sciences…');
  });

  it('hard-cuts only when the first word alone is too long', () => {
    expect(clipAtWord('Supercalifragilisticexpialidocious', 10)).toBe('Supercali…');
  });
});

describe('buildNaicsTitles', () => {
  it('keeps the code and the whole "— Federal Contracts | Mindy" suffix within the limit', () => {
    const { title, ogTitle } = buildNaicsTitles('334513', LONG_334513);
    expect(title).toBe('NAICS 334513: Instruments and Related… — Federal Contracts | Mindy');
    expect(title.length).toBeLessThanOrEqual(MAX_SEO_TITLE);
    expect(ogTitle).toBe(`NAICS 334513: ${LONG_334513} — Federal Contracts | Mindy`);
  });

  it('every top-100 NAICS page title fits and ends with the full suffix', () => {
    for (const e of NAICS_TOP_100) {
      const { title } = buildNaicsTitles(e.code, e.title);
      expect(title.length, title).toBeLessThanOrEqual(MAX_SEO_TITLE);
      expect(title.startsWith(`NAICS ${e.code}: `), title).toBe(true);
      expect(title.endsWith(' — Federal Contracts | Mindy'), title).toBe(true);
    }
  });

  it('a short description is unchanged', () => {
    expect(buildNaicsTitles('541330', 'Engineering Services').title).toBe(
      'NAICS 541330: Engineering Services — Federal Contracts | Mindy',
    );
    // 78 chars before: the description is shortened at a whole word.
    expect(buildNaicsTitles('541511', 'Custom Computer Programming Services').title).toBe(
      'NAICS 541511: Custom Computer Programming… — Federal Contracts | Mindy',
    );
  });
});

describe('call sites', () => {
  beforeEach(() => {
    lookup.mockReset();
    getForecastById.mockReset();
  });

  it('/naics/334513 generateMetadata uses the shortened title, full og:title', async () => {
    const meta = await naicsMetadata({ params: Promise.resolve({ code: '334513' }) });
    expect(meta.title).toBe('NAICS 334513: Instruments and Related… — Federal Contracts | Mindy');
    expect((meta.openGraph as { title?: string }).title).toBe(
      `NAICS 334513: ${LONG_334513} — Federal Contracts | Mindy`,
    );
  });

  it('/forecasts/<slug> generateMetadata cuts the forecast title at a whole word', async () => {
    const id = '08a9f1fa-ebf9-4780-bef1-2bb18d10e42d';
    getForecastById.mockResolvedValue({
      forecast: {
        title: '25 Alternative Temporary Transportable Housing Unit Buy',
        sourceAgency: null,
        department: 'Department of Homeland Security',
        fiscalYear: null,
        anticipatedQuarter: null,
        naicsCode: null,
        valueMin: null,
        valueMax: null,
        valueRangeText: null,
        setAside: null,
      },
      indexability: { indexable: true },
      canonicalSlug: `25-alternative-temporary-transportable-housing-unit-buy-${id}`,
    });
    const meta = await forecastMetadata({
      params: Promise.resolve({ id: `25-alternative-temporary-transportable-housing-unit-buy-${id}` }),
    });
    // BEFORE: "25 Alternative Temporary Transportable… — …" was a clean cut by luck; the
    // old slice() cut "Overhaul Hydraulic Pump, Tail Rotor Se…" mid-word.
    expect(meta.title).toBe('25 Alternative Temporary Transportable… — Department of Homeland Security Forecast | Mindy');

    getForecastById.mockResolvedValue({
      forecast: {
        title: 'Overhaul Hydraulic Pump, Tail Rotor Servo Assembly',
        sourceAgency: null,
        department: 'Department of Homeland Security',
        fiscalYear: null,
        anticipatedQuarter: null,
        naicsCode: null,
        valueMin: null,
        valueMax: null,
        valueRangeText: null,
        setAside: null,
      },
      indexability: { indexable: true },
      canonicalSlug: `overhaul-${id}`,
    });
    const meta2 = await forecastMetadata({ params: Promise.resolve({ id: `overhaul-${id}` }) });
    expect(meta2.title).toBe('Overhaul Hydraulic Pump, Tail Rotor… — Department of Homeland Security Forecast | Mindy');
  });
});
