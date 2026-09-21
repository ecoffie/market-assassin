import { describe, it, expect } from 'vitest';
import { encodeGaoClocks, decodeGaoClocks, classifyGaoFreshness, type GaoClocks } from './source-clocks';

const clocks = (o: Partial<GaoClocks> = {}): GaoClocks => ({
  lastPoll: '2026-09-13T09:00:00.000Z', lastSourceAdvance: '2026-09-10', lastIntelligenceChange: '2026-09-10T09:00:00.000Z', ...o,
});

describe('GAO three clocks', () => {
  it('round-trips through data_sources.notes and preserves human notes', () => {
    const encoded = encodeGaoClocks('Weekly GAO reports feed.', clocks());
    expect(encoded).toContain('Weekly GAO reports feed.');
    expect(decodeGaoClocks(encoded)).toEqual(clocks());
  });

  it('keeps the three clocks DISTINCT', () => {
    const c = decodeGaoClocks(encodeGaoClocks(null, clocks()))!;
    expect(c.lastPoll).not.toBe(c.lastSourceAdvance);
    expect(c.lastSourceAdvance).not.toBe(c.lastIntelligenceChange);
  });

  /** POLL SUCCESS != SOURCE ADVANCEMENT. */
  it('a fresh poll over a quiet upstream is upstream_quiet, NOT healthy and NOT broken', () => {
    const r = classifyGaoFreshness({ clocks: clocks({ lastSourceAdvance: '2026-08-01' }), now: '2026-09-13T10:00:00Z' });
    expect(r.status).toBe('upstream_quiet');
    expect(r.pollAgeDays).toBe(0);          // we polled today
    expect(r.sourceAgeDays).toBeGreaterThan(14);
  });

  /** SOURCE ADVANCEMENT != INTELLIGENCE CHANGE. */
  it('new source material with no derived change is still healthy', () => {
    const r = classifyGaoFreshness({ clocks: clocks({ lastIntelligenceChange: '2026-07-01T00:00:00Z' }), now: '2026-09-13T10:00:00Z' });
    expect(r.status).toBe('healthy');
  });

  it('a stale poll is ingest_broken even when the source looks recent', () => {
    const r = classifyGaoFreshness({ clocks: clocks({ lastPoll: '2026-09-01T09:00:00Z' }), now: '2026-09-13T10:00:00Z' });
    expect(r.status).toBe('ingest_broken');
  });

  it('a failed poll is ingest_broken, and no clocks is unmeasured (never "fresh")', () => {
    expect(classifyGaoFreshness({ clocks: clocks(), pollFailed: true }).status).toBe('ingest_broken');
    expect(classifyGaoFreshness({ clocks: null }).status).toBe('unmeasured');
  });
});
