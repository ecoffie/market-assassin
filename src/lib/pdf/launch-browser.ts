/**
 * One way to launch a headless browser, on Vercel and locally.
 *
 * THE TRAP THIS EXISTS TO CLOSE: plain `puppeteer` has no browser binary in a
 * Lambda, so a route that renders HTML → PDF works perfectly on a laptop and
 * fails the moment it is deployed. A local end-to-end test cannot catch it —
 * only calling the DEPLOYED route can. `src/lib/dibbs/direct.ts` hit this
 * ("Could not find Chrome (ver. 146.0.7680.153)"), solved it, and left a note
 * saying the other puppeteer callers had the same gap. They did: the Market
 * Research memo shipped a PDF button that returned HTML on prod, verified
 * 2026-08-17 against the live route.
 *
 * So the resolution lives in ONE place now. On Vercel: @sparticuz/chromium (a
 * Lambda-compatible build) driven by puppeteer-core. Locally: the full
 * `puppeteer` package and its bundled browser. Same API either way, so callers
 * are identical.
 */

// Structural type — avoids importing puppeteer's types into every caller and
// keeps the two implementations interchangeable.
export interface LaunchedBrowser {
  newPage(): Promise<{
    setContent(html: string, opts?: { waitUntil?: string | string[] }): Promise<void>;
    pdf(opts?: Record<string, unknown>): Promise<Uint8Array | Buffer>;
    setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
    goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
    screenshot(opts?: Record<string, unknown>): Promise<Uint8Array | Buffer>;
    content(): Promise<string>;
    // Used only by htmlToPdf's `lockdown` mode (both puppeteer and puppeteer-core provide them).
    setJavaScriptEnabled?(enabled: boolean): Promise<void>;
    setRequestInterception?(enabled: boolean): Promise<void>;
    on?(event: 'request', handler: (req: InterceptedRequest) => void): unknown;
  }>;
  close(): Promise<void>;
}

export interface InterceptedRequest {
  url(): string;
  continue(): Promise<void> | void;
  abort(errorCode?: string): Promise<void> | void;
}

/**
 * A locked-down page may load only the document itself: `about:blank` (where setContent writes) and
 * inline `data:` URIs (embedded images/fonts). Everything else — http(s), file:, blob:, ws: — is
 * aborted, so attacker-influenced HTML cannot fetch, beacon or read local files from the renderer.
 */
export function isLockdownAllowedUrl(url: string): boolean {
  return url === 'about:blank' || url.startsWith('data:');
}

export interface HtmlToPdfOptions {
  /**
   * Render untrusted, self-contained HTML: JavaScript OFF and every network request aborted except
   * about:blank / data:. Opt-in so existing callers (e.g. the market-research export) keep their
   * behavior. The page must fail closed: if the browser cannot apply the lockdown, no PDF is made.
   */
  lockdown?: boolean;
  /** Test seam. */
  launch?: () => Promise<LaunchedBrowser>;
}

/** True when running in a serverless environment with no bundled browser. */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Launch a headless browser appropriate to the environment.
 * Throws if no browser can start — callers decide how to degrade.
 */
export async function launchBrowser(): Promise<LaunchedBrowser> {
  if (isServerless()) {
    const [{ default: chromium }, { default: puppeteerCore }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ]);
    // v149 exposes `args` + `executablePath()` only — no `defaultViewport`.
    return (await puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })) as unknown as LaunchedBrowser;
  }

  const { default: puppeteer } = await import('puppeteer');
  return (await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })) as unknown as LaunchedBrowser;
}

/**
 * Render HTML to a PDF buffer. Returns null when no browser can launch, so the
 * caller can degrade to printable HTML rather than 500 — a contracting officer
 * with a printable page can still file the document; one with a stack trace
 * cannot.
 */
export interface PdfResult {
  pdf: Buffer | null;
  /** Why it failed, for the degrade header. Diagnostics must reach the caller:
   *  a silent null told us nothing when this failed on Vercel. */
  error: string | null;
}

export async function htmlToPdf(
  html: string,
  pdfOptions: Record<string, unknown> = { format: 'Letter', printBackground: true },
  options: HtmlToPdfOptions = {},
): Promise<PdfResult> {
  let browser: LaunchedBrowser | null = null;
  try {
    browser = await (options.launch ?? launchBrowser)();
    const page = await browser.newPage();
    if (options.lockdown) {
      if (!page.setJavaScriptEnabled || !page.setRequestInterception || !page.on) {
        throw new Error('lockdown_unsupported: browser page cannot disable JavaScript or intercept requests');
      }
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (isLockdownAllowedUrl(req.url())) void req.continue();
        else void req.abort('blockedbyclient');
      });
    }
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf(pdfOptions);
    return { pdf: Buffer.from(pdf), error: null };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[pdf/launch-browser] PDF render failed:', msg);
    return { pdf: null, error: msg.slice(0, 300) };
  } finally {
    try { await browser?.close(); } catch { /* browser already gone */ }
  }
}
