/**
 * Guard: the discovery "Saved" step and the right-column `engagement.saved` counter must count the
 * SAME tokens, and must include the anonymous save/watch events.
 *
 * Two separate bugs are pinned here:
 *  1. The route previously hardcoded the saved tokens TWICE — once in JOURNEY_STEPS and once in the
 *     engagement counter. That is how "Saved: 0 users" shipped next to "engagement.saved: 6" in the
 *     same payload. Importing the real exported constant (never a copy) is the point of this file:
 *     a mirrored token list in a test cannot detect drift in the thing it mirrors.
 *  2. `shortlist_saved` / `watch_created` shipped in PRs #1600/#1601 and no token list knew about
 *     them, so the funnel reported zero anonymous saves — identical to nobody using the feature.
 */
import { describe, it, expect } from 'vitest';
import { SAVED_TOKENS, JOURNEY_STEPS } from './route';

describe('map-funnel saved tokens', () => {
  it('counts the anonymous save and watch events', () => {
    expect(SAVED_TOKENS.has('shortlist_saved')).toBe(true);
    expect(SAVED_TOKENS.has('watch_created')).toBe(true);
  });

  it('is DERIVED from the saved step, so the two counters cannot disagree', () => {
    const step = JOURNEY_STEPS.find((s) => s.step === 'saved')!;
    expect([...SAVED_TOKENS].sort()).toEqual([...step.tokens].sort());
  });

  it('keeps the pre-existing save tokens', () => {
    for (const t of ['save_to_pipeline', 'pursuit_started', 'start_pursuit_clicked']) {
      expect(SAVED_TOKENS.has(t)).toBe(true);
    }
  });

  it('does NOT promote an anonymous save into the EXECUTION pursuit step', () => {
    // #1603 stopped the product from auto-promoting a claimed save into a pursuit ("a save is a
    // save"). Adding these tokens to the execution step would re-create that conflation in the
    // reporting layer, inflating pursuit_started with people who only bookmarked something.
    const pursuit = JOURNEY_STEPS.find((s) => s.step === 'pursuit_started')!;
    expect(pursuit.tokens).not.toContain('shortlist_saved');
    expect(pursuit.tokens).not.toContain('watch_created');
  });
});
