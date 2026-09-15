/**
 * GAO control-plane clocks — job success ≠ data advance; source advance ≠ Mindy ingest.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGaoClockPatch,
  sourceAdvanceWithoutHeldAlert,
  GAO_SOURCE_KEY,
} from './gao-instance';

describe('GAO instance clocks', () => {
  it('stamps last_poll on every real attempt, even when poll fails', () => {
    const { clocks, sourceState, alertCandidates } = buildGaoClockPatch({
      pollAt: '2026-09-15T12:00:00.000Z',
      pollOk: false,
      verifiedComplete: false,
      dataAdvanced: false,
      sourceAdvanceAt: null,
      heldPopulation: 31,
    });
    expect(clocks.last_poll).toBe('2026-09-15T12:00:00.000Z');
    expect(clocks.last_successful_check).toBeUndefined();
    expect(clocks.last_data_advance).toBeUndefined();
    expect(sourceState).toBe('unreachable');
    expect(alertCandidates.some((a) => a.kind === 'rss_unreachable')).toBe(true);
  });

  it('successful poll without data mutation does NOT advance last_data_advance', () => {
    const { clocks } = buildGaoClockPatch({
      pollAt: '2026-09-15T12:00:00.000Z',
      pollOk: true,
      verifiedComplete: true,
      dataAdvanced: false,
      sourceAdvanceAt: '2026-09-14',
      heldPopulation: 31,
    });
    expect(clocks.last_successful_check).toBe('2026-09-15T12:00:00.000Z');
    expect(clocks.last_verified_ingest).toBe('2026-09-15T12:00:00.000Z');
    expect(clocks.last_data_advance).toBeUndefined();
    expect(clocks.last_source_advance).toBe('2026-09-14T00:00:00.000Z');
    expect(clocks.upstream_population).toBeNull();
  });

  it('data advance only when held/derived data actually changed', () => {
    const { clocks } = buildGaoClockPatch({
      pollAt: '2026-09-15T12:00:00.000Z',
      pollOk: true,
      verifiedComplete: true,
      dataAdvanced: true,
      sourceAdvanceAt: '2026-09-14',
      heldPopulation: 32,
    });
    expect(clocks.last_data_advance).toBe('2026-09-15T12:00:00.000Z');
    expect(clocks.held_population).toBe(32);
  });

  it('source advance is the GAO publication date, never inferred from pollAt', () => {
    const { clocks } = buildGaoClockPatch({
      pollAt: '2026-09-15T12:00:00.000Z',
      pollOk: true,
      verifiedComplete: true,
      dataAdvanced: false,
      sourceAdvanceAt: '2026-09-10',
      heldPopulation: 31,
    });
    expect(clocks.last_source_advance).toBe('2026-09-10T00:00:00.000Z');
    expect(clocks.last_source_advance).not.toBe(clocks.last_poll);
  });

  it('alerts when source watermark advances but held did not', () => {
    const a = sourceAdvanceWithoutHeldAlert({
      priorSourceAdvance: '2026-09-10T00:00:00.000Z',
      newSourceAdvance: '2026-09-14',
      evidenceInserted: 0,
      pollAt: '2026-09-15T12:00:00.000Z',
    });
    expect(a?.kind).toBe('source_advance_without_held');
    expect(a?.fingerprintParts[0]).toBe(GAO_SOURCE_KEY);
  });

  it('does not alert source-advance-without-held when evidence was inserted', () => {
    expect(sourceAdvanceWithoutHeldAlert({
      priorSourceAdvance: '2026-09-10',
      newSourceAdvance: '2026-09-14',
      evidenceInserted: 2,
      pollAt: '2026-09-15T12:00:00.000Z',
    })).toBeNull();
  });

  it('alerts on material agency-resolution degradation', () => {
    const { alertCandidates } = buildGaoClockPatch({
      pollAt: '2026-09-15T12:00:00.000Z',
      pollOk: true,
      verifiedComplete: true,
      dataAdvanced: false,
      sourceAdvanceAt: '2026-09-14',
      heldPopulation: 31,
      resolutionRate: 0.30,
      priorResolutionRate: 0.55,
    });
    expect(alertCandidates.some((a) => a.kind === 'agency_resolution_degraded')).toBe(true);
  });
});
