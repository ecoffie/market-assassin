#!/usr/bin/env node
/**
 * Map → Ask Mindy report pane: preview scrolling and export (2026-11-22).
 *
 * Drives the real /opportunity-map page. Every API is served by Playwright route interception (nothing
 * reaches production or a database): /api/app/chat streams a packaged market report, and
 * /reports/<id>/pdf answers with the PDF given by --pdf (or a 503 for the error case). Checks, on desktop
 * and phone:
 *   1. the report preview scrolls with the mouse wheel AND with the keyboard right after it opens (before
 *      the fix, focus stayed in the chat box so Page Down never reached the report);
 *   2. the dead in-frame "Save as PDF" (window.print in a script-less frame) is hidden;
 *   3. Export → Download PDF (outside the frame) saves a file that starts with %PDF- and is byte-identical
 *      to what the route sent;
 *   4. a failed export shows the server's message in the pane, and the button offers "Try again".
 *
 * Usage:  npx next dev -p 3100
 *         node scripts/acceptance/map-report-pane.mjs --pdf <file.pdf> [--base http://localhost:3100]
 * Needs Playwright (cloud sessions: NODE_PATH=$(npm root -g)). Exits 1 on any failure.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const base = arg('--base', 'http://localhost:3100');
const pdfPath = arg('--pdf');
if (!pdfPath) { console.error('--pdf <file.pdf> is required'); process.exit(2); }
const PDF = readFileSync(pdfPath);
if (PDF.subarray(0, 5).toString('latin1') !== '%PDF-') { console.error('--pdf is not a PDF'); process.exit(2); }

const REPORT_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const sections = Array.from({ length: 30 }, (_, i) => `<div class="sec"><h2>Section ${i + 1}</h2><p>Line of report text.</p></div>`).join('');
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>.sec{padding:20px;border:1px solid #ddd;margin:12px}</style></head><body><header class="rp" style="position:relative"><h1>Facilities maintenance</h1><button class="pdfbtn" onclick="window.print()">Save as PDF</button></header>${sections}</body></html>`;
const tokPayload = Buffer.from(JSON.stringify({ email: 'fixture@example.com', exp: 9999999999 })).toString('base64url');
const sse = (evts) => evts.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

async function openReport(page) {
  await page.goto(`${base}/opportunity-map`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => typeof window.openAskMindy === 'function', null, { timeout: 60000 });
  await page.evaluate(() => {
    const later = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Maybe later');
    if (later) later.click();
    window.openAskMindy('');
  });
  await page.fill('#amk textarea', 'Make me a market report for facilities maintenance');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="amk-report-pane"].show', { timeout: 20000 });
  await page.waitForTimeout(800);
  return page.frames().find((f) => f.parentFrame() === page.mainFrame() && /srcdoc/.test(f.url()));
}

const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures.push(name); };

const browser = await chromium.launch();
for (const [label, opts] of [['desktop 1440x900', { viewport: { width: 1440, height: 900 } }], ['iPhone 13', devices['iPhone 13']]]) {
  for (const mode of ['ok', 'error']) {
    const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
    await ctx.addInitScript((t) => { try { localStorage.setItem('mi_beta_auth_token', t); } catch {} }, `${tokPayload}.sig`);
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('**/api/app/chat', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
      { type: 'session', sessionId: '11111111-1111-4111-8111-111111111111' },
      { type: 'token', content: 'Here is your market report.' },
      { type: 'market_report', report_id: REPORT_ID, url: `${base}/reports/${REPORT_ID}`, title: 'Facilities maintenance', html: HTML },
      { type: 'done' },
    ]) }));
    let pdfRequests = 0;
    await page.route(`**/reports/${REPORT_ID}/pdf`, (r) => {
      pdfRequests++;
      if (mode === 'error') return r.fulfill({ status: 503, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: false, error: 'pdf_unavailable', message: "We couldn't create the PDF just now. Try again in a minute. The report itself is unchanged." }) });
      return r.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="facilities-maintenance-market-report.pdf"' }, body: PDF });
    });

    const frame = await openReport(page);
    const tag = `${label} [${mode}]`;
    if (mode === 'ok') {
      // 1. keyboard right after opening, then wheel
      await page.keyboard.press('PageDown'); await page.keyboard.press('PageDown'); await page.waitForTimeout(500);
      const yKey = await frame.evaluate(() => scrollY);
      check(`${tag} keyboard scrolls the preview`, yKey > 0, `scrollY=${yKey}`);
      const box = await page.locator('.amk-rep-f').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 900); await page.waitForTimeout(500);
      const yWheel = await frame.evaluate(() => scrollY);
      check(`${tag} wheel scrolls the preview`, yWheel > yKey, `scrollY=${yWheel}`);
      const bodyOverflow = await page.$eval('.amk-rep-body', (e) => getComputedStyle(e).overflowY);
      check(`${tag} preview container is a scroll container (WebKit sizes iframes to content)`, bodyOverflow === 'auto', bodyOverflow);
      // 2. dead in-frame button hidden
      const inFrameBtn = await frame.evaluate(() => { const b = document.querySelector('.pdfbtn'); return b ? getComputedStyle(b).display : 'absent'; });
      check(`${tag} in-frame print button hidden`, inFrameBtn === 'none' || inFrameBtn === 'absent', inFrameBtn);
    }
    // 3/4. Export → Download PDF
    await page.click('[data-testid="amk-export-toggle"]');
    const item = page.locator('.amk-exp-panel button[data-fmt="pdf"]');
    check(`${tag} Export offers Download PDF`, (await item.textContent()) === 'Download PDF');
    if (mode === 'ok') {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), item.click()]);
      const saved = readFileSync(await dl.path());
      check(`${tag} downloads a real PDF`, saved.subarray(0, 5).toString('latin1') === '%PDF-' && saved.equals(PDF), `${saved.length} bytes`);
      check(`${tag} file name`, dl.suggestedFilename() === 'facilities-maintenance-market-report.pdf', dl.suggestedFilename());
      check(`${tag} no error shown`, await page.locator('[data-testid="amk-report-error"]').isHidden());
    } else {
      await item.click();
      const err = page.locator('[data-testid="amk-report-error"]');
      await err.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      const text = (await err.isVisible()) ? await err.textContent() : '';
      check(`${tag} failure is visible and actionable`, /Try again in a minute/.test(text), JSON.stringify(text));
      await page.click('[data-testid="amk-export-toggle"]');
      check(`${tag} button offers Try again`, (await item.textContent()) === 'Try again');
    }
    check(`${tag} one PDF request`, pdfRequests === 1, String(pdfRequests));
    check(`${tag} no page errors`, pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    await ctx.close();
  }
}
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll checks pass.');
