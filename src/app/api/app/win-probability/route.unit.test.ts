/**
 * GET /api/app/win-probability — the branded M-Win™ for the listing hero (Eric 2026-08-04).
 *
 * The invariant this pins: M-Win is GROUNDED or it is HONEST — never a fabricated %. A signed-out
 * caller, an unauthorized caller, a caller with no profile, and an errored compute all return
 * `grounded:false` with NO score, so the hero renders "Complete profile to unlock M-Win" instead of
 * a number. Only a real profile → the real `calculateWinProbability` score (the same model
 * verify:m-scale guards). This is the [[ground_in_real_data]] rule applied to M-Win.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: vi.fn() }));
vi.mock('@/lib/smart-profile/service', () => ({ getBriefingProfile: vi.fn() }));
vi.mock('@/lib/briefings/win-probability', () => ({ calculateWinProbability: vi.fn() }));

import { GET } from './route';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getBriefingProfile } from '@/lib/smart-profile/service';
import { calculateWinProbability } from '@/lib/briefings/win-probability';

const auth = vi.mocked(requireMIAuthSession);
const loadProfile = vi.mocked(getBriefingProfile);
const scoreWin = vi.mocked(calculateWinProbability);

function req(qs: string) {
  return { url: `https://x.test/api/app/win-probability?${qs}` } as unknown as import('next/server').NextRequest;
}

describe('win-probability route — grounded or honest, never a fake %', () => {
  beforeEach(() => { auth.mockReset(); loadProfile.mockReset(); scoreWin.mockReset(); });

  it('signed out (no email) → grounded:false, NO score', async () => {
    const body = await (await GET(req(''))).json();
    expect(body).toEqual({ success: true, grounded: false, reason: 'signed_out' });
    expect(auth).not.toHaveBeenCalled();
    expect(scoreWin).not.toHaveBeenCalled();
  });

  it('unauthorized (email not owned) → grounded:false, NO score', async () => {
    auth.mockReturnValue({ ok: false } as ReturnType<typeof requireMIAuthSession>);
    const body = await (await GET(req('email=a@b.com&naics=541512'))).json();
    expect(body).toEqual({ success: true, grounded: false, reason: 'unauthorized' });
    expect(scoreWin).not.toHaveBeenCalled();
  });

  it('no profile → grounded:false, NO score (the model is NOT presented as personalized)', async () => {
    auth.mockReturnValue({ ok: true } as ReturnType<typeof requireMIAuthSession>);
    loadProfile.mockResolvedValue(null);
    const body = await (await GET(req('email=a@b.com&naics=541512'))).json();
    expect(body).toEqual({ success: true, grounded: false, reason: 'no_profile' });
    expect(scoreWin).not.toHaveBeenCalled(); // we don't even compute the base-30 for display
  });

  it('real profile → grounded:true + the real score/tier/summary from calculateWinProbability', async () => {
    auth.mockReturnValue({ ok: true } as ReturnType<typeof requireMIAuthSession>);
    loadProfile.mockResolvedValue({ email: 'a@b.com', naicsCodes: ['541512'] } as Awaited<ReturnType<typeof getBriefingProfile>>);
    scoreWin.mockReturnValue({ score: 72, tier: 'good', factors: [], summary: 'Strong NAICS + set-aside fit' } as ReturnType<typeof calculateWinProbability>);
    const body = await (await GET(req('email=a@b.com&naics=541512&setAside=WOSB&agency=Army&amount=8200000'))).json();
    expect(body.grounded).toBe(true);
    expect(body.score).toBe(72);
    expect(body.tier).toBe('good');
    expect(body.summary).toBe('Strong NAICS + set-aside fit');
    // the opp fields were threaded into the model
    expect(scoreWin).toHaveBeenCalledWith(
      expect.objectContaining({ naicsCode: '541512', setAside: 'WOSB', agency: 'Army', amount: 8200000 }),
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('compute throws → grounded:false (degrade honestly, never fake a number or 500)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    auth.mockReturnValue({ ok: true } as ReturnType<typeof requireMIAuthSession>);
    loadProfile.mockResolvedValue({ email: 'a@b.com' } as Awaited<ReturnType<typeof getBriefingProfile>>);
    scoreWin.mockImplementation(() => { throw new Error('boom'); });
    const res = await GET(req('email=a@b.com&naics=541512'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, grounded: false, reason: 'error' });
    errSpy.mockRestore();
  });
});
