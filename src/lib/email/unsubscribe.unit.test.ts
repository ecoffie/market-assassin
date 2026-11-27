import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  unsubscribeUrl, verifyUnsubscribe, unsubscribeToken, listUnsubscribeHeaders, fillUnsubscribePlaceholder,
  UNSUBSCRIBE_URL_PLACEHOLDER,
} from './unsubscribe';

const env = { ...process.env };
beforeEach(() => { process.env.EMAIL_ACTION_SECRET = 'cur'; delete process.env.EMAIL_ACTION_SECRET_PREVIOUS; delete process.env.UNSUBSCRIBE_MAILTO; delete process.env.UNSUBSCRIBE_ACCEPT_ADMIN_LEGACY; delete process.env.EMAIL_ACTION_ACCEPT_ADMIN_LEGACY; });
afterEach(() => { process.env = { ...env }; });
const parts = (url: string) => { const u = new URL(url); return [u.searchParams.get('e'), u.searchParams.get('t')] as const; };

describe('signed unsubscribe links', () => {
  it('round-trips, normalised, and never carries the address in clear', () => {
    const url = unsubscribeUrl('  Pat@Example.COM ', 'daily_alert');
    expect(url).not.toContain('Pat@');
    expect(url).not.toContain('pat%40');
    expect(verifyUnsubscribe(...parts(url))).toBe('pat@example.com');
  });
  it('a tampered address or signature, or a bare email, never verifies (no "unsubscribe anyone")', () => {
    const [e, t] = parts(unsubscribeUrl('pat@example.com'));
    const other = Buffer.from('victim@example.com').toString('base64url');
    expect(verifyUnsubscribe(other, t)).toBeNull();
    expect(verifyUnsubscribe(e, t!.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).toBeNull();
    expect(verifyUnsubscribe('pat@example.com', null)).toBeNull();
    expect(verifyUnsubscribe(null, t)).toBeNull();
  });
  it('a link signed with the previous secret still works after rotation', () => {
    const old = unsubscribeToken('pat@example.com', 'old-secret');
    process.env.EMAIL_ACTION_SECRET_PREVIOUS = 'old-secret';
    expect(verifyUnsubscribe(Buffer.from('pat@example.com').toString('base64url'), old)).toBe('pat@example.com');
  });
  it('RFC 8058 headers: https only unless a processed mailto is configured', () => {
    const h = listUnsubscribeHeaders('pat@example.com', 'daily_alert');
    expect(h['List-Unsubscribe']).toMatch(/^<https:\/\/getmindy\.ai\/api\/unsubscribe\?[^>]+>$/);
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    process.env.UNSUBSCRIBE_MAILTO = 'unsubscribe@mail.getmindy.ai';
    expect(listUnsubscribeHeaders('pat@example.com')['List-Unsubscribe']).toMatch(/, <mailto:unsubscribe@mail\.getmindy\.ai\?subject=unsubscribe>$/);
  });
  it('fills the footer placeholder with an HTML-escaped href', () => {
    const out = fillUnsubscribePlaceholder(`<a href="${UNSUBSCRIBE_URL_PLACEHOLDER}">Unsubscribe</a>`, 'pat@example.com', 'x');
    expect(out).toMatch(/href="https:\/\/getmindy\.ai\/api\/unsubscribe\?e=[^"]+&amp;t=/);
  });
});

/** Every email template's Unsubscribe link must come from the helper (placeholder or signed URL). */
describe('no hand-built unsubscribe links in email code', () => {
  const root = join(process.cwd(), 'src');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\.|unit\.test/.test(n)) files.push(p);
    }
  };
  walk(root);
  it('no 404 / app-home / bare ?email= unsubscribe targets remain', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.includes(join('src', 'app', 'api', 'alerts', 'unsubscribe')) || f.endsWith(join('email', 'unsubscribe.ts'))) continue; // legacy endpoint; the helper's own doc
      const s = readFileSync(f, 'utf8');
      if (/\/briefings\/unsubscribe|[^/]\/unsubscribe\?email=|alerts\/unsubscribe\?email=/.test(s)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
  it('every <a …>Unsubscribe</a> href is the placeholder or a helper-built signed URL', () => {
    const bad: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/<a\s+href="([^"]*)"[^>]*>\s*Unsubscribe\s*<\/a>/gi)) {
        const href = m[1];
        const ok = href === '${UNSUBSCRIBE_URL_PLACEHOLDER}'
          || /^\$\{(trackedUrl\()?unsubscribeUrl\b/.test(href) // a local var assigned from signedUnsubscribeUrl (checked below)
          || href.includes('link.replace(');
        if (!ok) bad.push(`${f}: ${href}`);
        if (/^\$\{(trackedUrl\()?unsubscribeUrl\b/.test(href) && !/const unsubscribeUrl = signedUnsubscribeUrl\(/.test(s)) bad.push(`${f}: unsubscribeUrl not from the helper`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('legacy ADMIN_PASSWORD links keep working (unsubscribe links never expire)', () => {
  it('EMAIL_ACTION_ACCEPT_ADMIN_LEGACY=off does NOT break an unsubscribe link signed with ADMIN_PASSWORD', async () => {
    const { unsubscribeToken: tok } = await import('./unsubscribe');
    process.env.ADMIN_PASSWORD = 'admin-legacy';
    const legacy = tok('pat@example.com', 'admin-legacy');
    process.env.EMAIL_ACTION_SECRET = 'new-dedicated';
    process.env.EMAIL_ACTION_ACCEPT_ADMIN_LEGACY = 'off';
    const e = Buffer.from('pat@example.com').toString('base64url');
    expect(verifyUnsubscribe(e, legacy)).toBe('pat@example.com');
  });
  it('only UNSUBSCRIBE_ACCEPT_ADMIN_LEGACY=off retires the legacy secret for unsubscribe', async () => {
    const { unsubscribeToken: tok } = await import('./unsubscribe');
    process.env.ADMIN_PASSWORD = 'admin-legacy';
    process.env.EMAIL_ACTION_SECRET = 'new-dedicated';
    process.env.UNSUBSCRIBE_ACCEPT_ADMIN_LEGACY = 'off';
    const e = Buffer.from('pat@example.com').toString('base64url');
    expect(verifyUnsubscribe(e, tok('pat@example.com', 'admin-legacy'))).toBeNull();
    expect(verifyUnsubscribe(e, tok('pat@example.com', 'new-dedicated'))).toBe('pat@example.com');
  });
});
