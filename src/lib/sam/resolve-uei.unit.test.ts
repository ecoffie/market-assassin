/**
 * WEBINAR ACCEPTANCE TESTS — the scenarios a live audience will actually hit.
 *
 * The governing rule: an UPSTREAM failure must NEVER be rendered as "invalid UEI" or
 * "not found". Existence comes from the local mirror; live SAM only enriches.
 *
 * Every test here maps to something that can happen on stage on Wednesday.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLocal = vi.fn();
const mockLive = vi.fn();
vi.mock('./entity-local-fallback', () => ({ localEntityByUEI: (u: string) => mockLocal(u) }));
vi.mock('./entity-api', () => ({ getEntityByUEI: (u: string) => mockLive(u) }));

const { resolveUei, ueiMessage, isWellFormedUei } = await import('./resolve-uei');

const LOCAL_HIT = {
  entity: { ueiSAM: 'C126Y284ZBC6', legalBusinessName: 'JAM SYSTEMS LLC', registrationStatus: 'Active' },
  asOf: '2026-08-24',
};
const LIVE_HIT = { ueiSAM: 'C126Y284ZBC6', legalBusinessName: 'JAM SYSTEMS LLC', registrationStatus: 'Active' };

beforeEach(() => { mockLocal.mockReset(); mockLive.mockReset(); });

describe('WEBINAR: an attendee types their own UEI', () => {
  it('SAM is healthy → found, live, not degraded', async () => {
    mockLocal.mockResolvedValue(LOCAL_HIT); mockLive.mockResolvedValue(LIVE_HIT);
    const r = await resolveUei('C126Y284ZBC6');
    expect(r.resolution).toBe('found');
    expect(r.source).toBe('live');
    expect(r.degraded).toBe(false);
  });

  it('⚠️ THE DEFECT: SAM is DOWN but the company is in our mirror → STILL FOUND', async () => {
    mockLocal.mockResolvedValue(LOCAL_HIT);
    mockLive.mockRejectedValue(new Error('SAM entity lookup unavailable: all API keys are rate-limited (429)'));
    const r = await resolveUei('C126Y284ZBC6');
    expect(r.resolution).toBe('found');          // NOT not_found
    expect(r.source).toBe('local');
    expect(r.degraded).toBe(true);
    expect(r.entity?.legalBusinessName).toBe('JAM SYSTEMS LLC');
    // and the message dates the record rather than implying a live check
    expect(ueiMessage(r)).toContain('2026-08-24');
  });

  it('SAM keys all DEAD (401) → still found from local', async () => {
    mockLocal.mockResolvedValue(LOCAL_HIT);
    mockLive.mockRejectedValue(new Error('all API keys were rejected by SAM (401)'));
    expect((await resolveUei('C126Y284ZBC6')).resolution).toBe('found');
  });

  it('a BRAND NEW registration (live has it, mirror does not) → found', async () => {
    mockLocal.mockResolvedValue(null); mockLive.mockResolvedValue(LIVE_HIT);
    const r = await resolveUei('C126Y284ZBC6');
    expect(r.resolution).toBe('found');
    expect(r.source).toBe('live');
  });
});

describe('NEVER render an upstream failure as absence or invalidity', () => {
  it('BOTH sources fail → unavailable, never not_found', async () => {
    mockLocal.mockRejectedValue(new Error('mirror down'));
    mockLive.mockRejectedValue(new Error('SAM down'));
    const r = await resolveUei('C126Y284ZBC6');
    expect(r.resolution).toBe('unavailable');
    expect(r.resolution).not.toBe('not_found');
    expect(r.resolution).not.toBe('malformed');
  });

  it('mirror unreachable + live says no → unavailable (we did NOT establish absence)', async () => {
    mockLocal.mockRejectedValue(new Error('PostgREST unreachable'));
    mockLive.mockResolvedValue(null);
    expect((await resolveUei('C126Y284ZBC6')).resolution).toBe('unavailable');
  });

  it('live fails + mirror says no → unavailable, NOT not_found', async () => {
    mockLocal.mockResolvedValue(null);
    mockLive.mockRejectedValue(new Error('SAM 500'));
    const r = await resolveUei('C126Y284ZBC6');
    expect(r.resolution).toBe('unavailable');
    expect(r.degraded).toBe(true);
  });

  it('the unavailable MESSAGE blames us, not the user', async () => {
    mockLocal.mockRejectedValue(new Error('x')); mockLive.mockRejectedValue(new Error('y'));
    const msg = ueiMessage(await resolveUei('C126Y284ZBC6'));
    expect(msg).toMatch(/problem on our side/i);
    expect(msg).not.toMatch(/invalid/i);
    expect(msg).not.toMatch(/not registered/i);
    expect(msg).not.toMatch(/does not exist/i);
  });

  it('never claims "invalid UEI" for ANY upstream failure', async () => {
    for (const [l, v] of [
      [Promise.reject(new Error('a')), Promise.reject(new Error('b'))],
      [Promise.resolve(null), Promise.reject(new Error('c'))],
      [Promise.reject(new Error('d')), Promise.resolve(null)],
    ] as const) {
      mockLocal.mockReturnValue(l.catch((e: Error) => { throw e; }));
      mockLive.mockReturnValue(v.catch((e: Error) => { throw e; }));
      const r = await resolveUei('C126Y284ZBC6').catch(() => null);
      expect(r?.resolution).not.toBe('malformed');
    }
  });
});

describe('a genuine not_found is still possible (we did not over-correct)', () => {
  it('both sources answer, both say no → not_found', async () => {
    mockLocal.mockResolvedValue(null); mockLive.mockResolvedValue(null);
    const r = await resolveUei('ZZZZZZZZZZZZ');
    expect(r.resolution).toBe('not_found');
    expect(r.degraded).toBe(false);
  });
});

describe('malformed is a CLIENT fact — knowable without any upstream', () => {
  it.each([['TOOSHORT', 8], ['', 0], ['THIRTEENCHARS', 13]])('%s → malformed', async (v) => {
    const r = await resolveUei(v);
    expect(r.resolution).toBe('malformed');
    expect(mockLive).not.toHaveBeenCalled();   // never burns a SAM call on a bad shape
  });

  it('accepts I and O — rejecting a real UEI is worse than accepting a fake one', () => {
    expect(isWellFormedUei('IIIIOOOO1234')).toBe(true);
  });

  it('is case-insensitive and trims', async () => {
    mockLocal.mockResolvedValue(LOCAL_HIT); mockLive.mockResolvedValue(LIVE_HIT);
    expect((await resolveUei('  c126y284zbc6  ')).resolution).toBe('found');
  });
});

describe('provenance is never misrepresented', () => {
  it('a local hit is dated and flagged degraded — never presented as live', async () => {
    mockLocal.mockResolvedValue(LOCAL_HIT);
    mockLive.mockRejectedValue(new Error('down'));
    const r = await resolveUei('C126Y284ZBC6');
    expect(r.source).toBe('local');
    expect(r.asOf).toBe('2026-08-24');
    expect(r.degraded).toBe(true);
  });

  it('a live hit carries no stale asOf', async () => {
    mockLocal.mockResolvedValue(LOCAL_HIT); mockLive.mockResolvedValue(LIVE_HIT);
    const r = await resolveUei('C126Y284ZBC6');
    expect(r.asOf).toBeNull();
    expect(r.degraded).toBe(false);
  });
});
