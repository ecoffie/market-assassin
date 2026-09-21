/**
 * CUTOVER GUARD — Bucket A item 6. The account menu must not send users into the legacy /app.
 *
 * ⚠️ "Proposals" DELIBERATELY POINTS AT PURSUITS, NOT AT THE PROPOSAL WORKSPACE.
 *
 * Verified in a real browser 2026-08-23: /opportunity-map/proposal with no ?pursuit= renders a
 * workspace titled "Untitled pursuit" — a proposal editor for a proposal that does not exist.
 * Its loadPursuit() only auto-selects when the user happens to have EXACTLY ONE pursuit
 * (`list.length===1`); with zero or several it mounts an empty shell.
 *
 * So there is no legitimate standalone proposal destination. Pointing the menu there would
 * trade an /app escape for a Maps-native DEAD END, which is not an improvement. The workspace's
 * own back-link reads "Back to Pursuits" — Pursuits IS the parent entry point, and a proposal
 * is reached THROUGH a pursuit.
 *
 * If a real standalone proposal index is ever built, this test is the thing to update — and it
 * should be updated deliberately, with evidence, not because the URL "looks wrong".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const menu = () => {
  const src = readFileSync(join(process.cwd(), 'src/app/opportunity-map/account-menu.ts'), 'utf8');
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
};

describe('account menu destinations', () => {
  it('My Pursuits goes to the Maps-native pursuits page', () => {
    const c = menu();
    expect(c).toContain('<a href="/opportunity-map/pursuits" role="menuitem">');
    expect(c).not.toContain('/app?panel=pipeline');
  });

  it('Proposals goes to Pursuits — never a pursuit-less proposal workspace', () => {
    const c = menu();
    expect(c).toContain('<a href="/opportunity-map/pursuits" role="menuitem" id="mindyAcctProp"');
    expect(c).not.toContain('/app?panel=proposals');
    // The dead end this test exists to prevent: a bare workspace with no pursuit context.
    expect(c).not.toMatch(/id="mindyAcctProp"[^>]*href="\/opportunity-map\/proposal"/);
    expect(c).not.toContain('href="/opportunity-map/proposal"');
  });

  it('no MENU DESTINATION points into /app (item 6 scope)', () => {
    // Scoped to menu items. Two other /app references legitimately remain in this file and
    // are NOT item 6's work:
    //   • /app?panel=settings — the deliberate Bucket B `_blank` bridge (billing/security/
    //     team live only in /app today; a tab is tolerable until those are rebuilt).
    //   • /app?next= — the sign-in button's FALLBACK, used only if openSignInModal is absent.
    //     The modal is the primary path; this is the defensive branch, not a destination.
    const appLinks = (menu().match(/href="\/app[^"]*"/g) || []).sort();
    expect(appLinks).toEqual(['href="/app?next="', 'href="/app?panel=settings"']);
  });

  it('no menu item points at the legacy pipeline or proposals panels', () => {
    const c = menu();
    for (const dead of ['panel=pipeline', 'panel=proposals']) {
      expect(c).not.toContain(dead);
    }
  });
});
