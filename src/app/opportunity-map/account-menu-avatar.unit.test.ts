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

  it('asks /api/app/me with the existing MI token header, even when email is empty', () => {
    expect(src).toContain('credentials:"same-origin"');
    expect(src).toContain('fetch("/api/app/me"');
    expect(src).toContain('x-mi-auth-token');
  });

  it('signed-out paints Log In, not a fake avatar', () => {
    expect(src).toContain('btn.innerHTML="Log In"');
    expect(src).toContain('function paintSignedOut()');
  });

  it('photo 404 falls back to initials from name/email, never "?"', () => {
    expect(src).toContain('img.onerror=function(){paintInitial(name,em);}');
    expect(src).not.toMatch(/if\(!src\)return "\?"/);
  });

  it('keeps the existing /app sign-in fallback — no new auth flow', () => {
    expect(src).toContain('location.href="/app?next="');
    expect(src).not.toContain('location.href="/signin?next=');
  });

  it('stamps VERCEL_GIT_COMMIT_SHA so live --expect-sha can pin the serving deploy', () => {
    expect(src).toContain('<!-- maps-account-build:');
    expect(src).toContain('VERCEL_GIT_COMMIT_SHA');
  });
});
