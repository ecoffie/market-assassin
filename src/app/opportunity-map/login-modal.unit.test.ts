/**
 * CUTOVER GUARD — Bucket A item 3. The eight Maps sub-routes must offer the in-page sign-in
 * modal, never a hard dump into the legacy /app.
 *
 * Before this, each of saved / favorites / pursuits / reports / market / forecasts / vault /
 * proposal rendered `Please <a href="/app?next=…">sign in</a>`, so an anonymous OR expired
 * visitor to any of them left the Maps product entirely.
 *
 * ⚠️ ACCESS CONTRACTS ARE UNCHANGED. All eight are ENTRY-GATED (`if(!t||!em)` at load) because
 * they render the visitor's OWN data. This changes the DESTINATION of the sign-in affordance,
 * not who may enter. No route was broadened to standardise the implementation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = ['saved','favorites','pursuits','reports','market','forecasts','vault','proposal'];
const read = (r: string) => readFileSync(join(process.cwd(), `src/app/opportunity-map/${r}/route.ts`), 'utf8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('every Maps sub-route ships the shared sign-in modal', () => {
  for (const r of ROUTES) {
    it(`${r} imports and injects the ONE modal`, () => {
      const c = code(read(r));
      expect(c).toContain("from '../login-modal'");
      expect(c).toContain('${LOGIN_MODAL_CSS}');
      expect(c).toContain('${LOGIN_MODAL_HTML}');
      expect(c).toContain('${LOGIN_MODAL_JS}');
    });

    it(`${r} routes its sign-in affordance to the modal, not /app`, () => {
      const c = code(read(r));
      expect(c).toContain('window.__mapsSignIn');
      // The ONLY surviving /app reference may be the defensive else-fallback inside the shim
      // (used if the modal script fails to load). It must never be the primary path.
      const appRefs = (c.match(/\/app\?next=/g) || []).length;
      const fallback = (c.match(/else\{location\.href='\/app\?next='/g) || []).length;
      expect(appRefs).toBe(fallback);
      expect(fallback).toBeLessThanOrEqual(1);
      expect(c).not.toMatch(/<a href=\\?["']\/app\?next=[^>]*>sign in<\/a>/);
    });

    it(`${r} distinguishes an EXPIRED session from a first-time visitor`, () => {
      // Browser-verified 2026-08-23: first-time → "Sign in to open your Company Vault";
      // expired → "Sign in to continue where you left off". An expired session must recover
      // intentionally, not be greeted as a stranger.
      const c = code(read(r));
      expect(c).toContain("localStorage.getItem('mi_beta_email')");
      expect(c).toContain('continue where you left off');
    });
  }

  it('the modal is defined ONCE and shared, not copied per route', () => {
    const modal = readFileSync(join(process.cwd(), 'src/app/opportunity-map/login-modal.ts'), 'utf8');
    expect(modal).toContain('export const LOGIN_MODAL_CSS');
    expect(modal).toContain('export const LOGIN_MODAL_HTML');
    expect(modal).toContain('export const LOGIN_MODAL_JS');
    // the map itself must consume the shared copy too — no second definition
    const map = code(readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8'));
    expect(map).toContain("from './login-modal'");
    expect(map).not.toMatch(/^const LOGIN_MODAL_(CSS|HTML|JS) =/m);
  });
});
