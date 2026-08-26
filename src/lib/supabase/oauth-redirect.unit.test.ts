/**
 * OAuth redirectTo must target the resolver callback, never a destination directly.
 *
 * THE BUG (2026-08-26): signInWithGoogle/Microsoft/Apple each defaulted redirectTo to
 * `/app/onboarding`. Supabase returns the user to that URL directly, so the flow never
 * reached /app/auth/callback and never ran postSignupPath() — the one resolver #1365
 * introduced. A user signing in with Microsoft landed in the retired profile builder,
 * which the SAFETY contract explicitly rejects as a destination.
 *
 * Asserted against the SOURCE because these are browser redirects handed to Supabase;
 * there is no return value to inspect. #1365's own warning was that fixing call sites
 * separately is how they drift — this pins them.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(join(__dirname, 'auth.ts'), 'utf-8');

/** Strip comments so prose explaining the bug never counts as an occurrence. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CODE = stripComments(SOURCE);

describe('OAuth redirectTo', () => {
  it('never sends a provider straight to a legacy surface', () => {
    for (const legacy of ['/app/onboarding', '/briefings']) {
      expect(
        CODE.includes(`origin}${legacy}\``),
        `redirectTo points at ${legacy}, bypassing postSignupPath()`
      ).toBe(false);
    }
  });

  it('routes every OAuth provider through the resolver callback', () => {
    const callbacks = CODE.match(/redirectTo: redirectTo \|\| `\$\{window\.location\.origin\}\/app\/auth\/callback`/g) ?? [];
    // google + microsoft(azure) + apple
    expect(callbacks.length).toBe(3);
  });

  it('still lets an explicit redirectTo win', () => {
    expect(CODE).toContain('redirectTo: redirectTo ||');
  });
});
