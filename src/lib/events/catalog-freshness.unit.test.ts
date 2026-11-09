import { describe, it, expect } from 'vitest';
import { catalogDateFindings, catalogLinkFindings, CATALOG_REVIEW_DAYS, type EventCatalog } from './catalog-freshness';

const cat = (over: Partial<EventCatalog> = {}): EventCatalog => ({
  lastFullReview: '2026-11-09',
  eventSources: { a: { name: 'A calendar', url: 'https://a.example.gov/events' } },
  majorAnnualConferences: [
    { name: 'Past Conf', url: 'https://b.example.org/conf', next_occurrence: { start: '2026-11-01', end: '2026-11-02' } },
    { name: 'Future Conf', url: 'https://c.example.org/conf', next_occurrence: { start: '2026-12-08', end: '2026-12-09' } },
  ],
  ...over,
});

describe('catalogDateFindings (offline, daily)', () => {
  it('flags an overdue review, read from the file itself', () => {
    expect(catalogDateFindings(cat({ lastFullReview: '2026-04-05' }), '2026-11-09').map((f) => f.kind)).toContain('review_overdue');
    expect(catalogDateFindings(cat(), '2026-11-09').map((f) => f.kind)).not.toContain('review_overdue');
    const edge = new Date(Date.parse('2026-11-09') + CATALOG_REVIEW_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(catalogDateFindings(cat(), edge).map((f) => f.kind)).not.toContain('review_overdue');
  });

  it('flags a missing review date', () => {
    expect(catalogDateFindings(cat({ lastFullReview: undefined }), '2026-11-09')[0].kind).toBe('review_missing');
  });

  it('flags dated occurrences that have ended, not future ones', () => {
    const f = catalogDateFindings(cat(), '2026-11-09').filter((x) => x.kind === 'occurrence_passed');
    expect(f.map((x) => x.entry)).toEqual(['Past Conf']);
  });
});

describe('catalogLinkFindings (weekly, never blocks CI)', () => {
  const fake = (map: Record<string, { status: number; url?: string } | 'throw'>) =>
    async (url: string) => {
      const r = map[url];
      if (r === 'throw' || !r) throw new Error('timeout');
      return { status: r.status, url: r.url ?? url };
    };

  it('404/410 and deep link redirected to a home page are broken', async () => {
    const r = await catalogLinkFindings(cat(), fake({
      'https://a.example.gov/events': { status: 404 },
      'https://b.example.org/conf': { status: 200, url: 'https://b.example.org/' },
      'https://c.example.org/conf': { status: 410 },
    }));
    expect(r.findings.map((f) => f.entry).sort()).toEqual(['A calendar', 'Future Conf', 'Past Conf']);
    expect(r.checked).toBe(3);
  });

  it('403 bot blocks, 5xx and timeouts are inconclusive, never broken', async () => {
    const r = await catalogLinkFindings(cat(), fake({
      'https://a.example.gov/events': { status: 403 },
      'https://b.example.org/conf': { status: 503 },
      'https://c.example.org/conf': 'throw',
    }));
    expect(r.findings).toEqual([]);
    expect(r.inconclusive).toBe(3);
  });

  it('a healthy page or a same-site redirect to a real path is fine', async () => {
    const r = await catalogLinkFindings(cat(), fake({
      'https://a.example.gov/events': { status: 200 },
      'https://b.example.org/conf': { status: 200, url: 'https://b.example.org/event/conf/' },
      'https://c.example.org/conf': { status: 200 },
    }));
    expect(r.findings).toEqual([]);
  });
});
