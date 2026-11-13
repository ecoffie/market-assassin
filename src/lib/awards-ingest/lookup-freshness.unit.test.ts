import { describe, expect, it } from 'vitest';
import { classifyLookupFreshness, nextLookupStatus, parseLookupStatus, encodeLookupStatus, LOOKUP_GRACE_HOURS } from './lookup-freshness';

const NOW = Date.parse('2026-11-20T13:05:00Z');
const ok = (src: string, at = '2026-11-15T15:00:00Z') => ({ at, ok: true, stage: 'done', sourceMaxActionDate: src, lastSuccess: { at, sourceMaxActionDate: src } });

describe('classifyLookupFreshness', () => {
  it('healthy when the lookups match the warehouse', () => {
    expect(classifyLookupFreshness(ok('2026-11-11'), { sourceActionMax: '2026-11-11', mergedAt: '2026-11-15T14:30:00Z' }, NOW).status).toBe('healthy');
  });
  it('alerts when the warehouse moved on and the grace window has passed (the 7-month gap)', () => {
    const f = classifyLookupFreshness(ok('2026-04-23'), { sourceActionMax: '2026-11-04', mergedAt: '2026-11-08T19:11:35Z' }, NOW);
    expect(f.status).toBe('behind-source');
    expect(f.detail).toContain('2026-04-23');
  });
  it('allows the rebuild its grace window right after a merge', () => {
    const merged = new Date(NOW - (LOOKUP_GRACE_HOURS - 1) * 3.6e6).toISOString();
    expect(classifyLookupFreshness(ok('2026-11-04'), { sourceActionMax: '2026-11-11', mergedAt: merged }, NOW).status).toBe('healthy');
  });
  it('alerts on a failed last run even if the data is not yet behind', () => {
    const failed = nextLookupStatus(ok('2026-11-04'), { at: '2026-11-15T15:00:00Z', ok: false, stage: 'validate', reasons: ['freshness mismatch'] });
    const f = classifyLookupFreshness(failed, { sourceActionMax: '2026-11-04', mergedAt: '2026-11-08T19:00:00Z' }, NOW);
    expect(f.status).toBe('last-run-failed');
    expect(f.detail).toContain('freshness mismatch');
  });
  it('alerts when nothing has ever been recorded', () => {
    expect(classifyLookupFreshness(null, { sourceActionMax: '2026-11-04' }, NOW).status).toBe('never-built');
  });
  it('reads the pre-lastSuccess row written by the 2026-11-13 production rebuild as healthy', () => {
    const legacy = '…\n\n[award-lookups:v1]\n{"at":"2026-11-13T08:33:45.536Z","ok":true,"stage":"done","reasons":[],"sourceMaxActionDate":"2026-11-04"}\n[/award-lookups]';
    expect(classifyLookupFreshness(parseLookupStatus(legacy), { sourceActionMax: '2026-11-04', mergedAt: '2026-11-08T19:11:35Z' }, NOW).status).toBe('healthy');
  });
});

describe('status record', () => {
  it('a failed run carries the last success forward', () => {
    const s = nextLookupStatus(ok('2026-11-04'), { at: 'x', ok: false, stage: 'build', reasons: ['quota'] });
    expect(s.lastSuccess).toEqual({ at: '2026-11-15T15:00:00Z', sourceMaxActionDate: '2026-11-04' });
  });
  it('round-trips through notes', () => {
    const s = ok('2026-11-04');
    expect(parseLookupStatus(encodeLookupStatus('header', s))).toEqual(s);
  });
});
