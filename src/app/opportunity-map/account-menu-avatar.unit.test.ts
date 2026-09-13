import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accountMenuHtml } from './account-menu';

const src = readFileSync(join(process.cwd(), 'src/app/opportunity-map/account-menu.ts'), 'utf8');

describe('Maps account chip is an identity avatar, not help', () => {
  it('signed-in with picture → img src, no "?"', () => {
    const html = accountMenuHtml({
      email: 'eric@govcongiants.com',
      name: 'Eric',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    });
    expect(html).toContain('src="https://lh3.googleusercontent.com/a/photo"');
    expect(html).toContain('aria-label="Account menu, Eric"');
    expect(html).not.toMatch(/mindy-acct-ini">\?</);
  });

  it('signed-in without picture → initial from email, no "?"', () => {
    const html = accountMenuHtml({ email: 'eric@govcongiants.com' });
    expect(html).toContain('<span class="mindy-acct-ini">E</span>');
    expect(html).toContain('aria-label="Account menu, eric"');
    expect(html).not.toMatch(/mindy-acct-ini">\?</);
  });

  it('signed-out default is not the authenticated "?" avatar', () => {
    const html = accountMenuHtml();
    expect(html).toContain('<svg');
    expect(html).not.toContain('mindy-acct-ini');
    expect(html).toContain('aria-label="Account menu"');
    expect(html).not.toContain('aria-label="help"');
  });

  it('photo error falls back to the initial (never an empty onerror)', () => {
    expect(src).toContain('img.onerror=function(){paintInitial(name,em);}');
    expect(src).toContain('referrerPolicy="no-referrer"');
  });

  it('decodes HMAC payload at split(".")[0], not the JWT signature slot', () => {
    expect(src).toContain('b64json(parts[0])');
    expect(src).not.toContain('t.split(".")[1]');
    expect(src).not.toMatch(/if\(!src\)return "\?"/);
  });

  it('asks /api/app/me with credentials so the mi_auth cookie is enough', () => {
    expect(src).toContain('credentials:"same-origin"');
    expect(src).toContain('fetch("/api/app/me"');
  });
});

describe('/today paints the cookie identity on first HTML', () => {
  const today = readFileSync(join(process.cwd(), 'src/app/today/route.ts'), 'utf8');

  it('reads the universal session and renders accountMenuHtml(identity)', () => {
    expect(today).toContain('getMindySessionFromCookies');
    expect(today).toContain('accountMenuHtml(identity)');
    expect(today).not.toContain('ACCOUNT_MENU_HTML');
  });
});
