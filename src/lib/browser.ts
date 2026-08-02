/**
 * Shared headless-browser launcher — works BOTH locally and on Vercel.
 *
 * WHY THIS EXISTS: plain `puppeteer` works on a dev machine and FAILS in Vercel's
 * serverless runtime, which has no browser binary. That gap is invisible to local
 * testing — every local run passes — so it only ever surfaces by calling the
 * DEPLOYED route. It cost three deploy round-trips on the DIBBS fetcher
 * (2026-08-02) to work through the layers:
 *
 *   1. `Could not find Chrome (ver. …)`      → wrong package for the runtime
 *   2. `The input directory ".../@sparticuz/chromium/bin" does not exist`
 *                                            → the binary was never traced into
 *                                              the lambda
 *   3. working
 *
 * This module is the single place that knowledge lives, so the next caller gets it
 * right in one line instead of rediscovering it.
 *
 * ── USING THIS IN A NEW ROUTE — TWO STEPS, BOTH REQUIRED ────────────────────────
 * Importing this helper is NOT sufficient. `next.config.ts` must ALSO trace the
 * Chromium archives into that specific function:
 *
 *   outputFileTracingIncludes: {
 *     '/api/your/route/**\/*': ['./node_modules/@sparticuz/chromium/bin/**\/*'],
 *   }
 *
 * `serverExternalPackages` alone does not do it: that stops the bundler relocating
 * the module, but the browser ships as brotli archives (chromium.br ~65MB,
 * al2023.tar.br, fonts.tar.br, swiftshader.tar.br — 69.6MB total) that nothing
 * `require()`s, so the tracer never sees them.
 *
 * Trace it PER ROUTE, not globally: 69.6MB on every API function is wasteful and
 * risks the function size ceiling.
 *
 * ── WHEN NOT TO USE A BROWSER AT ALL ────────────────────────────────────────────
 * A browser is the expensive last resort. If the target has an API or a flat file,
 * fetch it directly — the production forecast pipeline (sync-forecasts: DHS + DOE,
 * 1,609 records/day) uses API interception and needs none of this. Reach for a
 * browser only when something genuinely requires a real client, e.g. the DoD
 * consent + F5 WAF gate in front of DIBBS.
 */
import type { Browser } from 'puppeteer-core';

/** True when running in Vercel's serverless runtime (or any Lambda). */
export function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Launch a headless browser appropriate to the current environment.
 *
 * - Vercel/Lambda → `@sparticuz/chromium` + `puppeteer-core`
 * - Local dev     → the full `puppeteer` package and its bundled browser
 *
 * Both expose the same API, so calling code does not branch. ALWAYS close it in a
 * `finally` — a leaked browser in a lambda holds memory for the whole invocation.
 */
export async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    const [{ default: chromium }, { default: puppeteerCore }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ]);
    // NOTE: @sparticuz/chromium v149 exposes `args` + `executablePath()` only —
    // no `defaultViewport` (it existed in older releases). Verified against the
    // installed package, not assumed.
    return (await puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })) as unknown as Browser;
  }
  const { default: puppeteer } = await import('puppeteer');
  return (await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })) as unknown as Browser;
}
