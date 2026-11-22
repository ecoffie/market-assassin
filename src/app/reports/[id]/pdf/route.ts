/**
 * GET /reports/<id>/pdf — a real, downloadable PDF of the hosted market report.
 *
 * Before this, "Save as PDF" on /reports/<id> was window.print(), and inside Ask Mindy's report pane the
 * same button sat in a script-less sandboxed frame and did nothing. No file was ever produced.
 *
 * No second report generator: the HTML comes from renderStoredReportHtml, the renderer the hosted page
 * uses. It is turned into a PDF by the shared headless-Chromium path (htmlToPdf in lockdown mode:
 * JavaScript off, every network request aborted). So the file matches the page.
 *
 * Access is the hosted page's: the unguessable id is the capability (a client opens the link without a
 * Mindy login). Malformed and missing ids get the same 404. Starting a browser costs real compute, so
 * every request is rate-limited per IP and per report before Chromium starts.
 *
 * Errors are answered so a person can act on them: JSON ({ error, message }) when the caller asks for
 * JSON (Ask Mindy's Export button), otherwise a short HTML page linking back to the report. A failed
 * render is never answered as a PDF. The bytes must start with "%PDF-".
 *
 * This route launches Chromium, so it is listed in next.config.ts outputFileTracingIncludes.
 */
import { NextResponse } from 'next/server';
import { getMarketReport } from '@/lib/market/report-store';
import { renderStoredReportHtml, reportPdfFileName } from '@/lib/market/stored-report-html';
import { htmlToPdf } from '@/lib/pdf/launch-browser';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const PDF_LIMIT_PER_IP_HOUR = 20;
export const PDF_LIMIT_PER_REPORT_HOUR = 60;

export const PDF_OPTIONS = {
  format: 'Letter',
  printBackground: true,
  margin: { top: '0.5in', right: '0.5in', bottom: '0.6in', left: '0.5in' },
};

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

type Failure = { status: number; error: string; message: string; retryAfter?: number };

const MESSAGES = {
  not_found: 'This report link is invalid or has been removed. Ask Mindy to create the report again.',
  rate_limited: 'Too many PDF downloads in a short time. Wait a few minutes and try again.',
  pdf_unavailable: "We couldn't create the PDF just now. Try again in a minute. The report itself is unchanged.",
} as const;

function wantsJson(req: Request): boolean {
  return (req.headers.get('accept') || '').includes('application/json');
}

function fail(req: Request, id: string, f: Failure): NextResponse {
  const headers: Record<string, string> = { ...NO_STORE };
  if (f.retryAfter) headers['Retry-After'] = String(f.retryAfter);
  if (wantsJson(req)) {
    return NextResponse.json({ success: false, error: f.error, message: f.message }, { status: f.status, headers });
  }
  const back = f.error === 'not_found' ? '' : `<p style="margin-top:16px"><a href="/reports/${encodeURIComponent(id)}">Back to the report</a></p>`;
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PDF not available</title>
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.c{max-width:460px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#475569;line-height:1.6;margin:0}a{color:#7c3aed}</style></head>
<body><div class="c"><h1>PDF not available</h1><p>${f.message}</p>${back}</div></body></html>`,
    { status: f.status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** A real PDF starts with the "%PDF-" header. */
export function isPdf(buf: Buffer | null | undefined): buf is Buffer {
  return !!buf && buf.length > 64 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id || '')) return fail(req, '', { status: 404, error: 'not_found', message: MESSAGES.not_found });

  const [byIp, byReport] = await Promise.all([
    checkRateLimit(`report-pdf:ip:${getClientIP(req)}`, PDF_LIMIT_PER_IP_HOUR, 3600),
    checkRateLimit(`report-pdf:id:${id}`, PDF_LIMIT_PER_REPORT_HOUR, 3600),
  ]);
  if (!byIp.allowed || !byReport.allowed) {
    const resetAt = Math.max(byIp.allowed ? 0 : byIp.resetAt, byReport.allowed ? 0 : byReport.resetAt);
    const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000));
    return fail(req, id, { status: 429, error: 'rate_limited', message: MESSAGES.rate_limited, retryAfter });
  }

  const report = await getMarketReport(id);
  if (!report?.payload) return fail(req, '', { status: 404, error: 'not_found', message: MESSAGES.not_found });

  let html: string;
  try {
    html = renderStoredReportHtml(report);
  } catch (err) {
    console.error('[reports/pdf] render failed for', id, err);
    return fail(req, id, { status: 500, error: 'pdf_unavailable', message: MESSAGES.pdf_unavailable });
  }

  const { pdf, error } = await htmlToPdf(html, PDF_OPTIONS, { lockdown: true });
  if (!isPdf(pdf)) {
    console.error('[reports/pdf] PDF render failed for', id, error || 'not a PDF');
    return fail(req, id, { status: 503, error: 'pdf_unavailable', message: MESSAGES.pdf_unavailable, retryAfter: 60 });
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportPdfFileName(report.subject)}"`,
      'Content-Length': String(pdf.length),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
