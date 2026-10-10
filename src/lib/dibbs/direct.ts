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
 *
 * PROXY MODE (2026-10-10, behind DIBBS_PROXY_MODE=primary — see ./apify-proxy.ts): the
 * same browser routed through Apify's RESIDENTIAL proxy. Measured from Vercel's egress the
 * plain path won 8 of 33 days; through the proxy the spike fetched the complete file 6/6
 * times for ~$0.005/file. The paid actor is billed per ROW and capped at 2,500 — on
 * 2026-10-07 it charged $35.85 and missed 626 of 3,015 RFQs. Positioning above still holds:
 * the actor remains the final fallback, it is just no longer the routine path.
 */
import type { Browser } from 'puppeteer-core';
import type { DibbsRfq } from './ingest';

const ARCHIVE = 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Launch a browser that works BOTH locally and on Vercel.
 *
 * VERIFIED THE HARD WAY (2026-08-02): the first version of this file imported plain
 * `puppeteer`, which works on a dev machine but NOT in Vercel's serverless runtime —
 * the deployed route failed with "Could not find Chrome (ver. 146.0.7680.153)".
 * There is no browser binary in the lambda. A local end-to-end test cannot catch
 * this; only calling the DEPLOYED route can.
 *
 * So: on Vercel use @sparticuz/chromium (a Lambda-compatible Chromium build) driven
 * by puppeteer-core; locally use the full `puppeteer` package and its bundled
 * browser. Both expose the same API, so the calling code is unchanged.
 *
 * NOTE: the other puppeteer users in this repo (forecast scrapers, coach report)
 * still import plain `puppeteer` and therefore have the SAME serverless gap. Not
 * touched here — out of scope — but they will fail identically if invoked on Vercel.
 */
async function launchBrowser(extraArgs: string[] = []): Promise<Browser> {
  const onVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (onVercel) {
    const [{ default: chromium }, { default: puppeteerCore }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ]);
    // v149 exposes `args` + `executablePath()` only — no `defaultViewport`
    // (it existed in older releases; verified against the installed package).
    return (await puppeteerCore.launch({
      args: [...chromium.args, ...extraArgs],
      executablePath: await chromium.executablePath(),
      headless: true,
    })) as unknown as Browser;
  }
  const { default: puppeteer } = await import('puppeteer');
  return (await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', ...extraArgs],
  })) as unknown as Browser;
}

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

/**
 * SPE2DP26T4251 -> SPE2DP-26-T-4251 (the shape the rest of the app + dibbs_rfqs use).
 *
 * The serial is FOUR ALPHANUMERICS, not four digits: DLA issues `SPE2DS26T213Q`,
 * `SPE7MC26T252L`, and the actor stores them dashed (`SPE7MC-26-T-252L`). A digits-only
 * pattern left ~5% of every file undashed, so the same RFQ landed as TWO rows — one per
 * path. Measured 2026-10-10: 13,011 undashed rows in prod, ~11% of a 1,000-row sample also
 * present in dashed form. This stops NEW twins; the historical rows are a separate cleanup.
 */
export function formatSolicitationNumber(raw: string): string {
  const s = raw.trim();
  const m = /^([A-Z0-9]{6})(\d{2})([A-Z])([A-Z0-9]{4})$/.exec(s);
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

/**
 * DLA PUBLISHES SUNDAY THROUGH FRIDAY — not Monday through Friday. Verified 2026-10-10:
 * in261004.txt (a Sunday) is a real 1,416-row file, and the actor had ingested the Sunday
 * files of 09-13, 09-27 and 10-04, while in261003.txt (Saturday) redirects to
 * FileNotFound.aspx. Using isBusinessDay() here made the free path skip every Sunday file.
 *
 * (The cron route's no-data-window check still uses Sat+Sun: a Sunday 08:00 UTC run asks
 * for Sunday's file before DLA has posted it, so an empty Sunday run is still expected.)
 */
export function isPublicationDay(d: Date): boolean {
  return d.getUTCDay() !== 6;
}

/** Publication-day index filenames covering the last `daysBack` days, newest first. */
export function recentIndexFiles(daysBack: number, now = new Date()): string[] {
  const files: string[] = [];
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    if (isPublicationDay(d)) files.push(indexFileName(d));
  }
  return files;
}

/**
 * What one archive request actually returned. Four distinct facts, never collapsed:
 *   data    — the fixed-width text file
 *   missing — DLA has no such file. The server 302s to /FileNotFound.aspx (4,900 B).
 *   blocked — any OTHER HTML: the DoD consent page (cookies not accepted) or a WAF rejection
 *   error   — non-200 / transport failure / text we could not parse
 * Verified 2026-10-10 against in261003 (Sat), in261010 (not yet posted), in991231 (bogus):
 * all three end at FileNotFound.aspx, while a refused session gets the consent page back.
 * Before this, "missing" and "blocked" were both "HTML" and a holiday read as a WAF outage.
 */
export type ArchiveOutcome = 'data' | 'missing' | 'blocked' | 'error';

export function classifyArchiveResponse(r: {
  status: number; contentType: string | null; finalUrl: string; text: string;
}): ArchiveOutcome {
  if (/\/FileNotFound\.aspx/i.test(r.finalUrl) || r.status === 404) return 'missing';
  if (r.status !== 200) return 'error';
  const head = r.text.slice(0, 512).trimStart().toLowerCase();
  const isHtml = /html/i.test(r.contentType ?? '') || head.startsWith('<!doctype') || head.startsWith('<html');
  if (isHtml) return 'blocked';
  return 'data';
}

export interface ArchiveFileResult {
  file: string;
  outcome: ArchiveOutcome;
  rows: number;
  bytes: number;
  ms: number;
  detail?: string;
}

export interface DirectFetchReport {
  via: 'proxy' | 'direct';
  files: ArchiveFileResult[];
  rows: DibbsRfq[];
  /** Every requested file is either data or confirmed-missing. Nothing blocked/errored. */
  complete: boolean;
  consentMs: number | null;
  totalMs: number;
  /** Bytes on the wire (CDP encodedDataLength). Apify meters roughly 2x this. */
  wireBytes: number;
  /** Set when the browser/session itself failed before per-file results existed. */
  error?: string;
}

/** Bounded wait for the consent postback (it answers with the file, not a navigation). */
const CONSENT_WAIT_MS = 15_000;
const NAV_TIMEOUT_MS = 45_000;
const FILE_FETCH_TIMEOUT_MS = 45_000;

/**
 * Fetch + classify recent DIBBS index files with a real browser — per FILE, not per run.
 *
 * `proxy` routes the browser through Apify's residential proxy (see ./apify-proxy.ts); omit
 * it for today's plain direct path from our own egress. `files` overrides the window so a
 * later path can retry only what an earlier path failed to resolve.
 *
 * NO ROW CAP. A daily file is the whole day (in261007 = 3,157 rows / 3,015 RFQs); the 2,500
 * ceiling belonged to the actor's per-row billing, and applying it here would drop real RFQs
 * for no saving — this path is free.
 *
 * Never throws: a browser/session failure is returned as `error` with every file marked
 * 'error', so the caller can decide the next path from facts rather than an exception.
 */
export async function fetchDibbsDirectReport(
  opts: { daysBack?: number; files?: string[]; proxy?: { sessionId: string } } = {},
): Promise<DirectFetchReport> {
  const t0 = Date.now();
  const via: DirectFetchReport['via'] = opts.proxy ? 'proxy' : 'direct';
  const daysBack = Math.min(Math.max(opts.daysBack ?? 2, 1), 30);
  const files = opts.files ?? recentIndexFiles(daysBack);
  const results: ArchiveFileResult[] = [];
  const rows: DibbsRfq[] = [];
  let consentMs: number | null = null;
  let wireBytes = 0;
  if (files.length === 0) {
    return { via, files: [], rows, complete: true, consentMs, totalMs: 0, wireBytes };
  }

  let browser: Browser | undefined;
  try {
    let proxyPassword: string | undefined;
    if (opts.proxy) {
      const { getApifyProxyPassword } = await import('./apify-proxy');
      proxyPassword = await getApifyProxyPassword();
    }
    const { APIFY_PROXY_SERVER, apifyProxyUsername } = await import('./apify-proxy');
    browser = await launchBrowser(opts.proxy ? [`--proxy-server=${APIFY_PROXY_SERVER}`] : []);
    const page = await browser.newPage();
    if (opts.proxy && proxyPassword) {
      await page.authenticate({ username: apifyProxyUsername(opts.proxy.sessionId), password: proxyPassword });
    }
    await page.setUserAgent(UA);

    // Count wire bytes (the proxy bills transfer) and skip assets we never read — the consent
    // page's splash PNGs and CSS are most of a session's bytes and add nothing.
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.loadingFinished', (e: { encodedDataLength?: number }) => { wireBytes += e.encodedDataLength || 0; });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'font', 'stylesheet', 'media'].includes(req.resourceType())) void req.abort();
      else void req.continue();
    });

    // CONSENT. Clicking butAgree POSTs to dodwarning.aspx?goto=<file>, and the server answers
    // with the requested file AS THE DOCUMENT — there is no navigation event, so the old
    // `waitForNavigation({ timeout: 60_000 })` sat out its full 60 s on every run (measured
    // 2026-10-10: 60.1 s on 6/6 spike runs, half the route's budget). Wait for the postback
    // response itself; it lands in ~1 s.
    await page.goto(`${ARCHIVE}/${files[0]}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const agree = await page.$('input[name="butAgree"]');
    if (agree) {
      const tc = Date.now();
      await Promise.all([
        page.waitForResponse((r) => /dodwarning\.aspx/i.test(r.url()), { timeout: CONSENT_WAIT_MS }).catch(() => null),
        page.click('input[name="butAgree"]'),
      ]);
      consentMs = Date.now() - tc;
    }

    for (const file of files) {
      const tf = Date.now();
      try {
        // Fetch INSIDE the page so the consent + WAF cookies ride along.
        const r = await page.evaluate(async (u: string, timeoutMs: number) => {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), timeoutMs);
          try {
            const x = await fetch(u, { credentials: 'include', signal: ctl.signal });
            return { status: x.status, contentType: x.headers.get('content-type'), finalUrl: x.url, text: await x.text() };
          } finally { clearTimeout(timer); }
        }, `${ARCHIVE}/${file}`, FILE_FETCH_TIMEOUT_MS);
        const outcome = classifyArchiveResponse(r);
        const bytes = r.text.length;
        if (outcome === 'data') {
          const parsed = parseIndexFile(r.text);
          // A non-empty text body that yields no records is not "a quiet day" — it is a format
          // we do not understand. Report it rather than writing nothing and calling it fine.
          if (parsed.length === 0 && r.text.trim().length > 0) {
            results.push({ file, outcome: 'error', rows: 0, bytes, ms: Date.now() - tf, detail: 'text body parsed to 0 records' });
            continue;
          }
          rows.push(...parsed);
          results.push({ file, outcome, rows: parsed.length, bytes, ms: Date.now() - tf });
        } else {
          results.push({ file, outcome, rows: 0, bytes, ms: Date.now() - tf, detail: `HTTP ${r.status} → ${r.finalUrl.replace(/^https?:\/\/[^/]+/, '')}` });
        }
      } catch (err) {
        results.push({ file, outcome: 'error', rows: 0, bytes: 0, ms: Date.now() - tf, detail: (err as Error).message.slice(0, 200) });
      }
    }
  } catch (err) {
    const msg = (err as Error).message.slice(0, 300);
    const seen = new Set(results.map((r) => r.file));
    for (const file of files) if (!seen.has(file)) results.push({ file, outcome: 'error', rows: 0, bytes: 0, ms: 0, detail: msg });
    return { via, files: results, rows, complete: false, consentMs, totalMs: Date.now() - t0, wireBytes, error: msg };
  } finally {
    await browser?.close().catch(() => {});
  }

  const complete = results.every((r) => r.outcome === 'data' || r.outcome === 'missing');
  return { via, files: results, rows, complete, consentMs, totalMs: Date.now() - t0, wireBytes };
}

/**
 * Fetch + parse recent DIBBS index files directly, no vendor — the original contract the
 * flag-OFF cron path depends on: returns rows, or THROWS when every file was refused.
 *
 * Drives a real browser because the WAF rejects plain HTTP (see header). One browser
 * is reused for every file — the consent + WAF cookies are established once and
 * carried, which is both faster and far less likely to trip rate limiting than
 * re-negotiating per file.
 *
 * `maxItems` is accepted for compatibility and deliberately IGNORED: this path is free and a
 * daily file can exceed 2,500 rows (see fetchDibbsDirectReport).
 */
export async function fetchDibbsDirect(
  opts: { daysBack?: number; maxItems?: number } = {},
): Promise<DibbsRfq[]> {
  const daysBack = Math.min(Math.max(opts.daysBack ?? 2, 1), 30);
  const files = recentIndexFiles(daysBack);
  if (files.length === 0) return []; // window is entirely weekend — expected, not an error

  const report = await fetchDibbsDirectReport({ files });
  const out = report.rows;
  // Why each requested file produced nothing. "the WAF served a consent page" and "DLA
  // published no file" both yield zero records, and reporting them the same way is what made
  // a four-day outage look ambiguous — see the SR-002 note on the throw below. Unreadable
  // files (transport/parse errors) count with the blocked ones: neither is "no data".
  const blockedFiles = report.files.filter((f) => f.outcome === 'blocked' || f.outcome === 'error').length;
  const missingFiles = report.files.filter((f) => f.outcome === 'missing').length;
  // BLOCKED IS NOT EMPTY.
  //
  // Returning [] told the caller "no records", which is indistinguishable from a genuine
  // no-data window — so ingestDibbs recorded `direct:empty(0)` and the run read as
  // "DLA published nothing" for four days while the real state was "the WAF refused us".
  //
  // Throwing is deliberate, and it does NOT change routing: ingestDibbs already catches a
  // direct failure and falls through to Apify (cost control must never become data loss).
  // The only difference is that attempts[] now records `direct:threw(0 — WAF ...)` instead
  // of `direct:empty(0)`, which is the fact a postmortem needs.
  //
  // Only when EVERY file was blocked. A partial block still returns what it got — some data
  // beats an exception.
  if (out.length === 0 && blockedFiles > 0 && missingFiles === 0) {
    throw new Error(
      `WAF blocked all ${blockedFiles} index file(s) — the DoD consent page was served instead of data. `
      + 'This is not an empty window; direct fetching is unavailable from this egress.'
      + (report.error ? ` (${report.error})` : ''),
    );
  }

  return out;
}
