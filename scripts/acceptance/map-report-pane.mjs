#!/usr/bin/env node
/**
 * Map → Ask Mindy report pane: preview scrolling and export (2026-11-22).
 *
 * Drives the real /opportunity-map page. Every API is served by Playwright route interception (nothing
 * reaches production or a database): /api/app/chat streams a packaged market report, and
 * /reports/<id>/pdf answers with the PDF given by --pdf (or, for the error case, the route's own 503 HTML
 * error page, which is what a browser navigation receives). Checks, on desktop
 * and phone:
 *   1. the report preview scrolls with the mouse wheel AND with the keyboard right after it opens (before
 *      the fix, focus stayed in the chat box so Page Down never reached the report);
 *   2. the dead in-frame "Save as PDF" (window.print in a script-less frame) is hidden;
 *   3. Export → Download PDF saves a file that starts with %PDF- and is byte-identical to what the route
 *      sent, and the request is a browser NAVIGATION (hidden frame), not a script fetch + blob. The blob
 *      version passed here in headless Chromium yet saved nothing in production (2026-11-22);
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
// Stand-in for a renderer bug: raw markup that would act with our cookies in a same-origin frame. The
// frame's CSP must block the request, the refresh must be gone, and the frame must not navigate.
const HOSTILE = '<img id="probe-img" src="/api/should-never-load.png"><meta http-equiv="refresh" content="0;url=/api/should-never-navigate"><meta http-equiv="&#114;efresh" content="0;url=/api/should-never-navigate-2"><base href="https://evil.example/"><a id="probe-a" href="/api/should-never-follow">x</a>';
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>.sec{padding:20px;border:1px solid #ddd;margin:12px}</style></head><body><header class="rp" style="position:relative"><h1>Facilities maintenance</h1><button class="pdfbtn" onclick="window.print()">Save as PDF</button></header>${sections}${HOSTILE}</body></html>`;
// Same shape as fail() in src/app/reports/[id]/pdf/route.ts for a non-JSON request (a navigation).
const ERROR_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PDF not available</title></head><body><div class="c"><h1>PDF not available</h1><p>We couldn't create the PDF just now. Try again in a minute. The report itself is unchanged.</p><p style="margin-top:16px"><a href="/reports/${REPORT_ID}">Back to the report</a></p></div></body></html>`;
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
for (const [label, opts] of [['desktop 1440x900', { viewport: { width: 1440, height: 900 } }], ['small window 757x485', { viewport: { width: 757, height: 485 } }], ['iPhone 13', devices['iPhone 13']]]) {
  for (const mode of ['ok', 'error']) {
    const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
    // The site's timed event popup (src/lib/events/event-popup.ts) is unrelated to this pane; mark it seen.
    await ctx.addCookies([{ name: 'mindy_lcb_popup_s', value: '1', url: base }]);
    await ctx.addInitScript((t) => { try { localStorage.setItem('mi_beta_auth_token', t); } catch {} }, `${tokPayload}.sig`);
    const page = await ctx.newPage();
    const pageErrors = [];
    const forbidden = [];
    // A request the CSP blocks is still REPORTED by the browser, then fails as blocked; only one that got a
    // response (or failed any other way) means something left the frame.
    const blocked = [];
    page.on('requestfailed', (r) => { if (/should-never|evil\.example/.test(r.url())) { const why = (r.failure() && r.failure().errorText) || ''; (/csp|blocked/i.test(why) ? blocked : forbidden).push(`${r.url()} (${why})`); } });
    page.on('response', (r) => { if (/should-never|evil\.example/.test(r.url())) forbidden.push(`${r.url()} (got ${r.status()})`); });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('**/api/app/chat', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
      { type: 'session', sessionId: '11111111-1111-4111-8111-111111111111' },
      { type: 'token', content: 'Here is your market report.' },
      { type: 'market_report', report_id: REPORT_ID, url: `${base}/reports/${REPORT_ID}`, title: 'Facilities maintenance', html: HTML },
      { type: 'done' },
    ]) }));
    let pdfRequests = 0;
    const pdfKinds = [];
    await page.route(`**/reports/${REPORT_ID}/pdf`, (r) => {
      pdfRequests++;
      pdfKinds.push(`${r.request().resourceType()}${r.request().isNavigationRequest() ? ':nav' : ''}`);
      if (mode === 'error') return r.fulfill({ status: 503, headers: { 'content-type': 'text/html; charset=utf-8' }, body: ERROR_PAGE });
      return r.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="facilities-maintenance-market-report.pdf"' }, body: PDF });
    });

    const frame = await openReport(page);
    const tag = `${label} [${mode}]`;
    if (mode === 'ok') {
      // 1. keyboard right after opening, then wheel
      // The PANE BODY scrolls: the frame is sized to its report, so a plain element of the page moves.
      const pos = () => page.$eval('.amk-rep-body', (e) => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight }));
      const fit = await page.$eval('.amk-rep-f', (f) => ({ fit: f.classList.contains('fit'), h: f.getBoundingClientRect().height, docH: f.contentDocument ? f.contentDocument.documentElement.scrollHeight : -1, innerY: getComputedStyle(f.contentDocument.documentElement).overflowY }));
      check(`${tag} frame is sized to the whole report`, fit.fit && fit.h >= fit.docH && fit.docH > 2000, JSON.stringify(fit));
      check(`${tag} the report itself is not a second vertical scroller`, fit.innerY === 'hidden', fit.innerY);
      await page.keyboard.press('PageDown'); await page.keyboard.press('PageDown'); await page.waitForTimeout(500);
      const yKey = (await pos()).top;
      check(`${tag} keyboard scrolls the preview`, yKey > 0, `scrollTop=${yKey}`);
      const box = await page.locator('.amk-rep-body').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 900); await page.waitForTimeout(500);
      const yWheel = (await pos()).top;
      check(`${tag} wheel over the report scrolls the preview`, yWheel > yKey, `scrollTop=${yWheel}`);
      await page.keyboard.press('End'); await page.waitForTimeout(500);
      const end = await pos();
      check(`${tag} the last section is reachable`, end.max > 0 && end.top >= end.max - 1, JSON.stringify(end));
      const lastVisible = await page.evaluate(() => { const b = document.querySelector('.amk-rep-body').getBoundingClientRect(); const f = document.querySelector('.amk-rep-f'); const last = [...f.contentDocument.querySelectorAll('.sec')].pop(); const r = last.getBoundingClientRect(); const fr = f.getBoundingClientRect(); return fr.top + r.bottom <= b.bottom + 1 && fr.top + r.bottom > b.top; });
      check(`${tag} the last section is on screen at the end`, lastVisible);
      await page.keyboard.press('Home'); await page.waitForTimeout(300);
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
    check(`${tag} the PDF is requested by navigation, not fetch`, pdfKinds[0] === 'document:nav', pdfKinds.join(','));
    check(`${tag} no page errors`, pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    if (mode === 'ok') {
      const lock = await page.evaluate(() => {
        const f = document.querySelector('.amk-rep-f'); const d = f.contentDocument;
        return { sandbox: f.getAttribute('sandbox'), firstInHead: d.head.firstElementChild && d.head.firstElementChild.getAttribute('http-equiv'), url: d.location.href, img: d.getElementById('probe-img') ? d.getElementById('probe-img').naturalWidth : -1, refresh: !!d.querySelector('meta[http-equiv=refresh i]'), base: !!d.querySelector('base') };
      });
      check(`${tag} frame sandbox is allow-same-origin only`, lock.sandbox === 'allow-same-origin', lock.sandbox);
      check(`${tag} a request-blocking CSP is the first element of the frame head`, lock.firstInHead === 'Content-Security-Policy', String(lock.firstInHead));
      check(`${tag} no refresh or base tag reached the frame`, !lock.refresh && !lock.base, JSON.stringify(lock));
      check(`${tag} the frame never navigated`, lock.url === 'about:srcdoc', lock.url);
      check(`${tag} nothing left the frame (the sanitizer removed the probe image's src; the CSP backs it up)`, forbidden.length === 0 && lock.img <= 0, `blocked=${blocked.join(',')} forbidden=${forbidden.join(',')}`);
      const probe = await page.evaluate(() => { const d = document.querySelector('.amk-rep-f').contentDocument; const i = d.getElementById('probe-img'); const a = d.getElementById('probe-a'); return { imgSrc: i ? i.getAttribute('src') : 'gone', aHref: a ? a.getAttribute('href') : 'gone', metas: [...d.querySelectorAll('meta')].map((m) => m.getAttribute('http-equiv') || m.getAttribute('name') || 'charset') }; });
      check(`${tag} sanitized in the live frame: no image src, no relative link, only the CSP/charset/viewport metas`, probe.imgSrc === null && probe.aHref === null && probe.metas[0] === 'Content-Security-Policy' && probe.metas.every((m) => ['Content-Security-Policy', 'charset', 'viewport'].includes(m)), JSON.stringify(probe));
    }
    await ctx.close();
  }
}
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll checks pass.');
