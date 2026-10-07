/**
 * Research Standard v1 — the rules are present, published, linked, and enforced on the registry.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESEARCH_STANDARD_V1 } from './research-standard';
import { PUBLICATIONS, RESEARCH_STANDARD, publishedPublications, publishedBySlug } from './research-publications';
import { renderSbBenchmarkHtml } from './sb-benchmark-html';
import { GET as standardGET } from '@/app/research/standard/route';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Research Standard v1 content', () => {
  it('has the 15 required principles, numbered 1..15', () => {
    expect(RESEARCH_STANDARD_V1.principles.map((p) => p.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const titles = RESEARCH_STANDARD_V1.principles.map((p) => p.title);
    for (const t of ['Measurement date', 'Historical as-of date', 'Provenance', 'Completeness', 'Terminology', 'Fact, derived measure, interpretation', 'Decline to conclude', 'Historical reproducibility', 'Corrections', 'Limitations', 'Primary sources', 'Regulatory and legal questions', 'Commercial independence', 'Null results', 'Research engine disclosure']) {
      expect(titles).toContain(t);
    }
  });

  it('names the completeness statuses and the terminology rules', () => {
    const all = RESEARCH_STANDARD_V1.principles.map((p) => p.rule).join(' ');
    for (const s of ['COMPLETE', 'PARTIAL', 'SOURCE_LAG', 'UNKNOWN', 'NOT ESTABLISHED', 'UNRESOLVED', 'INSUFFICIENT EVIDENCE']) expect(all).toContain(s);
    expect(all).toContain('Public federal obligations are not revenue');
    expect(all).toContain('is not backlog');
  });

  it('is served at /research/standard with every principle and the brand roles', async () => {
    const body = await (await standardGET()).text();
    for (const p of RESEARCH_STANDARD_V1.principles) expect(body).toContain(p.title);
    expect(body).toContain('<link rel="canonical" href="https://getmindy.ai/research/standard">');
    expect(body).toContain('independent research and measurement of the public procurement economy');
    expect(body).not.toMatch(/think tank|GovCon Giants Institute/i);
    expect(RESEARCH_STANDARD.url).toBe(RESEARCH_STANDARD_V1.url);
  });

  it('is linked from /research, /research/about and /research/how-we-publish, and is in the sitemap', () => {
    for (const f of ['src/app/research/route.ts', 'src/app/research/about/route.ts', 'src/app/research/how-we-publish/route.ts']) {
      expect(read(f)).toContain('href="/research/standard"');
    }
    expect(read('src/app/sitemap.ts')).toContain('/research/standard');
  });
});

describe('Publication registry enforces the Standard', () => {
  it('every published publication carries version, publish date, measurement mode and a corrections log', () => {
    const published = publishedPublications();
    expect(published.length).toBeGreaterThan(0);
    for (const p of published) {
      expect(p.standard, p.id).toBe('v1');
      expect(p.version, p.id).toMatch(/^v\d+\.\d+$/);
      expect(p.publishedDate, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.measurement, p.id).toBeDefined();
      expect(Array.isArray(p.corrections), p.id).toBe(true);
      expect(p.url, p.id).toBe(`/research/${p.slug}`);
      expect(p.slug!, p.id).not.toMatch(/\d{4}/); // permanent URL never carries a year
    }
  });

  it('a frozen publication states its as-of date and was measured on or after it', () => {
    for (const p of publishedPublications()) {
      if (p.measurement?.mode !== 'frozen') continue;
      expect(p.measurement.asOf <= p.measurement.measuredOn).toBe(true);
    }
  });

  it('RES-004 is the permanent Halvik study URL', () => {
    const pub = publishedBySlug('halvik-tetra-tech');
    expect(pub?.id).toBe('RES-004');
    expect(pub?.measurement).toEqual({ mode: 'frozen', measuredOn: '2026-10-07', asOf: '2026-01-21' });
  });

  it('slugs are unique and do not collide with the static /research pages', () => {
    const slugs = PUBLICATIONS.map((p) => p.slug).filter(Boolean);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const reserved of ['about', 'how-we-publish', 'standard']) expect(slugs).not.toContain(reserved);
  });
});

describe('Truth cleanup (Release 001)', () => {
  const res003 = PUBLICATIONS.find((p) => p.id === 'RES-003')!;

  it('RES-003 cites only the metric it computes, and records the correction visibly', () => {
    expect(res003.citesMetrics).toEqual(['OBS-001']);
    expect(read('src/lib/analytics/sb-participation-benchmark.ts')).not.toMatch(/\.from\('(?!sam_opportunities)/);
    expect(res003.version).toBe('v1.1');
    expect(res003.corrections?.[0].note).toMatch(/OBS-002/);
  });

  it('RES-003 says it is live, not a frozen edition, and shows its correction', () => {
    expect(res003.measurement).toEqual({ mode: 'live' });
    const page = renderSbBenchmarkHtml(
      { rows: [], fleetActive: 1, fleetWithSetAside: 1, fleetPct: 100, agenciesRanked: 0, agenciesExcluded: 0, minActive: 50 } as never,
      { edition: '2026', version: 'v1.1', generatedDate: '2026-10-07', canonical: 'https://getmindy.ai/research/small-business-participation-benchmark', corrections: res003.corrections },
    );
    expect(page).toContain('A live benchmark, not a frozen edition.');
    expect(page).not.toContain('OBS-002</b> (Awarded');
    expect(page).not.toContain('Cites OBS-002');
    expect(page).toContain('Corrected the methodology note');
    expect(page).toContain('href="/research/standard"');
  });

  it('/research no longer says every figure is from live data', () => {
    expect(read('src/app/research/route.ts')).not.toMatch(/derived from live federal data/);
  });

  it('/research/about does not claim its counts are computed live', () => {
    expect(read('src/app/research/about/route.ts')).not.toMatch(/computed live/);
  });

  it('Competition Health documents its real sources, not BigQuery', () => {
    const src = read('src/lib/analytics/competition-health.ts');
    expect(src).not.toMatch(/\+ BigQuery awards/);
    expect(src).toContain('it does NOT query BigQuery');
  });

  it('no public research surface calls the Institute a think tank or a second institute', () => {
    for (const f of ['src/app/research/route.ts', 'src/app/research/about/route.ts', 'src/app/research/how-we-publish/route.ts', 'src/app/research/standard/route.ts', 'src/lib/analytics/sb-benchmark-html.ts', 'src/lib/analytics/transaction-studies/halvik-tetra-tech-html.ts']) {
      expect(read(f)).not.toMatch(/think[ -]tank|GovCon Giants Institute/i);
    }
  });
});
