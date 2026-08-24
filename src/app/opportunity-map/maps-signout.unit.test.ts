/**
 * CUTOVER GUARD — Bucket A item 5. Maps sign-out must not detour through the legacy /app.
 *
 * The account menu ended every session with `location.href = "/app?signout=1"`. Two problems,
 * both verified:
 *   1. `signout=1` IS READ BY NOTHING — grepped the whole tree, no consumer. The redirect
 *      accomplished nothing except leaving the Maps product.
 *   2. Clearing localStorage is not a complete sign-out: `ma_access_email` is a server-set
 *      HTTP cookie that survived, and verifyUserOwnsEmail still accepts it as an identity —
 *      so the "signed-out" browser kept a credential the server would honour.
 *
 * ⚠️ SESSION TEARDOWN ONLY. No session semantics, auth policy, or account UI changed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('Maps sign-out is native', () => {
  const menu = () => code(read('src/app/opportunity-map/account-menu.ts'));

  it('no /app?signout=1 remains reachable from Maps', () => {
    expect(menu()).not.toContain('signout=1');
    expect(menu()).not.toContain('/app?signout');
  });

  it('calls the Maps-native sign-out endpoint', () => {
    expect(menu()).toContain('/api/auth/maps-signout');
  });

  it('lands on the CENTRALIZED home constant, so the apex flip stays one edit', () => {
    const c = menu();
    expect(c).toContain("from '@/lib/mindy/maps-home'");
    expect(c).toContain('MAPS_HOME_PATH');
    // Concatenated, not a `${...}` placeholder: this file builds its script by single-quoted
    // string concatenation, where a template placeholder would ship as LITERAL TEXT.
    expect(c).toContain("'var MAPS_HOME=\"' + MAPS_HOME_PATH + '\"");
    expect(c).not.toContain('var MAPS_HOME="${MAPS_HOME_PATH}"');
  });

  it('navigates only AFTER the server teardown resolves', () => {
    // A fire-and-forget fetch races unload and can leave the cookie in place.
    const c = menu();
    expect(c).toMatch(/fetch\("\/api\/auth\/maps-signout"[\s\S]{0,160}\.then\(function\(\)\{location\.href=MAPS_HOME;\}\)/);
  });

  it('a failed teardown still releases the user (never traps them)', () => {
    expect(menu()).toContain('.catch(function(){})');
  });

  it('still clears the client-side MI keys', () => {
    for (const k of ['mi_beta_auth_token', 'mi_beta_email']) {
      expect(menu()).toContain(k);
    }
  });
});

describe('the sign-out endpoint', () => {
  const route = () => code(read('src/app/api/auth/maps-signout/route.ts'));

  it('clears the server-set auth cookie', () => {
    expect(route()).toContain('ma_access_email');
    expect(route()).toContain('maxAge: 0');
  });

  it('is idempotent — GET and POST both succeed', () => {
    const c = route();
    expect(c).toContain('export async function POST');
    expect(c).toContain('export async function GET');
  });

  it('never redirects into /app', () => {
    expect(route()).not.toContain('/app');
  });

  it('the landing target is not the legacy app', () => {
    expect(MAPS_HOME_PATH.startsWith('/app')).toBe(false);
  });
});
