/**
 * Two /app navigation bugs (2026-11-18):
 *  1. Settings › "Billing & credits" bounced back to "Alerts & matching". The tab click rewrites
 *     the URL (replaceState); the sign-in bootstrap effect was keyed on the searchParams OBJECT,
 *     so it re-ran, set isLoading, and remounted Settings on its default tab.
 *  2. Reloading any non-map panel (e.g. Proposals) dropped the user on the home panel (chat).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('/app keeps the open panel stable across URL rewrites and reloads', () => {
  it('no effect re-runs on every searchParams object change', () => {
    expect(src).not.toMatch(/\[\s*searchParams\s*[,\]]/);
  });

  it('the sign-in bootstrap is keyed on the ?email= value only', () => {
    expect(src).toContain("const emailParamValue = searchParams.get('email');");
    expect(src).toMatch(/\}, \[emailParamValue, loadUserProfile,/);
  });

  it('a reload no longer resets the panel to the home panel', () => {
    expect(src).not.toContain("nav?.type === 'reload'");
    expect(src).not.toMatch(/isReload/);
  });
});
