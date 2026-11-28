/**
 * Production finding (2026-11-28): /alerts/preferences answers "Unauthorized - please sign in" to a signed-in customer
 * unless the link carries ?email=&token=. Customer-facing links without a signed token go to in-app Settings → Alerts &
 * matching instead (/app signs them in first). Token-carrying links (daily alerts, access links) keep the old page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MINDY_ALERT_SETTINGS_PATH, MINDY_PREFERENCES_URL } from './email-branding';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Links that carry a signed token or are admin-only text, with the reason each is allowed. */
const KEEP: Record<string, string> = {
  'src/app/api/cron/daily-alerts/route.ts': 'preferencesUrl carries ?email=&token=&ts= (works)',
  'src/lib/access-links.ts': 'access-link flow (Agent 4: keep)',
  'src/app/api/access-links/consume/route.ts': 'redirect after a consumed one-time access link (Agent 4: keep)',
  'src/app/api/admin/backfill-alerts/route.ts': 'admin JSON note, not customer copy',
};

describe('customer-facing links never send a reader to the token-only /alerts/preferences page', () => {
  it('the preferences destination is Settings → Alerts & matching', () => {
    expect(MINDY_ALERT_SETTINGS_PATH).toBe('/app?panel=settings&section=alerts');
    expect(MINDY_PREFERENCES_URL.endsWith('/app?panel=settings&section=alerts')).toBe(true);
  });

  it('no source outside the allowed list links to /alerts/preferences (comments and the /api endpoint aside)', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src'))) {
      const rel = relative(ROOT, file);
      if (rel.startsWith('src/app/alerts/preferences/') || KEEP[rel]) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/^\s*(\*|\/\/).*$/, '').replace(/\/\/.*$/, '');
        if (/(?<!\/api)\/alerts\/preferences/.test(code) && !/reason:/.test(code)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the email guard allows exactly Settings → Alerts (and Billing), nothing broader', () => {
    const href = (u: string) => `<a href="${u}">x</a>`;
    expect(findLegacyDestinations(href('https://getmindy.ai/app?panel=settings&amp;section=alerts'))).toEqual([]);
    expect(findLegacyDestinations(href('https://getmindy.ai/app?panel=settings&section=billing'))).toEqual([]);
    expect(findLegacyDestinations(href('https://getmindy.ai/app?panel=settings&section=profile'))).toHaveLength(1);
    expect(findLegacyDestinations(href('https://getmindy.ai/app?panel=chat'))).toHaveLength(1);
    expect(findLegacyDestinations(href('https://getmindy.ai/app'))).toHaveLength(1);
  });

  it('the no-secret fallbacks (sendEmail placeholder, unsubscribeUrl) and the unsubscribe page use the shared destination', () => {
    const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');
    expect(src('src/lib/send-email.ts')).toContain('const MINDY_UNSUB_FALLBACK = MINDY_PREFERENCES_URL;');
    expect(src('src/lib/email/unsubscribe.ts')).toMatch(/falling back to preferences[\s\S]{0,120}return MINDY_PREFERENCES_URL;/);
    expect(src('src/lib/email/unsubscribe-apply.ts')).toContain('const PREFS = MINDY_PREFERENCES_URL;');
  });
});
