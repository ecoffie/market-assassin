/**
 * REGRESSION — /api/recompete and /api/forecasts must not serve data to an unauthenticated
 * or FABRICATED identity.
 *
 * Both defects were verified against PRODUCTION on 2026-08-23 before being fixed:
 *   /api/recompete  — no auth module was imported at all. An anonymous curl with no headers
 *                     returned 67 rows of incumbent/recompete data.
 *   /api/forecasts  — `hasBDAssistAccess()` was `return true` unconditionally, so the gate
 *                     only tested whether an `x-user-email` header was PRESENT. A fabricated
 *                     `nobody@example.com` returned 65 forecasts.
 *
 * These tests pin the AUTHENTICATION contract only. They deliberately assert that a valid
 * FREE session still gets in: this change closes "anonymous/fabricated → data" and must NOT
 * silently become "Free → forbidden". What Pro means is a packaging decision to make from
 * real usage after the homepage migration.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET = 'test-signing-secret-for-auth-gate';
beforeAll(() => { process.env.TWO_FACTOR_SECRET = SECRET; });

const b64u = (s: string) => Buffer.from(s).toString('base64url');

function mintToken(email: string, opts: { expired?: boolean; secret?: string } = {}) {
  const payload = b64u(JSON.stringify({
    email: email.toLowerCase().trim(),
    exp: opts.expired ? Date.now() - 60_000 : Date.now() + 600_000,
    verifiedAt: new Date().toISOString(),
    authLevel: '2fa',
  }));
  const sig = createHmac('sha256', opts.secret || SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Mirrors verifyTwoFactorSessionToken's contract: signature + expiry + email binding. */
function sessionIsValid(token: string | null, expectedEmail: string | null): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  if (createHmac('sha256', SECRET).update(payload).digest('base64url') !== sig) return false;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!p.email || !p.exp || p.exp < Date.now()) return false;
    if (expectedEmail && p.email !== expectedEmail.toLowerCase().trim()) return false;
    return true;
  } catch { return false; }
}

describe('recompete + forecasts authentication gate', () => {
  it('ANONYMOUS — no token, no header → denied (the /api/recompete production defect)', () => {
    expect(sessionIsValid(null, null)).toBe(false);
  });

  it('FABRICATED IDENTITY — an email header with no token → denied (the /api/forecasts defect)', () => {
    // This is exactly what returned 65 forecasts in production: a caller-supplied, unsigned
    // header. Presence of a string is not authentication.
    expect(sessionIsValid(null, 'nobody@example.com')).toBe(false);
  });

  it('FORGED TOKEN — signed with the wrong secret → denied', () => {
    const forged = mintToken('attacker@example.com', { secret: 'not-the-real-secret' });
    expect(sessionIsValid(forged, 'attacker@example.com')).toBe(false);
  });

  it('EXPIRED SESSION → denied', () => {
    expect(sessionIsValid(mintToken('free@example.com', { expired: true }), 'free@example.com')).toBe(false);
  });

  it('MISMATCHED EMAIL — a valid token for someone else → denied', () => {
    expect(sessionIsValid(mintToken('a@example.com'), 'b@example.com')).toBe(false);
  });

  it('VALID FREE SESSION → ALLOWED (this fix must not become a Pro gate)', () => {
    expect(sessionIsValid(mintToken('free@example.com'), 'free@example.com')).toBe(true);
  });

  it('VALID PAID SESSION → ALLOWED (identical path; tier is not consulted here)', () => {
    expect(sessionIsValid(mintToken('paid@example.com'), 'paid@example.com')).toBe(true);
  });

  it('the gate is tier-BLIND: free and paid tokens are treated identically', () => {
    const free = sessionIsValid(mintToken('free@example.com'), 'free@example.com');
    const paid = sessionIsValid(mintToken('paid@example.com'), 'paid@example.com');
    expect(free).toBe(paid);
    expect(free).toBe(true);
  });
});

/**
 * The tests above validate the session CONTRACT against a mirror of
 * verifyTwoFactorSessionToken. A mirror can never prove the ROUTES still call it — a revert
 * would leave every test above green while production served anonymous data again. These
 * assert the wiring at the source level. (A source test proves code SHIPPED, not that it
 * RUNS; the production probe after deploy is what proves the latter.)
 */
describe('the routes are actually wired to the real session check', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('/api/recompete calls requireMIAuthSession before serving', () => {
    const src = read('src/app/api/recompete/route.ts');
    expect(src).toContain("import { requireMIAuthSession }");
    expect(src).toContain('requireMIAuthSession(request, email)');
    expect(src).toContain('if (!authSession.ok) return authSession.response;');
  });

  it('/api/forecasts calls requireMIAuthSession for non-admin callers', () => {
    const src = read('src/app/api/forecasts/route.ts');
    expect(src).toContain("import { requireMIAuthSession }");
    expect(src).toContain('requireMIAuthSession(request, userEmail)');
  });

  it('the unconditional `return true` stub is GONE from /api/forecasts', () => {
    const src = read('src/app/api/forecasts/route.ts');
    // Strip comments: the fix deliberately QUOTES the old stub while explaining it, and
    // flagging that quote would be a false positive that invites deleting the explanation.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
    expect(code).not.toContain('async function hasBDAssistAccess');
  });

  it('neither route added a Pro/tier check in this change (authentication only)', () => {
    for (const p of ['src/app/api/recompete/route.ts', 'src/app/api/forecasts/route.ts']) {
      const code = read(p)
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
      expect(code).not.toContain('hasProAccess');
      expect(code).not.toContain('resolveAccess');
    }
  });
});
