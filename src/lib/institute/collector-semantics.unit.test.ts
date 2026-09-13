import { describe, it, expect } from 'vitest';
import { parseGaoRss } from './sources';
import { classifyGaoFreshness, type GaoClocks } from './source-clocks';

/**
 * Potato 1B — SCHEDULING MUST NOT WEAKEN INTEGRITY SEMANTICS.
 *
 * Each test pins one way a scheduled run could lie. The route
 * (api/cron/institute-gao-sync) maps these to distinct statuses so that
 * "the job ran" can never be mistaken for "the data advanced".
 */

const clocks = (o: Partial<GaoClocks> = {}): GaoClocks => ({
  lastPoll: '2026-09-13T09:00:00.000Z',
  lastSourceAdvance: '2026-09-10',
  lastIntelligenceChange: '2026-09-13T09:00:00.000Z',
  ...o,
});

describe('a malformed feed is not a quiet upstream', () => {
  it('unparseable XML yields ZERO documents — the route must treat this as broken, not quiet', () => {
    expect(parseGaoRss('<html>404 not found</html>')).toHaveLength(0);
    expect(parseGaoRss('')).toHaveLength(0);
    expect(parseGaoRss('{"json":"not rss"}')).toHaveLength(0);
  });

  it('items without a product link are skipped rather than half-ingested', () => {
    const xml = `<rss><channel>
      <item><title>No link here</title><pubDate>Thu, 10 Sep 2026 07:00:00 -0400</pubDate></item>
      <item><title>Real One</title><link>https://www.gao.gov/products/gao-26-111111</link>
        <pubDate>Thu, 10 Sep 2026 07:00:00 -0400</pubDate></item>
    </channel></rss>`;
    const docs = parseGaoRss(xml);
    expect(docs).toHaveLength(1);
    expect(docs[0].documentNumber).toBe('GAO-26-111111');
  });
});

describe('the watermark derives ONLY from parsed documents', () => {
  it('a feed with no parseable items yields no watermark to advance', () => {
    const docs = parseGaoRss('<rss><channel></channel></rss>');
    const watermark = docs.map((d) => d.publicationDate).filter(Boolean).sort().at(-1) ?? null;
    expect(watermark).toBeNull();   // nothing to stamp — the route must not advance it
  });

  it('takes the max publication date across items, not the first', () => {
    const xml = `<rss><channel>
      <item><title>Older</title><link>https://www.gao.gov/products/gao-26-000001</link>
        <pubDate>Mon, 01 Sep 2026 07:00:00 -0400</pubDate></item>
      <item><title>Newer</title><link>https://www.gao.gov/products/gao-26-000002</link>
        <pubDate>Thu, 10 Sep 2026 07:00:00 -0400</pubDate></item>
    </channel></rss>`;
    const docs = parseGaoRss(xml);
    expect(docs.map((d) => d.publicationDate).filter(Boolean).sort().at(-1)).toBe('2026-09-10');
  });
});

describe('poll success is never data advancement', () => {
  it('polled today over a long-quiet upstream reads upstream_quiet, not healthy-fresh', () => {
    const r = classifyGaoFreshness({ clocks: clocks({ lastSourceAdvance: '2026-07-01' }), now: '2026-09-13T10:00:00Z' });
    expect(r.status).toBe('upstream_quiet');
    expect(r.pollAgeDays).toBe(0);
  });

  it('a recently quiet feed (days, not weeks) is still healthy', () => {
    const r = classifyGaoFreshness({ clocks: clocks(), now: '2026-09-13T10:00:00Z' });
    expect(r.status).toBe('healthy');
  });

  it('a stale POLL is ingest_broken even when the source looks recent', () => {
    const r = classifyGaoFreshness({ clocks: clocks({ lastPoll: '2026-09-01T09:00:00Z' }), now: '2026-09-13T10:00:00Z' });
    expect(r.status).toBe('ingest_broken');
  });

  it('a failed poll is ingest_broken; absent clocks are unmeasured — never "fresh"', () => {
    expect(classifyGaoFreshness({ clocks: clocks(), pollFailed: true }).status).toBe('ingest_broken');
    expect(classifyGaoFreshness({ clocks: null }).status).toBe('unmeasured');
  });
});

describe('the four clocks stay independent', () => {
  it('source and intelligence clocks can lag the poll clock without being "stale"', () => {
    const c = clocks({ lastSourceAdvance: '2026-09-10', lastIntelligenceChange: '2026-09-11T00:00:00Z' });
    expect(c.lastPoll).not.toBe(c.lastSourceAdvance);
    expect(c.lastSourceAdvance).not.toBe(c.lastIntelligenceChange);
    expect(classifyGaoFreshness({ clocks: c, now: '2026-09-13T10:00:00Z' }).status).toBe('healthy');
  });
});
