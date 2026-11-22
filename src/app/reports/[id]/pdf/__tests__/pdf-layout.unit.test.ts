/**
 * PDF tables never clip text (Claude Local production validation, 2026-11-22).
 *
 * The report's screen CSS keeps numeric/label cells on one line (white-space: nowrap) inside a horizontally
 * scrolling wrapper (.tw { overflow-x: auto }). A PDF page is a fixed width, so the recompetes and forecasts
 * tables (~1,150-1,290px wide in a 626px column) were cut off on the right, and summary subtitles were
 * clamped. A print-only stylesheet now wraps them. Real Chromium, print media, at the PDF content width
 * (Letter 8.5in minus the route's 0.5in margins = 7.5in = 720 CSS px).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';
import { htmlToPdf, type LaunchedBrowser } from '@/lib/pdf/launch-browser';
import { PDF_OPTIONS } from '../route';

const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p)
  .find((p) => existsSync(p));
const PDFTOTEXT = ['/usr/bin/pdftotext', '/usr/local/bin/pdftotext'].find((p) => existsSync(p));
const PAGE_CONTENT_PX = 720;

const LONG_AGENCY = 'U.S. Customs and Border Protection Office of Technology Innovation and Acquisition';
const LONG_SET_ASIDE = 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside';
const LONG_LIKELIHOOD = 'High likelihood of recompete';

function wideReport(): string {
  return renderMarketReportHtml({
    subject: 'counter-UAS detection platforms',
    generated_at: '2026-11-22T00:00:00Z',
    summary: { subject: 's', total_market: 123_456_789_012, naics_count: 70, top_psc: { code: '1550', name: 'Unmanned Aircraft And Related Very Long Product Service Code Name' }, buying_agencies: 3, top_contractors: 1, recompetes: 1, forecasts: 1 },
    sections: {
      market_size: null,
      top_agencies: [{ name: 'DEPT OF HOMELAND SECURITY', sub_agency: LONG_AGENCY, contract_count: 12, unique_vendors: 5 }],
      competition: { contractors: [{ name: 'ACME DEFENSE SOLUTIONS LIMITED LIABILITY COMPANY', uei: 'ABCDEFGHIJKL', amount: 1_234_567_890 }], count: 1 },
      recompetes: { contracts: [{ incumbent_name: 'ACME DEFENSE SOLUTIONS', piid: 'HSBP1020D00001', description: 'Detection systems', awarding_sub_agency: LONG_AGENCY, naics_code: '541330', potential_total_value: 987_654_321_098, period_of_performance_current_end: '2027-09-30', recompete_likelihood: LONG_LIKELIHOOD }], count: 1 },
      forecasts: { forecasts: [{ title: 'Counter-UAS detection', agency: 'Department of Homeland Security Science and Technology Directorate', naics_code: '334511', value_range: '> $250M - < $1B', fiscal_year: 'FY2027', quarter: 'Q3', set_aside_type: LONG_SET_ASIDE }], count: 1 },
      agency_detail: null,
      set_aside_gap: null,
    },
    _meta: { degraded: false, sections_grounded: 4, sections_total: 7 },
  } as never);
}

async function launch(): Promise<LaunchedBrowser> {
  const { default: puppeteer } = await import('puppeteer');
  return (await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })) as unknown as LaunchedBrowser;
}

describe.runIf(!!CHROME)('market report PDF: tables and summary text are never clipped', () => {
  it('in print layout at the PDF content width, no table or cell overflows and nothing is truncated', async () => {
    const { default: puppeteer } = await import('puppeteer');
    const b = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    try {
      const page = await b.newPage();
      await page.setViewport({ width: PAGE_CONTENT_PX, height: 1000 });
      await page.emulateMediaType('print');
      await page.setContent(wideReport());
      const problems = await page.evaluate((maxW: number) => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > maxW) out.push(`page ${document.documentElement.scrollWidth}px > ${maxW}px`);
        document.querySelectorAll('.tw').forEach((e, i) => { const el = e as HTMLElement; if (el.scrollWidth > el.clientWidth + 1) out.push(`table ${i} ${el.scrollWidth}px in ${el.clientWidth}px`); });
        document.querySelectorAll('td, th, .stat-v, .stat-sub').forEach((e) => {
          const el = e as HTMLElement;
          const clipsY = el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflow !== 'visible';
          if (el.scrollWidth > el.clientWidth + 1 || clipsY) out.push(`${el.tagName.toLowerCase()}.${el.className}: ${(el.textContent || '').slice(0, 40)}`);
        });
        return out;
      }, PAGE_CONTENT_PX);
      expect(problems).toEqual([]);
    } finally {
      await b.close();
    }
  }, 60_000);

  it('the screen layout is unchanged (one-line numeric cells, scrollable wrapper)', async () => {
    const html = wideReport();
    expect(html).toContain('td:not(.lead) { font-variant-numeric:tabular-nums; white-space:nowrap; }');
    expect(html).toContain('.tw { overflow-x:auto; }');
    // The print rules are scoped to @media print.
    expect(html).toMatch(/@media print \{\s*\.tw \{ overflow: visible; \}/);
  });

  it.runIf(!!PDFTOTEXT)('the real PDF contains the full long values from the wide tables', async () => {
    const { pdf, error } = await htmlToPdf(wideReport(), PDF_OPTIONS, { lockdown: true, launch });
    expect(error).toBeNull();
    const text = execFileSync(PDFTOTEXT!, ['-enc', 'UTF-8', '-', '-'], { input: pdf!, encoding: 'utf8' });
    // pdftotext drops a hyphen where a wrapped line broke at it ("veteran-\nowned" → "veteranowned"),
    // which is itself the wrapping this test is about; compare without whitespace and hyphens.
    const squash = (s: string) => s.replace(/[\s-]+/g, '').toLowerCase();
    for (const s of [LONG_AGENCY, LONG_SET_ASIDE, LONG_LIKELIHOOD, '$987.7B', '> $250M - < $1B', 'Unmanned Aircraft And Related Very Long Product Service Code Name']) {
      expect(squash(text), s).toContain(squash(s));
    }
  }, 60_000);
});

/**
 * Claude Local retest, 2026-11-22 (report Ej6xCaGHX-jWLIlT9rlj2Q): `overflow-wrap: anywhere` let the PDF break
 * INSIDE short tokens — "$1.6B" → "$1." / "6B", headers AM / OU / NT, "$279K" → "$27" / "9K", "medium" → "medi"
 * / "um" — and `.sec { break-inside: avoid }` left half-empty pages and a page holding only the footer.
 */
describe.runIf(!!CHROME && !!PDFTOTEXT)('market report PDF: short values and headers are never split; no footer-only page', () => {
  it('every amount, code, date, label and header survives on one line, and the last page has content', async () => {
    const { pdf, error } = await htmlToPdf(wideReport(), PDF_OPTIONS, { lockdown: true, launch });
    expect(error).toBeNull();
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', ['-'], { input: pdf!, encoding: 'utf8' }))?.[1] ?? 0);
    const lines = execFileSync(PDFTOTEXT!, ['-enc', 'UTF-8', '-', '-'], { input: pdf!, encoding: 'utf8' }).split('\n').map((l) => l.trim());
    for (const whole of ['$987.7B', '541330', '2027-09-30', 'OBLIGATED', 'LIKELIHOOD', 'NAICS', 'VALUE']) {
      expect(lines.some((l) => l.includes(whole)), whole).toBe(true);
    }
    // No fragment of a split token on a line of its own.
    expect(lines.filter((l) => /^(\$\d+\.?|\d+[KMB]|[KMB]|AM|OU|NT|OBLIGATE|D|LIKELI|HOOD|medi|um)$/.test(l))).toEqual([]);
    const last = execFileSync(PDFTOTEXT!, ['-f', String(pages), '-l', String(pages), '-enc', 'UTF-8', '-', '-'], { input: pdf!, encoding: 'utf8' });
    expect(last.replace(/Powered by[\s\S]*$/, '').trim().length, 'last page holds more than the footer').toBeGreaterThan(0);
  }, 60_000);
});
