/**
 * Screenshot regression for the hosted market report (/reports/<id>), Design & Output 2026-11-22.
 *
 * Renders the production HTML (renderStoredReportHtml) for a FULL report at phone, tablet and desktop width
 * and compares each full-page screenshot with a reviewed baseline in __baselines__/. The pixel diff runs
 * inside Chromium (canvas getImageData), so the suite needs no image library.
 *
 *   npm run test:visual                          compare against the baselines
 *   UPDATE_VISUAL_BASELINES=1 npm run test:visual  rewrite them (commit the PNGs with the change that moved them)
 *
 * Fonts differ between machines, so the threshold allows anti-aliasing noise only; regenerate baselines on
 * the machine class that runs the suite. Diff images for failures are written to __output__/ (gitignored).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FULL_REPORT } from '@/lib/market/__fixtures__/market-report-full';
import { renderStoredReportHtml } from '@/lib/market/stored-report-html';
import { CHROME, launch } from '../unit/visual/report-harness';

const DIR = join(__dirname, '__baselines__');
const OUT = join(__dirname, '__output__');
const UPDATE = !!process.env.UPDATE_VISUAL_BASELINES;
/** Share of pixels allowed to differ, and how far a channel may move before a pixel counts as different. */
const MAX_DIFF_RATIO = 0.005;
const CHANNEL_TOLERANCE = 32;

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

type Page = {
  setViewport(v: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setContent(h: string, o: { waitUntil: string }): Promise<void>;
  screenshot(o: { fullPage: boolean; type: 'png' }): Promise<Uint8Array>;
  evaluate<T, A extends unknown[]>(fn: (...a: A) => T, ...args: A): Promise<T>;
  close(): Promise<void>;
};

describe.runIf(!!CHROME)('hosted market report — screenshots', () => {
  let browser: Awaited<ReturnType<typeof launch>>;
  const html = renderStoredReportHtml(FULL_REPORT as never, { pdfUrl: `/reports/${FULL_REPORT.id}/pdf` });

  beforeAll(async () => { browser = await launch(); mkdirSync(DIR, { recursive: true }); mkdirSync(OUT, { recursive: true }); });
  afterAll(async () => { await browser?.close(); });

  for (const vp of VIEWPORTS) {
    it(`${vp.name} ${vp.width}px: no sideways scroll, matches the baseline`, async () => {
      const page = (await browser.newPage()) as unknown as Page;
      try {
        await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: 'load' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);

        const shot = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
        const file = join(DIR, `report-${vp.name}.png`);
        if (UPDATE || !existsSync(file)) {
          writeFileSync(file, shot);
          if (!UPDATE) throw new Error(`No baseline existed; wrote ${file}. Review it, commit it, and re-run.`);
          return;
        }
        const diff = await page.evaluate(async (a: string, b: string, tol: number) => {
          const load = (src: string) => new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
          const [x, y] = await Promise.all([load(a), load(b)]);
          if (x.width !== y.width || x.height !== y.height) return { ratio: 1, size: `${y.width}x${y.height} vs baseline ${x.width}x${x.height}`, png: '' };
          const c = document.createElement('canvas'); c.width = x.width; c.height = x.height;
          const g = c.getContext('2d')!;
          g.drawImage(x, 0, 0); const A = g.getImageData(0, 0, c.width, c.height);
          g.drawImage(y, 0, 0); const B = g.getImageData(0, 0, c.width, c.height);
          const D = g.createImageData(c.width, c.height);
          let bad = 0;
          for (let i = 0; i < A.data.length; i += 4) {
            const off = Math.abs(A.data[i] - B.data[i]) > tol || Math.abs(A.data[i + 1] - B.data[i + 1]) > tol || Math.abs(A.data[i + 2] - B.data[i + 2]) > tol;
            if (off) bad++;
            D.data[i] = off ? 255 : B.data[i] * 0.3; D.data[i + 1] = off ? 0 : B.data[i + 1] * 0.3; D.data[i + 2] = off ? 0 : B.data[i + 2] * 0.3; D.data[i + 3] = 255;
          }
          g.putImageData(D, 0, 0);
          return { ratio: bad / (A.data.length / 4), size: '', png: bad ? c.toDataURL('image/png') : '' };
        }, `data:image/png;base64,${readFileSync(file).toString('base64')}`, `data:image/png;base64,${shot.toString('base64')}`, CHANNEL_TOLERANCE);

        if (diff.png) {
          writeFileSync(join(OUT, `report-${vp.name}.actual.png`), shot);
          writeFileSync(join(OUT, `report-${vp.name}.diff.png`), Buffer.from(diff.png.split(',')[1], 'base64'));
        }
        expect(diff.size, 'screenshot size changed (layout moved)').toBe('');
        expect(diff.ratio, `pixels changed; see ${OUT}`).toBeLessThanOrEqual(MAX_DIFF_RATIO);
      } finally {
        await page.close();
      }
    }, 60_000);
  }
});

describe.runIf(!CHROME)('hosted market report — screenshots (skipped: no Chromium binary here)', () => {
  it.skip('needs PUPPETEER_EXECUTABLE_PATH, /opt/pw-browsers/chromium or /usr/bin/google-chrome', () => {});
});
