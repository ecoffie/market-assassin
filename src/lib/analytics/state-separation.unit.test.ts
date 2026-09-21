import { describe, it, expect } from 'vitest';
import {
  JOURNEY_STEPS, SAVE_TOKENS, WATCH_TOKENS, PURSUIT_TOKENS, tokensForStep,
} from './journey-steps';

/**
 * SAVED / WATCHING / PURSUING are three different states, and the Journey
 * Analytics endpoint is the surface where they are most easily collapsed — a
 * token list is a one-line edit and the result still renders a plausible number.
 *
 * This imports the REAL constant. The pre-existing `funnel-logic.unit.test.ts`
 * keeps a local `FUNNEL_STEPS` copy to exercise the conversion arithmetic, and a
 * copy can never catch a token that moved: by 2026-09-21 that mirror had drifted
 * so far it did not contain the `saved` step at all, while production served a
 * `saved` row that was byte-identical to `pursuit_started` (58 users / 108 events
 * each). These assertions are about the thing itself, not a picture of it.
 */
describe('the three states stay three states', () => {
  const stepsByLoop = (loop: 'discovery' | 'execution') => JOURNEY_STEPS.filter((s) => s.loop === loop);

  it('no SAVE token appears in any execution step — saving does not imply pursuing', () => {
    for (const step of stepsByLoop('execution')) {
      for (const t of SAVE_TOKENS) {
        expect(step.tokens, `execution step "${step.step}" must not count the save token "${t}"`)
          .not.toContain(t);
      }
    }
  });

  it('no WATCH token appears in any execution step — watching does not imply pursuing', () => {
    for (const step of stepsByLoop('execution')) {
      for (const t of WATCH_TOKENS) {
        expect(step.tokens, `execution step "${step.step}" must not count the watch token "${t}"`)
          .not.toContain(t);
      }
    }
  });

  it('WATCHING is its own step and never folded into SAVED', () => {
    const watching = JOURNEY_STEPS.find((s) => s.step === 'watching');
    expect(watching, 'a `watching` step must exist — saved_searches is a first-class state').toBeTruthy();
    expect(watching!.loop).toBe('discovery');
    // "I want to keep this" and "tell me when this market changes" are different
    // answers; a watch must not silently inflate the save count.
    for (const t of WATCH_TOKENS) expect(tokensForStep('saved')).not.toContain(t);
  });

  it('SAVED is a strict superset of PURSUIT_STARTED, never an identical copy of it', () => {
    const saved = tokensForStep('saved');
    const pursued = tokensForStep('pursuit_started');
    expect(saved.length).toBeGreaterThan(0);
    expect(pursued.length).toBeGreaterThan(0);

    // Someone who pursued plainly kept it, so every pursuit token counts as saved…
    for (const t of pursued) expect(saved).toContain(t);

    // …but the two lists must NOT be the same set. When they were, the two steps
    // returned identical numbers and the dashboard could not show the ratio its
    // own Principle 01 asserts ("a pursuit is far rarer than a save").
    const sameSet = saved.length === pursued.length && saved.every((t) => pursued.includes(t));
    expect(sameSet, 'the discovery `saved` step must not be declared with the execution step\'s exact token set')
      .toBe(false);

    // The extra members must be the real save tokens, not incidental padding.
    for (const t of SAVE_TOKENS) expect(saved).toContain(t);
  });

  it('the real SAVE and WATCH tokens are actually read by some step', () => {
    // The Map emits all four (shortlist_saved / shortlist_attached from the
    // anonymous shortlist path, watch_created / watch_claimed from the watch
    // path). Before this, every one of them was emitted and read by NOTHING, so
    // the two features built to let anonymous visitors keep things would have
    // reported the pursuit count as their own result. Unknown is not zero, and a
    // token nobody reads is worse than unknown — it is confidently wrong.
    const allTokens = new Set(JOURNEY_STEPS.flatMap((s) => s.tokens));
    for (const t of [...SAVE_TOKENS, ...WATCH_TOKENS]) {
      expect(allTokens, `"${t}" is emitted by the Map but counted by no step`).toContain(t);
    }
  });

  it('PURSUING is only ever reached by an explicit pursuit token', () => {
    const pursued = tokensForStep('pursuit_started');
    expect([...pursued].sort()).toEqual([...PURSUIT_TOKENS].sort());
  });

  it('every step id is unique, so one step cannot silently overwrite another', () => {
    const ids = JOURNEY_STEPS.map((s) => s.step);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
