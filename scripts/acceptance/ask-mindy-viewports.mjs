#!/usr/bin/env node
/**
 * Ask Mindy (Mindy Chat) responsive acceptance — the answer area must stay usable on short desktop windows and
 * phones (2026-11-22).
 *
 * Drives the REAL MindyChatPanel through /design-fixtures/ask-mindy (local / preview builds only) with every
 * API served by Playwright route interception — nothing here talks to production or a database. For each
 * viewport it sends one question, waits for the mocked answer + suggestions, then asserts:
 *   - the page is no wider than the screen (no zoomed-out phone layout)
 *   - the message list keeps a usable height (never the ~53px strip measured before the fix)
 *   - the newest answer's source link, a next-step suggestion and the input are all reachable and on top
 *   - on a phone the history list starts closed and, when opened, overlays the chat instead of squeezing it
 *
 * Usage:  npx next dev -p 3100   then   node scripts/acceptance/ask-mindy-viewports.mjs [--base http://localhost:3100] [--banner]
 * Needs Playwright (pre-installed globally in cloud sessions: NODE_PATH=$(npm root -g)). Exits 1 on any failure.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const argv = process.argv.slice(2);
const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://localhost:3100';
const banner = argv.includes('--banner');
const MIN_LIST_PX = 120;

const ANSWER = Array.from({ length: 12 }, (_, i) =>
  `**${i + 1}.** The agency has awarded similar work for several years; the current contract ends next year.`).join('\n\n');
const sse = (evts) => evts.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const CHIP = 'Who holds this contract now?';

async function mock(page) {
  await page.route('**/api/app/chat-sessions**', (r) => r.fulfill({ json: { success: true, sessions: [] } }));
  await page.route('**/api/app/vault/**', (r) => r.fulfill({ json: { success: true } }));
  await page.route('**/api/app/chat/suggestions', (r) => r.fulfill({ json: { suggestions: [CHIP, 'Show similar open opportunities'] } }));
  await page.route('**/api/app/chat', (r) => r.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: sse([
      { type: 'session', sessionId: '11111111-1111-4111-8111-111111111111' },
      { type: 'token', content: ANSWER },
      { type: 'citations', sources: [{ title: 'SAM.gov notice', url: 'https://sam.gov/opp/1', doc_type: 'sam_notice', source_path: null, document_id: null }] },
      { type: 'done' },
    ]),
  }));
}

const VIEWPORTS = [
  ['desktop 1280x420', { viewport: { width: 1280, height: 420 } }],
  ['desktop 1366x500', { viewport: { width: 1366, height: 500 } }],
  ['desktop 1280x600', { viewport: { width: 1280, height: 600 } }],
  ['desktop 1440x900', { viewport: { width: 1440, height: 900 } }],
  ['iPhone SE', devices['iPhone SE']],
  ['iPhone 13', devices['iPhone 13']],
  ['iPhone 13 landscape', devices['iPhone 13 landscape']],
  ['Pixel 7', devices['Pixel 7']],
  ['iPad Mini', devices['iPad Mini']],
];

const failures = [];
const browser = await chromium.launch();
for (const [name, opts] of VIEWPORTS) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await mock(page);
  await page.goto(`${base}/design-fixtures/ask-mindy${banner ? '?banner=1' : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('textarea', { timeout: 60000 });
  const phone = (opts.viewport?.width ?? 1024) < 768;

  // Phone: history starts closed; opening it overlays (chat column keeps its width); New chat closes it.
  let sidebar = 'n/a';
  if (phone) {
    // Allow hydration (the closed default is applied on mount); fails if the list never closes.
    await page.waitForFunction(() => !document.querySelector('aside'), null, { timeout: 10000 }).catch(() => {});
    const before = await page.locator('aside').count();
    const colW = await page.evaluate(() => document.querySelector('[data-testid="chat-scroll"]').getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Toggle conversation history' }).click();
    const openColW = await page.evaluate(() => document.querySelector('[data-testid="chat-scroll"]').getBoundingClientRect().width);
    const overlayOk = (await page.locator('aside').count()) === 1 && Math.abs(openColW - colW) < 1;
    if (await page.locator('aside').count()) await page.getByRole('button', { name: '+ New chat' }).click();
    else await page.getByRole('button', { name: 'Toggle conversation history' }).click(); // restore what we toggled
    const closed = (await page.locator('aside').count()) === 0;
    sidebar = before === 0 && overlayOk && closed ? 'ok' : `before=${before} overlay=${overlayOk} closedAfterNew=${closed}`;
  }

  await page.fill('textarea', 'What should I know about this opportunity?');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: CHIP }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);

  const r = await page.evaluate((chip) => {
    const list = document.querySelector('[data-testid="chat-scroll"]');
    list.scrollTop = list.scrollHeight;
    const reach = (el) => {
      if (!el) return 'missing';
      el.scrollIntoView({ block: 'nearest' });
      const b = el.getBoundingClientRect();
      // Hit-test the centre (the dev-server badge sits in the bottom-left corner in dev builds).
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return b.top >= 0 && b.bottom <= innerHeight && (hit === el || el.contains(hit)) ? 'ok' : `hidden(top=${Math.round(b.top)})`;
    };
    return {
      pageW: document.documentElement.scrollWidth,
      vw: innerWidth,
      listH: Math.round(list.getBoundingClientRect().height),
      source: reach([...document.querySelectorAll('a,button')].find((a) => /SAM\.gov notice/.test(a.textContent))),
      chip: reach([...document.querySelectorAll('button')].find((b) => b.textContent.includes(chip))),
      input: reach(document.querySelector('textarea')),
    };
  }, CHIP);

  const problems = [];
  if (r.pageW > r.vw) problems.push(`page ${r.pageW}px wider than ${r.vw}px screen`);
  if (r.listH < MIN_LIST_PX) problems.push(`answer area ${r.listH}px < ${MIN_LIST_PX}px`);
  for (const k of ['source', 'chip', 'input']) if (r[k] !== 'ok') problems.push(`${k} ${r[k]}`);
  if (sidebar !== 'ok' && sidebar !== 'n/a') problems.push(`history ${sidebar}`);
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${name.padEnd(20)} list=${r.listH}px page=${r.pageW}/${r.vw} history=${sidebar}${problems.length ? '  — ' + problems.join('; ') : ''}`);
  if (problems.length) failures.push(name);
  await ctx.close();
}
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} viewport(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll viewports pass.');
