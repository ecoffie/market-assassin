/**
 * Screenshot regression for the one-page capability statement (Design & Output, 2026-11-27): the print layout at
 * US Letter (8.5 x 11 in at 96 px/in) with print media, so the baseline is the PDF page itself. Same pixel-diff
 * method and tolerances as report-screens.visual.test.ts.
 *
 *   npm run test:visual                            compare against the baseline
 *   UPDATE_VISUAL_BASELINES=1 npm run test:visual  rewrite it (commit the PNG with the change that moved it)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITY_STATEMENT } from '@/lib/documents/__fixtures__/capability-statement';
import { renderHtml } from '@/lib/documents/render-html';
import { CHROME, launch } from '../unit/visual/report-harness';

const DIR = join(__dirname, '__baselines__');
const OUT = join(__dirname, '__output__');
const UPDATE = !!process.env.UPDATE_VISUAL_BASELINES;
const MAX_DIFF_RATIO = 0.005;
const CHANNEL_TOLERANCE = 32;
const FILE = join(DIR, 'capability-statement-letter-pdf.png');

type Page = {
  setViewport(v: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  emulateMediaType(t: string): Promise<void>;
  setContent(h: string, o: { waitUntil: string }): Promise<void>;
  screenshot(o: { fullPage: boolean; type: 'png' }): Promise<Uint8Array>;
  evaluate<T, A extends unknown[]>(fn: (...a: A) => T, ...args: A): Promise<T>;
  close(): Promise<void>;
};

describe.runIf(!!CHROME)('capability statement: screenshot of the PDF page', () => {
  let browser: Awaited<ReturnType<typeof launch>>;
  beforeAll(async () => { browser = await launch(); mkdirSync(DIR, { recursive: true }); mkdirSync(OUT, { recursive: true }); });
  afterAll(async () => { await browser?.close(); });

  it('US Letter print layout matches the baseline', async () => {
    const page = (await browser.newPage()) as unknown as Page;
    try {
      await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
      await page.emulateMediaType('print');
      await page.setContent(renderHtml(CAPABILITY_STATEMENT), { waitUntil: 'load' });
      const shot = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
      if (UPDATE || !existsSync(FILE)) {
        writeFileSync(FILE, shot);
        if (!UPDATE) throw new Error(`No baseline existed; wrote ${FILE}. Review it, commit it, and re-run.`);
        return;
      }
      const diff = await page.evaluate(async (a: string, b: string, tol: number) => {
        const load = (src: string) => new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
        const [x, y] = await Promise.all([load(a), load(b)]);
        if (x.width !== y.width || x.height !== y.height) return { ratio: 1, size: `${y.width}x${y.height} vs baseline ${x.width}x${x.height}` };
        const c = document.createElement('canvas'); c.width = x.width; c.height = x.height;
        const g = c.getContext('2d')!;
        g.drawImage(x, 0, 0); const A = g.getImageData(0, 0, c.width, c.height);
        g.drawImage(y, 0, 0); const B = g.getImageData(0, 0, c.width, c.height);
        let bad = 0;
        for (let i = 0; i < A.data.length; i += 4) {
          if (Math.abs(A.data[i] - B.data[i]) > tol || Math.abs(A.data[i + 1] - B.data[i + 1]) > tol || Math.abs(A.data[i + 2] - B.data[i + 2]) > tol) bad++;
        }
        return { ratio: bad / (A.data.length / 4), size: '' };
      }, `data:image/png;base64,${readFileSync(FILE).toString('base64')}`, `data:image/png;base64,${shot.toString('base64')}`, CHANNEL_TOLERANCE);
      if (diff.ratio > MAX_DIFF_RATIO) writeFileSync(join(OUT, 'capability-statement-letter-pdf.actual.png'), shot);
      expect(diff.size, 'screenshot size changed (layout moved)').toBe('');
      expect(diff.ratio, `pixels changed; see ${OUT}`).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.runIf(!CHROME)('capability statement screenshot (skipped: no Chromium binary here)', () => {
  it.skip('needs PUPPETEER_EXECUTABLE_PATH, /opt/pw-browsers/chromium or /usr/bin/google-chrome', () => {});
});
