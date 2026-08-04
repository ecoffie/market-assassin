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

  // AUTH FIRST, email DERIVED from the verified token (not the client param).
  const okAuth = { ok: true, session: { email: 'a@b.com' } } as unknown as ReturnType<typeof requireMIAuthSession>;

  it('no / invalid token → grounded:false signed_out, NO score (auth is checked first)', async () => {
    auth.mockReturnValue({ ok: false } as ReturnType<typeof requireMIAuthSession>);
    const body = await (await GET(req('naics=541512'))).json();
    expect(body).toEqual({ success: true, grounded: false, reason: 'signed_out' });
    expect(scoreWin).not.toHaveBeenCalled();
  });

  it('valid token → the email comes from the SESSION, not the client param', async () => {
    auth.mockReturnValue({ ok: true, session: { email: 'real@b.com' } } as unknown as ReturnType<typeof requireMIAuthSession>);
    loadProfile.mockResolvedValue(null);
    // client sends a DIFFERENT (or empty) email — the route must ignore it and use the session's.
    await GET(req('email=spoof@x.com&naics=541512'));
    expect(loadProfile).toHaveBeenCalledWith('real@b.com'); // session email wins, client param ignored
  });

  it('no profile → grounded:false, NO score (the model is NOT presented as personalized)', async () => {
    auth.mockReturnValue(okAuth);
    loadProfile.mockResolvedValue(null);
    const body = await (await GET(req('naics=541512'))).json();
    expect(body).toEqual({ success: true, grounded: false, reason: 'no_profile' });
    expect(scoreWin).not.toHaveBeenCalled(); // we don't even compute the base-30 for display
  });

  it('real profile → grounded:true + score/tier/summary + the Pursue decision card (Why/Risks/WinFactors from factors)', async () => {
    auth.mockReturnValue(okAuth);
    loadProfile.mockResolvedValue({ email: 'a@b.com', naicsCodes: ['541512'] } as Awaited<ReturnType<typeof getBriefingProfile>>);
    scoreWin.mockReturnValue({
      score: 72, tier: 'good', summary: 'Strong NAICS + set-aside fit',
      factors: [
        { name: 'Set-aside Match', points: 25, maxPoints: 25, description: 'WOSB matches your certification', isPositive: true },
        { name: 'Agency Experience', points: 0, maxPoints: 15, description: 'No prior awards with this agency', isPositive: false },
      ],
    } as ReturnType<typeof calculateWinProbability>);
    const body = await (await GET(req('email=a@b.com&naics=541512&setAside=WOSB&agency=Army&amount=8200000'))).json();
    expect(body.grounded).toBe(true);
    expect(body.score).toBe(72);
    expect(body.tier).toBe('good');
    expect(body.summary).toBe('Strong NAICS + set-aside fit');
    // The decision card, all grounded from the SAME factors — no LLM.
    expect(body.recommendation).toBe('Pursue');                       // score 72 ≥ 60
    expect(body.why).toEqual(['WOSB matches your certification']);    // positive factor → Why
    expect(body.risks).toEqual(['No prior awards with this agency']); // negative factor → Risks
    expect(body.winFactors).toEqual(['Set-aside Match']);             // positive factor name
    // the opp fields were threaded into the model
    expect(scoreWin).toHaveBeenCalledWith(
      expect.objectContaining({ naicsCode: '541512', setAside: 'WOSB', agency: 'Army', amount: 8200000 }),
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('recommendation follows the score: Watch (45–59) and Skip (<45)', async () => {
    auth.mockReturnValue(okAuth);
    loadProfile.mockResolvedValue({ email: 'a@b.com' } as Awaited<ReturnType<typeof getBriefingProfile>>);
    scoreWin.mockReturnValue({ score: 50, tier: 'moderate', factors: [], summary: '' } as ReturnType<typeof calculateWinProbability>);
    expect((await (await GET(req('email=a@b.com&naics=1'))).json()).recommendation).toBe('Watch');
    scoreWin.mockReturnValue({ score: 32, tier: 'low', factors: [], summary: '' } as ReturnType<typeof calculateWinProbability>);
    expect((await (await GET(req('email=a@b.com&naics=1'))).json()).recommendation).toBe('Skip');
  });

  it('compute throws → grounded:false (degrade honestly, never fake a number or 500)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    auth.mockReturnValue(okAuth);
    loadProfile.mockResolvedValue({ email: 'a@b.com' } as Awaited<ReturnType<typeof getBriefingProfile>>);
    scoreWin.mockImplementation(() => { throw new Error('boom'); });
    const res = await GET(req('email=a@b.com&naics=541512'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, grounded: false, reason: 'error' });
    errSpy.mockRestore();
  });
});
