/**
 * PDF tables never clip text (Claude Local production validation, 2026-11-22).
 *
 * The report's screen CSS keeps numeric/label cells on one line (white-space: nowrap) inside a horizontally
 * scrolling wrapper (.tw { overflow-x: auto }). A PDF page is a fixed width, so the recompetes and forecasts
 * tables (~1,150-1,290px wide in a 626px column) were cut off on the right, and summary subtitles were
 * clamped. A print-only stylesheet now wraps them. Real Chromium, print media, at the PDF content width
 * (Letter 8.5in minus the route's 0.5in margins = 7.5in = 720 CSS px).
 *
 * Second pass (Claude Local, same day): the first print rule used overflow-wrap:anywhere, which split SHORT
 * values and headers ("$1.6B" → "$1." / "6B", "AMOUNT" → AM/OU/NT, "medium" → "medi" / "um"), and whole
 * sections refused to split, leaving a mostly empty page 2 and a last page with only the footer. Now only
 * the lead column and marked prose columns wrap, between words; codes stay whole; sections may split.
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

  // Shaped like the production report Claude Local printed (2026-11-22): a measurement table, many short
  // recompete values, forecasts and contractors. Synthetic names only.
  function productionShapedReport(): string {
    const likelihood = ['medium', 'high', 'low'];
    const recompetes = Array.from({ length: 22 }, (_, i) => ({
      incumbent_name: `NORTHWIND FACILITY SERVICES ${i + 1} LLC`,
      piid: `36C24226C${String(119 + i).padStart(4, '0')}`,
      description: i === 3 ? '561A4-26-510 REPLACE STEAM LINE FROM MANHOLE 9 TO VAULT' : 'Building repairs and maintenance services for the medical center campus',
      awarding_sub_agency: i % 2 ? 'Veterans Affairs, Department of' : 'Public Buildings Service',
      naics_code: i % 2 ? '238160' : '236220',
      potential_total_value: [279_000, 3_300_000, 992_000, 8_400_000, 47_100_000][i % 5],
      period_of_performance_current_end: `2026-11-${String(23 + (i % 5)).padStart(2, '0')}`,
      recompete_likelihood: likelihood[i % 3],
    }));
    const forecasts = Array.from({ length: 10 }, (_, i) => ({
      title: `Facility maintenance requirement ${i + 1}`, agency: 'Department of Veterans Affairs', naics_code: '561210',
      value_range: '$1M - $5M', fiscal_year: 'FY2027', quarter: 'Q2', set_aside_type: i % 2 ? 'Service-Disabled Veteran-Owned Small Business' : 'Small Business',
    }));
    const contractors = Array.from({ length: 15 }, (_, i) => ({ name: `CONTOSO BUILDERS ${i + 1} INC`, uei: `Y1NZ${String(10000000 + i)}`, amount: 1_000_000_000 - i * 40_000_000 }));
    return renderMarketReportHtml({
      subject: 'facilities maintenance',
      generated_at: '2026-11-22T00:00:00Z',
      summary: {
        subject: 'facilities maintenance', axis: 'keyword', total_market: 1_600_000_000, naics_count: 163, top_psc: { code: 'Z1DA', name: 'Maintenance of Hospitals' },
        buying_agencies: 15, top_contractors: 15, recompetes: 22, forecasts: 10,
        size_tiers: [
          { basis: 'named', label: 'Awards that say "facilities maintenance"', amount: 992_000_000, method: 'Award text contains the phrase. A FLOOR.', inputs: ['facilities maintenance'] },
          { basis: 'term_of_art', role: 'sections_basis', label: 'Plus the words this market is bought under', amount: 1_600_000_000, method: 'FY2026 (1 complete fiscal year · description match)', inputs: ['facilities maintenance', 'building maintenance'] },
        ],
      },
      sections: {
        market_size: null,
        top_agencies: Array.from({ length: 10 }, (_, i) => ({ name: 'DEPT OF VETERANS AFFAIRS', sub_agency: `Veterans Health Administration VISN ${i + 1}`, amount: 279_000_000 - i * 9_000_000, contract_count: 12, unique_vendors: 5 })),
        competition: { contractors, count: contractors.length },
        recompetes: { contracts: recompetes, count: recompetes.length },
        forecasts: { forecasts, count: forecasts.length },
        agency_detail: null,
        set_aside_gap: null,
      },
      _meta: { degraded: false, sections_grounded: 4, sections_total: 7 },
    } as never);
  }

  it('in print layout, no header, number, money value, code or short label is split across lines', async () => {
    const { default: puppeteer } = await import('puppeteer');
    const b = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    try {
      const page = await b.newPage();
      await page.setViewport({ width: PAGE_CONTENT_PX, height: 1000 });
      await page.emulateMediaType('print');
      await page.setContent(productionShapedReport());
      const result = await page.evaluate((maxW: number) => {
        const broken: string[] = [];
        let words = 0;
        for (const el of document.querySelectorAll('th, td, .stat-v')) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const t = n.textContent || '';
            for (const m of t.matchAll(/\S+/g)) {
              words++;
              const r = document.createRange(); r.setStart(n, m.index!); r.setEnd(n, m.index! + m[0].length);
              if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) {
                // Prose in a wrapping column may break at its own hyphen ("Service-Disabled"); a code may not.
                const prose = el.matches('td.lead, td.txt') && /-/.test(m[0]) && !/\d/.test(m[0]);
                if (!prose) broken.push(`${el.tagName.toLowerCase()}: ${m[0]}`);
              }
            }
          }
        }
        const overflow = [...document.querySelectorAll('.tw')].filter((e) => e.scrollWidth > e.clientWidth + 1).length
          + (document.documentElement.scrollWidth > maxW ? 1 : 0);
        return { broken, words, overflow };
      }, PAGE_CONTENT_PX);
      expect(result.words).toBeGreaterThan(500); // the check really ran over the tables
      expect(result.broken).toEqual([]);
      expect(result.overflow).toBe(0); // and wrapping less never brings the clipping back
    } finally {
      await b.close();
    }
  }, 60_000);

  it.runIf(!!PDFTOTEXT)('the real PDF keeps values and headers whole, and has no near-empty or footer-only page', async () => {
    const { pdf, error } = await htmlToPdf(productionShapedReport(), PDF_OPTIONS, { lockdown: true, launch });
    expect(error).toBeNull();
    const text = execFileSync(PDFTOTEXT!, ['-enc', 'UTF-8', '-layout', '-', '-'], { input: pdf!, encoding: 'utf8' });
    // Whole tokens, each on one line (a split value would be cut across two lines).
    for (const token of ['$1.6B', '$279K', '$3.3M', '$47.1M', 'medium', '2026-11-23', '238160', '561A4-26-510', '36C24226C0119', 'FY2027 Q2', 'AMOUNT', 'OBLIGATED', 'SHARE', 'NAICS', 'VALUE', 'LIKELIHOOD', 'SET-ASIDE']) {
      expect(text.split('\n').some((line) => line.includes(token)), token).toBe(true);
    }
    const pages = text.split('\f').filter((p) => p.trim());
    const lines = pages.map((p) => p.split('\n').filter((l) => l.trim()).length);
    // The last page carries more than the footer, and no page before it is mostly empty.
    expect(lines[lines.length - 1], `lines per page ${lines.join(',')}`).toBeGreaterThan(4);
    const fullest = Math.max(...lines);
    lines.slice(0, -1).forEach((n, i) => expect(n, `page ${i + 1} of ${lines.join(',')}`).toBeGreaterThanOrEqual(Math.floor(fullest * 0.5)));
  }, 60_000);
});
