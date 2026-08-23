import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY OUTBOUND EMAIL MUST COME FROM A RESEND-VERIFIED DOMAIN.
 *
 * MEASURED 2026-08-22, after Eric: "people are having problems with resetting their
 * passwords." The whole reset mechanism was healthy — link generation, the 303 to
 * /app/reset-password with a valid access_token, the form, and the password update all
 * verified end-to-end in a real browser against prod. The email just never arrived.
 *
 * Cause: the reset route overrode sendEmail's default with
 *     `EMAIL_FROM || 'hello@getmindy.ai'`
 * and EMAIL_FROM is EMPTY in production. Proven against the live Resend API:
 *
 *     Mindy <hello@getmindy.ai>        -> HTTP 403 "The getmindy.ai domain is not verified"
 *     Mindy <alerts@mail.getmindy.ai>  -> HTTP 200 sent
 *
 * Only `mail.getmindy.ai` is verified. `getmindy.ai` (the apex) is NOT.
 *
 * This failure mode is nasty precisely because everything else works: there is no broken
 * page and no error a user can report beyond "it didn't come". A route-local `from:` is
 * the only way to reach it, so that is what this test forbids.
 */

const SRC = join(process.cwd(), 'src');

/** The apex domain is NOT verified in Resend — only the mail. subdomain is. */
const UNVERIFIED_SENDER = /from:\s*[`'"][^`'"]*@getmindy\.ai/;
/** …but `@mail.getmindy.ai` is fine, so exclude it before matching. */
const VERIFIED = /@mail\.getmindy\.ai/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.unit\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/** Comments explain the bug and quote the bad address — strip them before matching. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('outbound email: only a Resend-verified sender', () => {
  it('no route sets a `from:` on the unverified apex domain', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = strip(readFileSync(file, 'utf8'));
      for (const line of code.split('\n')) {
        if (!UNVERIFIED_SENDER.test(line)) continue;
        if (VERIFIED.test(line)) continue; // @mail.getmindy.ai is the verified one
        offenders.push(`${file.replace(process.cwd() + '/', '')}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(offenders, `unverified sender(s) — Resend returns 403 and the mail never sends:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('sendEmail still defaults to the verified sender', () => {
    const lib = readFileSync(join(SRC, 'lib/send-email.ts'), 'utf8');
    // The default is the safety net every caller inherits when it does NOT override.
    expect(lib).toContain("process.env.EMAIL_FROM || 'alerts@mail.getmindy.ai'");
  });

  it('the password-reset route does NOT override the sender at all', () => {
    // It used to, and that is the entire bug. Inheriting the default is the fix.
    const route = strip(
      readFileSync(join(SRC, 'app/api/auth/mi-password-reset/request/route.ts'), 'utf8'),
    );
    expect(route).not.toMatch(/from:\s*[`'"]/);
  });
});
