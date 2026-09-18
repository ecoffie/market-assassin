import { describe, it, expect } from 'vitest';
import {
  encodeLegislationClocks,
  decodeLegislationClocks,
  classifyLegislationFreshness,
  type LegislationClocks,
} from './legislation-clocks';

const clocks = (o: Partial<LegislationClocks> = {}): LegislationClocks => ({
  lastPoll: '2026-09-18T12:00:00Z',
  lastSourceAdvance: '2026-09-14',
  lastIntelligenceChange: null,
  ...o,
});

describe('legislation clocks — round trip', () => {
  it('survives encode/decode and preserves human notes', () => {
    const notes = encodeLegislationClocks('Human description of the source.', clocks());
    expect(notes).toContain('Human description of the source.');
    expect(decodeLegislationClocks(notes)).toEqual(clocks());
  });

  it('re-encoding replaces the block rather than stacking duplicates', () => {
    const once = encodeLegislationClocks('desc', clocks());
    const twice = encodeLegislationClocks(once, clocks({ lastPoll: '2026-09-25T12:00:00Z' }));
    expect(twice.match(/legislation-ingest-clocks:v1/g)).toHaveLength(1);
    expect(decodeLegislationClocks(twice)!.lastPoll).toBe('2026-09-25T12:00:00Z');
  });

  it('does not collide with the GAO clocks sentinel', () => {
    const gaoStyle = '[gao-ingest-clocks:v1]\n{"lastPoll":"2026-09-18T00:00:00Z"}\n[/gao-ingest-clocks]';
    expect(decodeLegislationClocks(gaoStyle)).toBeNull();
  });

  it('unparseable notes decode to null, not to a fabricated clock', () => {
    expect(decodeLegislationClocks(null)).toBeNull();
    expect(decodeLegislationClocks('[legislation-ingest-clocks:v1]\nnot json\n[/legislation-ingest-clocks]')).toBeNull();
  });
});

describe('legislation freshness — quiet is not broken', () => {
  const now = '2026-09-18T12:00:00Z';

  it('a recent poll with recent action is healthy', () => {
    expect(classifyLegislationFreshness({ clocks: clocks(), now }).status).toBe('healthy');
  });

  it('a long congressional recess reads as upstream_quiet, NOT broken', () => {
    // 60 days of congressional silence, but we polled today.
    const r = classifyLegislationFreshness({ clocks: clocks({ lastSourceAdvance: '2026-07-20' }), now });
    expect(r.status).toBe('upstream_quiet');
    expect(r.pollAgeDays).toBe(0);
  });

  it('a 30-day recess is still healthy — GAO thresholds would have cried wolf', () => {
    expect(classifyLegislationFreshness({ clocks: clocks({ lastSourceAdvance: '2026-08-25' }), now }).status).toBe('healthy');
  });

  it('a stale poll is ingest_broken — OUR failure, not Congress being quiet', () => {
    const r = classifyLegislationFreshness({ clocks: clocks({ lastPoll: '2026-08-01T12:00:00Z' }), now });
    expect(r.status).toBe('ingest_broken');
  });

  it('an explicit poll failure is ingest_broken regardless of clocks', () => {
    expect(classifyLegislationFreshness({ clocks: clocks(), now, pollFailed: true }).status).toBe('ingest_broken');
  });

  it('never measured is unmeasured, not healthy and not zero', () => {
    expect(classifyLegislationFreshness({ clocks: null, now }).status).toBe('unmeasured');
  });
});
