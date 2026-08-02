/**
 * DIBBS DIRECT fetcher — the no-vendor fallback for when Apify is down.
 *
 * WHY THIS EXISTS: on 2026-08-01 the Apify vendor (parseforge/dibbs-rfq-scraper)
 * shipped build 1.0.41 with a syntax error in their own source. The actor could not
 * start, and DIBBS ingest stopped dead — a single third-party build broke a data
 * feed we depend on. This path removes that single point of failure.
 *
 * WHAT WE LEARNED (reading the vendor's run logs): DIBBS is NOT a page-by-page
 * scrape. DLA publishes ONE fixed-width flat file per BUSINESS day at
 *   https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in<YYMMDD>.txt
 * ~2,500 RFQs per file. That is why the vendor's cron cost $0.12/run — it is a file
 * download. The parsing is easy; what the vendor really sells is getting PAST the
 * gate.
 *
 * THE GATE — two layers, both cleared here by driving a real browser:
 *   1. DoD Warning & Consent — an ASP.NET postback (__VIEWSTATE / __EVENTVALIDATION
 *      / butAgree=OK). Reproducible with raw HTTP.
 *   2. F5 BIG-IP ASM WAF (the TS* cookies). This is the real blocker: a plain
 *      curl/fetch gets the consent page back forever no matter the User-Agent, even
 *      from a US residential IP. VERIFIED 2026-08-02 — curl failed, Puppeteer
 *      succeeded and returned 32,376 bytes of real fixed-width data.
 *
 * POSITIONING — FALLBACK, NOT REPLACEMENT. Apify stays primary. It maintains
 * residential-proxy rotation and WAF evasion, which is ongoing work we do not want
 * to own. This path is what runs when the vendor breaks. Using it as the primary
 * would trade a $4/month dependency for a Puppeteer stack we maintain against a DoD
 * WAF that changes without notice.
 *
 * NOTE ON IP: this runs from OUR egress, not a residential proxy. It may be
 * throttled or blocked where the vendor's proxy is not. That is another reason it is
 * the fallback — treat a failure here as expected, not alarming.
 */
import type { Browser } from 'puppeteer-core';
import { launchBrowser } from '@/lib/browser';
import type { DibbsRfq } from './ingest';

const ARCHIVE = 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Fixed-width record layout, DERIVED from live data and cross-checked against rows
 *  the vendor had already parsed (SPE2DP-26-T-4251 / NSN 6505-01-624-7068 / BT).
 *  Every line in a file is exactly 140 chars. */
const LAYOUT = {
  solicitation: [0, 13],
  nsn: [13, 26],
  purchaseRequest: [62, 72],
  returnBy: [72, 80],
  pdf: [80, 98],
  quantity: [99, 106],
  unitOfIssue: [106, 108],
  description: [108, 130],
} as const;

const RECORD_LENGTH = 140;

const slice = (line: string, span: readonly [number, number]) => line.slice(span[0], span[1]).trim();

/** SPE2DP26T4251 -> SPE2DP-26-T-4251 (the shape the rest of the app + dibbs_rfqs use). */
export function formatSolicitationNumber(raw: string): string {
  const s = raw.trim();
  const m = /^([A-Z0-9]{6})(\d{2})([A-Z])(\d{4})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}` : s;
}

/** 6505016247068 -> 6505-01-624-7068 */
export function formatNsn(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 13) return raw.trim();
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 9)}-${d.slice(9)}`;
}

/** MM/DD/YY -> YYYY-MM-DD. DLA uses 2-digit years; window to 2000s. */
export function parseReturnByDate(raw: string): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(raw.trim());
  if (!m) return undefined;
  return `20${m[3]}-${m[1]}-${m[2]}`;
}

/** Parse one daily index file into RFQ records. Malformed lines are SKIPPED, not
 *  guessed at — a wrong NSN is worse than a missing row. */
export function parseIndexFile(text: string): DibbsRfq[] {
  const out: DibbsRfq[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < RECORD_LENGTH - 5) continue; // blank/short/footer lines
    const solRaw = slice(line, LAYOUT.solicitation);
    if (!solRaw) continue;
    const nsnRaw = slice(line, LAYOUT.nsn);
    const qtyRaw = slice(line, LAYOUT.quantity);
    const qty = Number.parseInt(qtyRaw, 10);
    const pdf = slice(line, LAYOUT.pdf);
    out.push({
      solicitationNumber: formatSolicitationNumber(solRaw),
      nsn: nsnRaw ? formatNsn(nsnRaw) : undefined,
      fsc: nsnRaw ? nsnRaw.replace(/\D/g, '').slice(0, 4) || undefined : undefined,
      description: slice(line, LAYOUT.description) || undefined,
      quantity: Number.isFinite(qty) ? qty : undefined,
      unitOfIssue: slice(line, LAYOUT.unitOfIssue) || undefined,
      returnByDate: parseReturnByDate(slice(line, LAYOUT.returnBy)),
      url: `https://www.dibbs.bsm.dla.mil/rfq/rfqrec.aspx?sn=${solRaw}`,
      pdfUrl: pdf ? `${ARCHIVE}/${pdf}` : undefined,
    });
  }
  return out;
}

/** in<YYMMDD>.txt for a given date (UTC). */
export function indexFileName(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `in${yy}${mm}${dd}.txt`;
}

/**
 * The business-day rule that also governs the STARVED check in the cron route: DLA
 * publishes one file per business day, so weekend dates have no file and their
 * absence is EXPECTED, never an error.
 */
export function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** Business-day index filenames covering the last `daysBack` days, newest first. */
export function recentIndexFiles(daysBack: number, now = new Date()): string[] {
  const files: string[] = [];
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    if (isBusinessDay(d)) files.push(indexFileName(d));
  }
  return files;
}

/**
 * Fetch + parse recent DIBBS index files directly, no vendor.
 *
 * Drives a real browser because the WAF rejects plain HTTP (see header). One browser
 * is reused for every file — the consent + WAF cookies are established once and
 * carried, which is both faster and far less likely to trip rate limiting than
 * re-negotiating per file.
 */
export async function fetchDibbsDirect(
  opts: { daysBack?: number; maxItems?: number } = {},
): Promise<DibbsRfq[]> {
  const daysBack = Math.min(Math.max(opts.daysBack ?? 2, 1), 30);
  const maxItems = opts.maxItems ?? 2500;
  const files = recentIndexFiles(daysBack);
  if (files.length === 0) return []; // window is entirely weekend — expected, not an error

  let browser: Browser | undefined;
  const out: DibbsRfq[] = [];
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(UA);

    // First navigation establishes consent + WAF cookies for the whole session.
    const first = `${ARCHIVE}/${files[0]}`;
    await page.goto(first, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const agree = await page.$('input[name="butAgree"]');
    if (agree) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}),
        page.click('input[name="butAgree"]'),
      ]);
    }

    for (const file of files) {
      if (out.length >= maxItems) break;
      const url = `${ARCHIVE}/${file}`;
      // Fetch INSIDE the page so the WAF cookies ride along.
      const body = await page.evaluate(async (u: string) => {
        const r = await fetch(u, { credentials: 'include' });
        return { status: r.status, text: r.status === 200 ? await r.text() : '' };
      }, url);

      // A 404 is normal — DLA does not publish on holidays, and today's file may not
      // exist yet. Getting the consent page back means the WAF won this round.
      if (body.status !== 200 || !body.text) continue;
      if (body.text.includes('<!DOCTYPE') || body.text.includes('<html')) continue;

      out.push(...parseIndexFile(body.text));
    }
  } finally {
    await browser?.close().catch(() => {});
  }
  return out.slice(0, maxItems);
}
