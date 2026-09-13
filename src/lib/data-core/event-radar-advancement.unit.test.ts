import { describe, it, expect } from 'vitest';
import { classifyEventRadarRun, type EventRadarEvidence } from './event-radar-advancement';

const ev = (o: Partial<EventRadarEvidence> = {}): EventRadarEvidence => ({
  noticesScanned: 500, newestCandidatePosted: '2026-09-13', newCandidates: 0,
  qualified: 0, upserted: 0, priorIngestAt: '2026-09-12T07:00:30Z',
  currentIngestAt: '2026-09-12T07:00:30Z', ...o,
});

/**
 * THE 09-13 AMBIGUITY. One signature — "success" + an unchanged table — was produced
 * by three different realities. These tests pin that they are now distinguishable.
 */
describe('the three quiet causes are no longer one signature', () => {
  it('UPSTREAM_QUIET: no new candidates at all', () => {
    const r = classifyEventRadarRun(ev({ newCandidates: 0, qualified: 0 }));
    expect(r.status).toBe('upstream_quiet');
    expect(r.c1Equivalent).toBe('healthy');
  });

  /** The measured 09-13 reality: 25 new notices, 0 qualified. */
  it('FILTERED_QUIET: new candidates existed, none qualified — and it is HEALTHY', () => {
    const r = classifyEventRadarRun(ev({ newCandidates: 25, qualified: 0 }));
    expect(r.status).toBe('filtered_quiet');
    expect(r.c1Equivalent).toBe('healthy');
    expect(r.detail).toContain('25');
  });

  it('INGEST_BROKEN: qualifying events existed but the destination did not move', () => {
    const r = classifyEventRadarRun(ev({ newCandidates: 25, qualified: 4, upserted: 0 }));
    expect(r.status).toBe('ingest_broken');
    expect(r.c1Equivalent).toBe('ingest_broken');
  });

  it('ADVANCING: qualifying events written and the watermark moved', () => {
    const r = classifyEventRadarRun(ev({
      newCandidates: 25, qualified: 4, upserted: 4, currentIngestAt: '2026-09-13T07:00:00Z',
    }));
    expect(r.status).toBe('advancing');
    expect(r.c1Equivalent).toBe('healthy');
  });

  it('filtered_quiet and upstream_quiet are NOT the same state', () => {
    expect(classifyEventRadarRun(ev({ newCandidates: 25 })).status)
      .not.toBe(classifyEventRadarRun(ev({ newCandidates: 0 })).status);
  });
});

describe('a failure is never reported as quiet', () => {
  it('an explicit error is ingest_broken, not quiet', () => {
    const r = classifyEventRadarRun(ev({ failed: true, newCandidates: 0, qualified: 0 }));
    expect(r.status).toBe('ingest_broken');
  });

  it('missing counts are UNMEASURED, never quiet', () => {
    for (const gap of [{ noticesScanned: null }, { newCandidates: null }, { qualified: null }]) {
      const r = classifyEventRadarRun(ev(gap as Partial<EventRadarEvidence>));
      expect(r.status).toBe('unmeasured');
      expect(r.status).not.toBe('upstream_quiet');
      expect(r.status).not.toBe('filtered_quiet');
    }
  });

  it('an unchanged table ALONE never asserts broken — that was the original ambiguity', () => {
    // Same unchanged watermark as the broken case, but nothing qualified.
    const r = classifyEventRadarRun(ev({ newCandidates: 25, qualified: 0, upserted: 0 }));
    expect(r.status).not.toBe('ingest_broken');
  });
});

describe('partial evidence is disclosed, not hidden', () => {
  /** Measured: 1,962 of 5,994 active candidates (32.7%) carry no description. */
  it('flags when candidates were judged on title alone', () => {
    const r = classifyEventRadarRun(ev({ newCandidates: 25, qualified: 0, evaluatedWithoutDescription: 25 }));
    expect(r.partialEvidence).toBe(true);
    expect(r.detail).toContain('title alone');
  });

  it('does not claim partial evidence when every candidate had text', () => {
    expect(classifyEventRadarRun(ev({ newCandidates: 25, evaluatedWithoutDescription: 0 })).partialEvidence).toBe(false);
  });
});
