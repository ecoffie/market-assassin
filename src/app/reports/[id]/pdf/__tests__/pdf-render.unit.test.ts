/**
 * The market-report PDF is a VALID file whose text matches the report (2026-11-22).
 *
 * Runs the production path end to end: the stored-report renderer → htmlToPdf (lockdown) → a real
 * headless Chromium → pdf-parse. Every customer-visible line of the HTML report must appear in the PDF.
 * The route test (./route.unit.test.ts) pins that the route sends exactly this HTML.
 *
 * Needs a Chromium binary: PUPPETEER_EXECUTABLE_PATH, the cloud sessions' Playwright Chromium, or the
 * Google Chrome that GitHub's ubuntu runners ship. Without one the suite is skipped (it says so) and the
 * route test still covers the contract.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { htmlToPdf, type LaunchedBrowser } from '@/lib/pdf/launch-browser';
import { renderStoredReportHtml } from '@/lib/market/stored-report-html';
import { pdfOptions, isPdf } from '../route';
import { REPORT } from './fixture';

const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p)
  .find((p) => existsSync(p));

/** poppler's pdftotext reads the text layer faithfully; pdf-parse (pdf.js) drops tabular-number digits. */
const PDFTOTEXT = ['/usr/bin/pdftotext', '/usr/local/bin/pdftotext'].find((p) => existsSync(p));

async function launch(): Promise<LaunchedBrowser> {
  const { default: puppeteer } = await import('puppeteer');
  return (await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })) as unknown as LaunchedBrowser;
}

/** Visible text of the report HTML, one normalised line per block (the print-hidden button excluded). */
function htmlLines(html: string): string[] {
  const body = html
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<(button|a) class="pdfbtn"[\s\S]*?<\/\1>/g, '')
    .replace(/<\/(p|div|h1|h2|h3|td|th|li|header|footer)>|<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return body.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2);
}

// Letters and digits only: text extraction drops a hyphen where a line wraps ("period-of-|performance").
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

describe.runIf(!!CHROME)('market report PDF: a valid file that matches the report', () => {
  let html = '';
  let pdf: Buffer | null = null;

  it('renders a valid PDF that a PDF library can open', async () => {
    html = renderStoredReportHtml(REPORT as never);
    const out = await htmlToPdf(html, pdfOptions(REPORT.subject), { lockdown: true, launch });
    expect(out.error).toBeNull();
    pdf = out.pdf;
    expect(isPdf(pdf)).toBe(true);
    expect(pdf!.subarray(-8).toString('latin1')).toContain('%%EOF');

    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(pdf!) });
    const { text, total } = await parser.getText();
    await parser.destroy();
    expect(total).toBeGreaterThanOrEqual(1);
    const t = squash(text);
    for (const s of ['drones', 'Acme Corp', 'July 16, 2026', 'Northwind Aerial Systems 15', 'Competitive landscape', 'Powered by']) {
      expect(t).toContain(squash(s));
    }
    // The on-screen button is not printed into the file.
    expect(t).not.toContain(squash('Download PDF'));

    // Every visible line's WORDS are in the PDF. pdf.js drops tabular-number digits and some punctuation, so
    // this compares letters only; the numbers are checked by the pdftotext test below where poppler exists.
    const letters = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
    const pdfLetters = letters(text);
    const lines = htmlLines(html).filter((l) => letters(l).length >= 3);
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.filter((l) => !pdfLetters.includes(letters(l)))).toEqual([]);
  }, 60_000);

  it.runIf(!!PDFTOTEXT)('contains every visible line of the report, numbers included', () => {
    expect(pdf, 'previous test renders the PDF').toBeTruthy();
    const text = execFileSync(PDFTOTEXT!, ['-enc', 'UTF-8', '-', '-'], { input: pdf!, encoding: 'utf8' });
    const pdfText = squash(text);
    const lines = htmlLines(html);
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.filter((l) => !pdfText.includes(squash(l)))).toEqual([]);
    expect(pdfText).toContain(squash('$40.0M'));
  });
});

describe.runIf(!CHROME)('market report PDF (skipped: no Chromium binary here)', () => {
  it.skip('needs PUPPETEER_EXECUTABLE_PATH, /opt/pw-browsers/chromium or /usr/bin/google-chrome', () => {});
});
