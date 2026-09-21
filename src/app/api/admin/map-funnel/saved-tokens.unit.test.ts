/**
 * The map-funnel "Saved" counter must be DERIVED from the journey step, never a
 * second hand-written token list.
 *
 * History: the route declared the saved tokens twice — once in its own
 * JOURNEY_STEPS and once in the right-column `savedUsers` counter ~180 lines
 * below — and the two drifted, so one payload reported two different numbers for
 * the same action. #1605 then moved the step definition into
 * `@/lib/analytics/journey-steps` as the single home.
 *
 * The three-state invariants themselves (a save/watch token never entering an
 * execution step, SAVED being a strict superset of PURSUIT_STARTED, WATCHING
 * being its own step) are guarded in `src/lib/analytics/state-separation.unit.test.ts`
 * against that same shared constant. This file guards only the thing that suite
 * does not: that the ROUTE still derives its counter instead of re-declaring it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAVE_TOKENS, WATCH_TOKENS, tokensForStep } from '@/lib/analytics/journey-steps';

const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/admin/map-funnel/route.ts'), 'utf8');

describe('the saved counter is derived, not duplicated', () => {
  it('derives its token set from the saved step', () => {
    expect(ROUTE).toMatch(/tokensForStep\('saved'\)/);
  });

  it('does not re-declare save or watch tokens as a literal in the route', () => {
    // Strip comments: the route legitimately NAMES these tokens while explaining
    // the history above, and flagging that would be a false positive.
    const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const t of [...SAVE_TOKENS, ...WATCH_TOKENS]) {
      expect(code).not.toContain(`'${t}'`);
    }
  });

  it('the saved step really does carry the anonymous save tokens', () => {
    const saved = tokensForStep('saved');
    for (const t of SAVE_TOKENS) expect(saved).toContain(t);
  });
});
