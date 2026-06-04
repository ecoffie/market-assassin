/**
 * Real-browser click-through of the /agency export flow.
 *
 * Tests the actual DOM path that direct API tests can't: load the page,
 * inject a signed-in gov_buyer session (token + email in localStorage,
 * skipping the magic-link email), type a search, click "Run market
 * research", then click "Export determination memo (.docx)" and confirm a
 * real .docx file lands on disk via the browser's download mechanism.
 *
 * Run: node scripts/clickthrough-agency-export.mjs
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const BASE = process.env.AGENCY_BASE || 'https://mi.govcongiants.com';
const PW = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const EMAIL = process.env.CLICKTHROUGH_EMAIL || 'eric@koamana.com';
const DL_DIR = '/tmp/agency-clickthrough';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function setUserType(type) {
  await sb.from('user_profiles').update({ user_type: type }).eq('email', EMAIL);
}

async function main() {
  // fresh download dir
  if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
  mkdirSync(DL_DIR, { recursive: true });

  // 1) provision + mint a real token
  await setUserType('gov_buyer');
  const tokRes = await fetch(`${BASE}/api/admin/gov-buyer-test-token?password=${PW}&email=${EMAIL}`);
  const { sessionToken } = await tokRes.json();
  if (!sessionToken) throw new Error('could not mint token');
  console.log('✓ minted gov_buyer token');

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // allow downloads to our dir
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });

    // 2) seed localStorage on the origin BEFORE the app reads it
    await page.goto(`${BASE}/agency`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((tok, email) => {
      localStorage.setItem('mi_beta_auth_token', tok);
      localStorage.setItem('mi_beta_email', email);
    }, sessionToken, EMAIL);

    // reload so the authed surface renders (not the gate)
    await page.reload({ waitUntil: 'networkidle0' });

    // 3) confirm we're past the gate (the search button exists)
    await page.waitForFunction(
      () => [...document.querySelectorAll('button')].some(b => /run market research/i.test(b.textContent || '')),
      { timeout: 15000 },
    );
    console.log('✓ authed surface rendered (past the gate)');

    // 4) fill NAICS (clear + type) and run the search
    const naicsInput = await page.$('input[placeholder="541512"]');
    await naicsInput.click({ clickCount: 3 });
    await naicsInput.type('236220');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /run market research/i.test(b.textContent || ''));
      btn?.click();
    });

    // wait for results (the export button only appears after a result)
    await page.waitForFunction(
      () => [...document.querySelectorAll('button')].some(b => /export determination memo/i.test(b.textContent || '')),
      { timeout: 20000 },
    );
    const depth = await page.evaluate(() => {
      // the big headline number
      const el = [...document.querySelectorAll('div')].find(d => /qualified small business/i.test(d.textContent || ''));
      return el ? el.parentElement?.textContent?.slice(0, 80) : '(headline not found)';
    });
    console.log('✓ search returned results —', depth?.replace(/\s+/g, ' ').trim());

    // 5) click the export button
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /export determination memo/i.test(b.textContent || ''));
      btn?.click();
    });

    // 6) wait for the file to land
    const start = Date.now();
    let file = null;
    while (Date.now() - start < 20000) {
      const files = readdirSync(DL_DIR).filter(f => f.endsWith('.docx'));
      if (files.length) { file = files[0]; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!file) throw new Error('no .docx downloaded within 20s');

    const buf = readFileSync(join(DL_DIR, file));
    const isDocx = buf.slice(0, 2).toString() === 'PK';
    console.log(`✓ downloaded: ${file} (${buf.length} bytes) — valid docx: ${isDocx ? 'YES ✅' : 'NO ❌'}`);
    if (!isDocx) throw new Error('downloaded file is not a valid docx');

    console.log('\n🎉 CLICK-THROUGH PASSED: gate → search → export → real .docx download');
  } finally {
    await browser.close();
    await setUserType('seller'); // restore
    console.log('(restored test account to seller)');
  }
}

main().catch(async (e) => {
  console.error('❌ CLICK-THROUGH FAILED:', e.message);
  try { await setUserType('seller'); } catch {}
  process.exit(1);
});
