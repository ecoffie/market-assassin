/**
 * Real-browser render check for the Contractors panel (now BQ-backed).
 *
 * Loads /app with an injected MI session, clicks the "Contractors" sidebar
 * item, waits for the panel, and verifies it shows the 317K BQ data (not
 * the old 2,768) with award $ + counts. Screenshots to /tmp for eyeballing.
 *
 * ⚠️ KNOWN LIMITATION (2026-06-04): /app is gated by `if (!email)` where
 * `email` is set via a SUPABASE SESSION bootstrap, NOT the MI token alone —
 * so injecting localStorage shows the sign-in screen and this script can't
 * fully drive the real /app sidebar without live Google/MS/password creds.
 * For a verified render WITHOUT /app auth, the data+render layer was checked
 * by rendering the panel's row markup against the live prod API and
 * screenshotting it (see the contractor-render-check approach in the commit
 * notes). This script stays for the day /app gets a token-only test path
 * (or run it against a local dev server with a real session).
 *
 * Run: npx tsx scripts/clickthrough-contractors-panel.mjs
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMIAuthSessionToken } from '../src/lib/two-factor-session';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const BASE = process.env.APP_BASE || 'https://mi.govcongiants.com';
const EMAIL = process.env.CLICKTHROUGH_EMAIL || 'eric@koamana.com';
const SHOT = '/tmp/contractors-panel.png';

async function main() {
  const token = createMIAuthSessionToken(EMAIL);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const logs = [];
    page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

    // Seed auth before the app reads localStorage.
    await page.goto(`${BASE}/app?email=${encodeURIComponent(EMAIL)}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((tok, email) => {
      localStorage.setItem('mi_beta_auth_token', tok);
      localStorage.setItem('mi_beta_email', email);
    }, token, EMAIL);
    await page.reload({ waitUntil: 'networkidle0' });

    // Find + click the Contractors sidebar item.
    await page.waitForFunction(
      () => [...document.querySelectorAll('button, a')].some(b => /contractors/i.test(b.textContent || '')),
      { timeout: 20000 },
    );
    const clicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, a')].find(b => /^\s*contractors\b/i.test((b.textContent || '').trim()));
      if (el) { el.click(); return el.textContent.trim().slice(0, 30); }
      return null;
    });
    console.log('clicked sidebar item:', clicked || '(not found)');

    // Wait for the panel heading + a contractor row.
    await page.waitForFunction(
      () => /award-winning federal contractors|federal contractor database/i.test(document.body.innerText),
      { timeout: 20000 },
    ).catch(() => {});

    // Give the BQ search a moment to populate.
    await new Promise(r => setTimeout(r, 4000));

    const snapshot = await page.evaluate(() => {
      const text = document.body.innerText;
      // headline count
      const countMatch = text.match(/([\d,]+)\s+award-winning federal contractors/i);
      // any big-$ contractor names rendered
      const hasLockheed = /lockheed|booz allen|leidos|general dynamics/i.test(text);
      const hasDollars = /\$[\d.]+[BM]/.test(text);
      // grab first ~5 lines mentioning a $ value
      const rows = text.split('\n').filter(l => /\$[\d.]+[BM]/.test(l)).slice(0, 5);
      return {
        headlineCount: countMatch ? countMatch[1] : null,
        hasKnownPrime: hasLockheed,
        hasDollarValues: hasDollars,
        sampleRows: rows,
        stillShows2768: /2,768|2768/.test(text),
      };
    });

    await page.screenshot({ path: SHOT, fullPage: false });

    console.log('\n── RENDER SNAPSHOT ──');
    console.log('headline count:', snapshot.headlineCount, snapshot.headlineCount && snapshot.headlineCount.replace(/,/g, '') > 100000 ? '✅ (317K-scale)' : '⚠️');
    console.log('shows known prime (Lockheed/Booz/etc):', snapshot.hasKnownPrime ? '✅' : '❌');
    console.log('shows $ award values:', snapshot.hasDollarValues ? '✅' : '❌');
    console.log('still shows old 2,768:', snapshot.stillShows2768 ? '❌ STILL OLD DATA' : '✅ no');
    console.log('sample rows:'); snapshot.sampleRows.forEach(r => console.log('  ' + r.slice(0, 80)));
    console.log('\nscreenshot:', SHOT);
    if (logs.length) { console.log('\nbrowser console:'); logs.slice(0, 10).forEach(l => console.log('  ' + l)); }

    const ok = snapshot.headlineCount && snapshot.hasKnownPrime && snapshot.hasDollarValues && !snapshot.stillShows2768;
    console.log('\n' + (ok ? '🎉 CONTRACTORS PANEL RENDERS BQ DATA CORRECTLY' : '⚠️ CHECK THE SNAPSHOT/SCREENSHOT ABOVE'));
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
