/**
 * Shared harness for the market-report regression tests (Design & Output, 2026-11-22).
 *
 * Every render goes through the PRODUCTION path: renderStoredReportHtml → htmlToPdf (lockdown) with the
 * route's own pdfOptions(), in a real headless Chromium. Nothing here re-implements the report.
 *
 * Chromium: PUPPETEER_EXECUTABLE_PATH, the cloud sessions' Playwright Chromium, or the Google Chrome that
 * GitHub's ubuntu runners ship. Suites using this harness skip (and say so) when none exists.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { LaunchedBrowser } from '@/lib/pdf/launch-browser';

export const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p)
  .find((p) => existsSync(p));

/** poppler reads the text layer faithfully; pdf.js (pdf-parse) drops some tabular digits. */
export const PDFTOTEXT = process.env.HARNESS_NO_PDFTOTEXT ? undefined : ['/usr/bin/pdftotext', '/usr/local/bin/pdftotext'].find((p) => existsSync(p));

export async function launch(): Promise<LaunchedBrowser> {
  const { default: puppeteer } = await import('puppeteer');
  return (await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })) as unknown as LaunchedBrowser;
}

/**
 * Compare text by letters and digits only. PDF text extraction drops hyphens at line ends, turns straight
 * quotes curly and splits words across lines; none of that is a missing word. A truncation ("fiscal year ·…")
 * or a clipped column still fails, because its words are gone.
 */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Letters only: pdf.js (the fallback reader when poppler is absent) drops tabular digits. */
export const lettersOnly = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
/** The comparison the active PDF reader supports faithfully. */
export const norm = (s: string) => (PDFTOTEXT ? squash(s) : lettersOnly(s));

/** Text of each PDF page, in order. */
export async function pdfPages(pdf: Buffer): Promise<string[]> {
  if (PDFTOTEXT) {
    const n = (await pdfPageCount(pdf));
    return Array.from({ length: n }, (_, i) =>
      execFileSync(PDFTOTEXT, ['-f', String(i + 1), '-l', String(i + 1), '-enc', 'UTF-8', '-', '-'], { input: pdf, encoding: 'utf8' }));
  }
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await parser.getText()).pages.map((p) => p.text);
  } finally {
    await parser.destroy();
  }
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await parser.getText()).total;
  } finally {
    await parser.destroy();
  }
}

/** Visible text of the report HTML, one normalised line per block (the print-hidden button excluded). */
export function htmlLines(html: string): string[] {
  const body = html
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<(button|a) class="pdfbtn"[\s\S]*?<\/\1>/g, '')
    .replace(/<\/(p|div|h1|h2|h3|td|th|li|header|footer)>|(?=<(?:div|td|th)[\s>])|<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"');
  return body.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2);
}

/** What the report looks like in PRINT layout at the PDF's content width (Letter minus side margins). */
export interface PrintLayout {
  /** Tables whose content is wider than the box they sit in (clipped or scrolled in print). */
  overflowingTables: string[];
  /** Smallest computed font size of any table cell, in CSS px. */
  minCellFontPx: number;
  /** Text cut off by ellipsis or line-clamp in print: the reader can never see the rest. */
  clippedText: string[];
}

export async function printLayout(html: string, contentWidthPx: number): Promise<PrintLayout> {
  const browser = await launch();
  try {
    const page = await browser.newPage() as unknown as {
      setViewport(v: { width: number; height: number }): Promise<void>;
      emulateMediaType(t: string): Promise<void>;
      setContent(h: string, o: { waitUntil: string }): Promise<void>;
      evaluate<T>(fn: () => T): Promise<T>;
    };
    await page.setViewport({ width: contentWidthPx, height: 1000 });
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'load' });
    return await page.evaluate(() => {
      const label = (el: Element) => (el.closest('section')?.querySelector('h2,h3')?.textContent || el.tagName).trim();
      const overflowingTables = [...document.querySelectorAll('table')]
        .filter((t) => t.scrollWidth > (t.parentElement?.clientWidth ?? t.clientWidth) + 1)
        .map(label);
      const sizes = [...document.querySelectorAll('td,th')].map((c) => parseFloat(getComputedStyle(c).fontSize));
      const clippedText = [...document.querySelectorAll('body *')]
        .filter((el) => {
          const s = getComputedStyle(el);
          if (s.display === 'none' || !(el as HTMLElement).innerText?.trim()) return false;
          const h = el as HTMLElement;
          const ellipsis = s.textOverflow === 'ellipsis' && h.scrollWidth > h.clientWidth + 1;
          const clamped = s.webkitLineClamp !== 'none' && s.webkitLineClamp !== '' && h.scrollHeight > h.clientHeight + 1;
          return ellipsis || clamped;
        })
        .map((el) => (el as HTMLElement).innerText.trim().slice(0, 80));
      return { overflowingTables, minCellFontPx: Math.min(...sizes), clippedText };
    });
  } finally {
    await browser.close();
  }
}
