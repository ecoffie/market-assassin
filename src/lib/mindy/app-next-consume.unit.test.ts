/**
 * /app must consume ?next= before painting the retired dashboard.
 * Homepage Log In must not hard-nav to /app. /signin must not rewrite to /app.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mindySignInUrl } from './universal-signin';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('/app consumes next on every successful-session exit', () => {
  const page = strip(read('src/app/app/page.tsx'));

  it('uses the shared consume helper, not a local startsWith guard', () => {
    expect(page).toContain('appAuthDestinationFromSearch');
    expect(page).toContain("from '@/lib/mindy/post-signup-destination'");
    expect(page).not.toMatch(/raw\.startsWith\('\/'\) && !raw\.startsWith\('\/\/'\)/);
  });

  it('password, 2FA, and session restore leave via location.replace', () => {
    expect(page).toContain('location.replace(appAuthDestinationFromSearch(');
    expect((page.match(/location\.replace\(appAuthDestinationFromSearch/g) || []).length)
      .toBeGreaterThanOrEqual(3);
  });

  it('OAuth goes through /app/auth/callback, not /app/onboarding', () => {
    expect(page).toContain("new URL('/app/auth/callback'");
    expect(page).not.toContain("new URL('/app/onboarding'");
    expect(page).not.toMatch(/origin\}\/app\/onboarding/);
  });

  it('does not keep a successful login on /app when next is missing', () => {
    // Password / 2FA always replace — consumeAppNext('') is /welcome.
    expect(page).not.toMatch(/if \(isSafeNext\(next\)\) \{\s*window\.location\.href = safeNext\(next\)/);
  });
});

describe('homepage / Maps Log In does not send people to /app', () => {
  it('mindySignInUrl("/") is /signin?next=/', () => {
    expect(mindySignInUrl('/')).toBe('/signin?next=%2F');
    expect(mindySignInUrl('/today')).toBe('/signin?next=%2Ftoday');
  });

  it('account-menu fallback is /signin?next=, not /app?next=', () => {
    const menu = strip(read('src/app/opportunity-map/account-menu.ts'));
    expect(menu).toContain('location.href="/signin?next="');
    expect(menu).not.toContain('location.href="/app?next="');
  });

  it('/today injects the login modal so Log In does not need the /app fallback', () => {
    const today = strip(read('src/app/today/route.ts'));
    expect(today).toContain('LOGIN_MODAL_JS');
    expect(today).toContain('LOGIN_MODAL_HTML');
  });

  it('__mapsSignIn / requireSignIn else-branches go to /signin', () => {
    const files = [
      'src/app/opportunity-map/route.ts',
      'src/app/opportunity-map/pursuits/route.ts',
      'src/app/opportunity-map/vault/route.ts',
      'src/app/opportunity-map/saved/route.ts',
      'src/app/opportunity-map/favorites/route.ts',
      'src/app/opportunity-map/reports/route.ts',
      'src/app/opportunity-map/forecasts/route.ts',
      'src/app/opportunity-map/market/route.ts',
      'src/app/opportunity-map/proposal/route.ts',
    ];
    for (const file of files) {
      const src = strip(read(file));
      expect(src, file).not.toMatch(/location\.href='\/app\?next=/);
      expect(src, file).not.toMatch(/location\.href="\/app\?next=/);
    }
  });
});

describe('/signin is not rewritten to /app', () => {
  it('next.config has no /signin → /app rewrite', () => {
    const cfg = strip(read('next.config.ts'));
    expect(cfg).not.toMatch(/source:\s*'\/signin'[\s\S]{0,180}destination:\s*'\/app'/);
  });

  it('signin page resolves next via postSignupPath so missing next is /welcome', () => {
    const src = strip(read('src/app/signin/page.tsx'));
    expect(src).toContain('postSignupPath');
    expect(src).not.toContain("safeNext(raw, '/mcp')");
  });
});
