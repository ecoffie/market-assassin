import { describe, it, expect } from 'vitest';
import { stripWinnabilityClaim } from './sam-green-email-template';

/**
 * The paid brief's LLM assessment path is fed the NOTICE ONLY — no past performance, no
 * capabilities, no certifications, no vault. It cannot know whether a reader can win
 * anything, so any sentence claiming fit or odds is a fabricated claim about a real
 * business decision (the same class as the fabricated-agency bug, 2026-08-18).
 *
 * The prompt now forbids that language, but a prompt is a request, not a guarantee. This
 * deterministic guard is the backstop.
 *
 * ⚠️ LIVE PATH: `catchup-briefings` (cron_jobs, daily 10:30, enabled) calls
 * /api/admin/trigger-catchup-briefings -> generateDailyBriefFromSam. This was NOT dormant.
 */
const FALLBACK = 'Active opportunity matching your NAICS - review requirements and deadline.';

describe('stripWinnabilityClaim', () => {
  it('drops sentences that claim the reader can WIN', () => {
    for (const bad of [
      'This is highly winnable for a small business with past performance.',
      'An easy win given low competition in this NAICS.',
      'You are well-positioned to compete here.',
      'A great fit for your capabilities.',
      'Perfect for a small business like yours.',
      'Low competition makes this attractive.',
    ]) {
      expect(stripWinnabilityClaim(bad, FALLBACK)).toBe(FALLBACK);
    }
  });

  it('keeps sentences that only restate observable notice facts', () => {
    for (const ok of [
      'Presolicitation for grounds maintenance, small-business set-aside, due in 6 days.',
      'Combined synopsis with a 30-day response window.',
      'Full and open solicitation for roof repair at a DoD installation.',
    ]) {
      expect(stripWinnabilityClaim(ok, FALLBACK)).toBe(ok);
    }
  });

  it('falls back on an empty or missing sentence rather than shipping a blank', () => {
    expect(stripWinnabilityClaim('', FALLBACK)).toBe(FALLBACK);
    expect(stripWinnabilityClaim('   ', FALLBACK)).toBe(FALLBACK);
    expect(stripWinnabilityClaim(undefined as unknown as string, FALLBACK)).toBe(FALLBACK);
  });
});
