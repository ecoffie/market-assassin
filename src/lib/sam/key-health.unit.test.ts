/**
 * SAM key fail-over on rejected keys (2026-11-25 production outage: SAM_API_KEY and SAM_API_KEY_2 → 401, _3 → 200;
 * the opportunity sync failed over only on 429, died on _2 and wrote nothing for ~21 hours).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SamKeyWalker, samKeySlots, markSamKeyRejected, isSamKeyRejected, withoutRejected, rejectedSamKeySlots,
  isKeyUnusableStatus, keyStatusFromError, __resetSamKeyHealthForTests,
} from './key-health';
import { classifySamSyncRuns, isCredentialError } from './sync-run-health';

const SLOTS = [
  { slot: 'SAM_API_KEY_2', key: 'dead-2' },
  { slot: 'SAM_API_KEY_3', key: 'live-3' },
  { slot: 'SAM_API_KEY', key: 'dead-base' },
];

beforeEach(() => {
  __resetSamKeyHealthForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('SamKeyWalker', () => {
  it('401 on the first slot → the next slot is used (the outage: _2 dead, _3 live)', () => {
    const w = new SamKeyWalker(SLOTS);
    expect(w.current()).toBe('dead-2');
    expect(w.fail(401)).toBe(true);
    expect(w.current()).toBe('live-3');
    expect(w.currentSlot()).toBe('SAM_API_KEY_3');
  });
  it('a rejected key stays skipped for the process: a new walker never starts on it', () => {
    new SamKeyWalker(SLOTS).fail(401);
    expect(isSamKeyRejected('dead-2')).toBe(true);
    expect(new SamKeyWalker(SLOTS).current()).toBe('live-3');
  });
  it('429 moves on for this run but is NOT remembered as dead (quota returns tomorrow)', () => {
    const w = new SamKeyWalker(SLOTS);
    w.fail(429);
    expect(w.current()).toBe('live-3');
    expect(isSamKeyRejected('dead-2')).toBe(false);
  });
  it('every key dead → no usable key and a loud message naming SLOTS and statuses, never values', () => {
    const w = new SamKeyWalker(SLOTS);
    expect(w.fail(401)).toBe(true);
    expect(w.fail(403)).toBe(true);
    expect(w.fail(401)).toBe(false);
    expect(w.current()).toBe('');
    const msg = w.message(401);
    expect(msg).toMatch(/every SAM key is unusable/);
    expect(msg).toContain('SAM_API_KEY_2=401');
    expect(msg).toContain('SAM_API_KEY_3=403');
    for (const s of SLOTS) expect(msg).not.toContain(s.key);
  });
  it('no keys configured → current() is empty, message says so', () => {
    const w = new SamKeyWalker([]);
    expect(w.current()).toBe('');
    expect(w.message(0)).toMatch(/none configured/);
  });
});

describe('shared registry', () => {
  it('slots follow the rotation order and dedupe values', () => {
    const env = { SAM_API_KEY_2: 'a', SAM_API_KEY_3: 'b', SAM_API_KEY: 'c', SAM_API_KEY_BACKUP: 'a' } as unknown as NodeJS.ProcessEnv;
    expect(samKeySlots(env).map((s) => s.slot)).toEqual(['SAM_API_KEY_2', 'SAM_API_KEY_3', 'SAM_API_KEY']);
  });
  it('only 401/403 mark a key dead; withoutRejected drops them; the slot list never carries values', () => {
    markSamKeyRejected('x', 429);
    markSamKeyRejected('y', 401);
    expect(withoutRejected(['x', 'y', 'z'])).toEqual(['x', 'z']);
    expect(JSON.stringify(rejectedSamKeySlots())).not.toContain('"y"');
  });
  it('status helpers', () => {
    expect([401, 403, 429].every(isKeyUnusableStatus)).toBe(true);
    expect(isKeyUnusableStatus(400)).toBe(false);
    expect(keyStatusFromError('SAM noticedesc HTTP 401 for abc')).toBe(401);
    expect(keyStatusFromError('timeout')).toBeNull();
  });
  it('getAllDistinctSAMKeys / getAvailableSAMKeys skip a rejected key (every rotation path)', async () => {
    vi.stubEnv('SAM_API_KEY_2', 'dead-2');
    vi.stubEnv('SAM_API_KEY_3', 'live-3');
    vi.stubEnv('SAM_API_KEY', 'dead-base');
    const { getAllDistinctSAMKeys, getAvailableSAMKeys } = await import('./utils');
    markSamKeyRejected('dead-2', 401);
    expect(getAllDistinctSAMKeys()).toEqual(['live-3', 'dead-base']);
    expect(getAvailableSAMKeys()).toEqual(['live-3']);
    vi.unstubAllEnvs();
  });
});

describe('sam-sync-watchdog run health', () => {
  it('the outage shape: a 401 run with 0 fetched after a good 01:00 run → credential failure, critical', () => {
    const r = classifySamSyncRuns([
      { status: 'completed_with_errors', total_fetched: 0, error_message: 'SAM.gov API error: 401 - Invalid Credentials' },
      { status: 'partial', total_fetched: 0, error_message: 'SAM.gov API error: 401 - Invalid Credentials' },
      { status: 'partial', total_fetched: 3000, error_message: 'SAM.gov API error: 503' },
    ]);
    expect(r.credentialFailure).toBe(true);
    expect(r.consecutiveUnproductive).toBe(2);
  });
  it('a healthy run history is not flagged; running rows are ignored', () => {
    const r = classifySamSyncRuns([
      { status: 'running', total_fetched: 0, error_message: null },
      { status: 'completed', total_fetched: 1200, error_message: null },
    ]);
    expect(r).toMatchObject({ credentialFailure: false, consecutiveUnproductive: 0 });
  });
  it('credential wording variants', () => {
    expect(isCredentialError('API_KEY_INVALID')).toBe(true);
    expect(isCredentialError('every SAM key is unusable (last 401; tried …)')).toBe(true);
    expect(isCredentialError('SAM.gov API error: 503')).toBe(false);
  });
});
