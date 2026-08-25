/**
 * CUTOVER GUARD — Bucket A item 4. `next` must survive the legacy signup corridor:
 *
 *   Maps route → modal signup → email link → /app/setup-password → /app/onboarding → Maps
 *
 * Each stage used to drop it, so a user who signed up from /opportunity-map/pursuits finished
 * inside the legacy /app. These assertions pin every hop plus the fallback rule.
 *
 * THE RULE: an explicit SAFE next wins; otherwise the Maps front door.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withNext, safeNext, DEFAULT_POST_AUTH_PATH } from './safe-next';

const DEEP = '/opportunity-map/pursuits';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('next survives every hop of the corridor', () => {
  it('stage 1 — the modal sends the current Maps URL with signup', () => {
    const c = code(read('src/app/opportunity-map/login-modal.ts'));
    expect(c).toContain('next:(location.pathname+location.search)');
  });

  it('stage 2/3 — the signup API forwards a VALIDATED next into the emailed setup link', () => {
    const c = code(read('src/app/api/auth/mi-signup/route.ts'));
    expect(c).toContain('withNext(');
    expect(c).toContain("typeof body.next === 'string'");
    expect(withNext('https://getmindy.ai/app/setup-password', DEEP))
      .toContain('next=%2Fopportunity-map%2Fpursuits');
  });

  it('stage 4 — setup-password forwards next into onboarding', () => {
    const c = code(read('src/app/app/setup-password/page.tsx'));
    // The CONTRACT this stage protects — a known `next` survives the hop — is unchanged.
    expect(c).toContain('withNext(');
    // ⚠️ The DESTINATION moved 2026-08-25. This asserted the literal
    // '/app/onboarding?setup=success', which was the base a signup landed on when it had
    // NO intent — the reported referral failure. postSignupPath now picks a non-legacy
    // base (/welcome when intent is unknown) and withNext still threads the Maps context.
    expect(c).toContain('postSignupPath(');
    expect(c).not.toContain('/app/onboarding');
  });

  it('stage 5 — completion returns to the EXACT Maps URL', () => {
    expect(safeNext(DEEP, '/today?onboarded=1')).toBe(DEEP);
  });
});

describe('no successful new-user flow lands in /app', () => {
  it('onboarding has NO hardcoded router.push into /app', () => {
    const c = code(read('src/app/app/onboarding/page.tsx'));
    // There were THREE completion exits (auto finish, manual finish, early return). Fixing
    // only some would leave a path still ending in the legacy product.
    expect(c).not.toMatch(/router\.push\(`\/app[?`]/);
    expect(c).not.toMatch(/router\.push\('\/app/);
  });

  it('both onboarding exits use the SHARED guard, not a local re-implementation', () => {
    const c = code(read('src/app/app/onboarding/page.tsx'));
    expect(c).toContain("from '@/lib/mindy/safe-next'");
    // The early-return branch once declared `const safeNext = …`, SHADOWING the import with a
    // weaker check that accepted "/app…". tsc stayed green because it shadowed cleanly.
    expect(c).not.toMatch(/const\s+safeNext\s*=/);
  });

  it('a next pointing back at /app is rejected', () => {
    expect(safeNext('/app?panel=vault', '/today')).toBe('/today');
  });

  it('the fallback is the Maps front door', () => {
    expect(DEFAULT_POST_AUTH_PATH.startsWith('/app')).toBe(false);
    expect(safeNext(null, `${DEFAULT_POST_AUTH_PATH}?onboarded=1`)).toBe(`${DEFAULT_POST_AUTH_PATH}?onboarded=1`);
  });
});

describe('explicit safe next WINS; onboarding must not override it', () => {
  it('a deep Maps next beats the default', () => {
    expect(safeNext(DEEP, DEFAULT_POST_AUTH_PATH)).toBe(DEEP);
    expect(safeNext(DEEP, DEFAULT_POST_AUTH_PATH)).not.toBe(DEFAULT_POST_AUTH_PATH);
  });
  it('an unsafe next does NOT win', () => {
    expect(safeNext('https://evil.com', DEFAULT_POST_AUTH_PATH)).toBe(DEFAULT_POST_AUTH_PATH);
  });
});
