/**
 * Magic-link sign-in must land where the customer was going (e.g. Market Research with a report
 * credit), SAFELY — and the credit must survive the email client opening the link in a new tab.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  sanitizeIntent, savePostLoginIntent, consumePostLoginIntent, POST_LOGIN_INTENT_TTL_MS, POST_LOGIN_INTENT_KEY,
} from './post-login-intent';
import { holdReportCredit, readReportCredit, clearReportCredit, REPORT_CREDIT_TTL_MS } from './report-credit';

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const SRC = join(__dirname, '../..');
const code = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('sanitizeIntent — only a safe /app view survives', () => {
  it('keeps panel / notice / redeem on /app', () => {
    expect(sanitizeIntent('/app?panel=research&redeem=ACCEPTCODE01&email=a%40b.com&utm_source=x'))
      .toBe('/app?panel=research&redeem=ACCEPTCODE01');
    expect(sanitizeIntent('/app?notice=abc123')).toBe('/app?notice=abc123');
  });
  it.each([
    'https://evil.com/app?panel=research', '//evil.com/app?panel=research', '/briefings?panel=research',
    '/app/onboarding?panel=research', '/federal-market-assassin', '/app', '/app?panel=<script>',
    '/app?panel=' + 'x'.repeat(65), '', null, undefined, 'javascript:alert(1)',
  ])('rejects %s', (raw) => {
    expect(sanitizeIntent(raw as string)).toBeNull();
  });
});

describe('save / consume', () => {
  it('round-trips once, then is gone', () => {
    const s = memStore();
    expect(savePostLoginIntent('/app?panel=research&redeem=ACCEPTCODE01', 1000, s)).toBe(true);
    expect(consumePostLoginIntent(2000, s)).toBe('/app?panel=research&redeem=ACCEPTCODE01');
    expect(consumePostLoginIntent(3000, s)).toBeNull();
  });
  it('expires after an hour', () => {
    const s = memStore();
    savePostLoginIntent('/app?panel=research', 0, s);
    expect(consumePostLoginIntent(POST_LOGIN_INTENT_TTL_MS + 1, s)).toBeNull();
  });
  it('does not store an unsafe view at all', () => {
    const s = memStore();
    expect(savePostLoginIntent('/briefings?panel=research', 0, s)).toBe(false);
    expect(s.m.has(POST_LOGIN_INTENT_KEY)).toBe(false);
  });
  it('a tampered stored value is re-sanitized on the way out', () => {
    const s = memStore();
    s.setItem(POST_LOGIN_INTENT_KEY, JSON.stringify({ intent: 'https://evil.com/app?panel=research', at: 0 }));
    expect(consumePostLoginIntent(1, s)).toBeNull();
  });
});

describe('report credit — localStorage with expiry (survives a new tab)', () => {
  it('holds, reads, clears', () => {
    const s = memStore();
    expect(holdReportCredit('acceptcode01', 0, s)).toBe(true);
    expect(readReportCredit(1, s)).toBe('ACCEPTCODE01');
    clearReportCredit(s);
    expect(readReportCredit(2, s)).toBeNull();
  });
  it('expires after 24h and rejects malformed codes', () => {
    const s = memStore();
    holdReportCredit('ACCEPTCODE01', 0, s);
    expect(readReportCredit(REPORT_CREDIT_TTL_MS + 1, s)).toBeNull();
    expect(holdReportCredit('<x>', 0, s)).toBe(false);
  });
  it('is no longer sessionStorage (per-tab storage dropped the credit through sign-in)', () => {
    expect(code('lib/mindy/report-credit.ts')).not.toContain('sessionStorage');
  });
});

describe('wiring', () => {
  const app = code('app/app/page.tsx');
  it('/app saves the view BEFORE requesting a magic link', () => {
    const i = app.indexOf('savePostLoginIntent(');
    const j = app.indexOf("fetch('/api/auth/mindy-magic-link/request'");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });
  it('/app re-applies it after sign-in, only when the URL names no panel', () => {
    expect(app).toMatch(/!new URLSearchParams\(window\.location\.search\)\.get\('panel'\)[\s\S]{0,80}consumePostLoginIntent\(\)/);
  });
  it('the shared alert-preferences page is Mindy-branded', () => {
    const prefs = code('app/alerts/preferences/page.tsx');
    expect(prefs).toContain('<MindyLogo');
    expect(prefs).not.toMatch(/GovCon Giants|>GC</);
  });
});
