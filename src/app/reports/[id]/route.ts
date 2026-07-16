/**
 * GET /reports/<id> — the hosted, client-ready market report.
 *
 * This is the deliverable Sue SENDS a client: a public, self-contained, Mindy-branded
 * page (with a Save-as-PDF button). Served as a route handler rather than a React page
 * because `renderMarketReportHtml` already emits a complete <!doctype html> document —
 * wrapping it in a Next layout would nest documents.
 *
 * ⚠️ PUBLIC BY DESIGN. The unguessable 22-char id IS the access control (capability
 * URL — a client must be able to open it without a Mindy login). We therefore return
 * an identical 404 for both "missing" and "malformed" so the endpoint can't be probed
 * to distinguish real ids, and we tell robots not to index it.
 */
import { NextResponse } from 'next/server';
import { getMarketReport } from '@/lib/market/report-store';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

function notFound(): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report not found</title>
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.c{max-width:460px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#475569;line-height:1.6;margin:0}a{color:#7c3aed}</style></head>
<body><div class="c"><h1>Report not found</h1>
<p>This report link is invalid or has been removed. Ask whoever shared it to generate a new one.</p>
<p style="margin-top:16px"><a href="https://getmindy.ai">Powered by Mindy</a></p></div></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' } },
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Same response for malformed and missing — don't leak which ids are real.
  if (!ID_RE.test(id || '')) return notFound();

  const report = await getMarketReport(id);
  if (!report?.payload) return notFound();

  let html: string;
  try {
    html = renderMarketReportHtml({
      ...(report.payload as Record<string, unknown>),
      generated_for: report.client_name ?? (report.payload as { generated_for?: string | null }).generated_for ?? null,
    } as Parameters<typeof renderMarketReportHtml>[0]);
  } catch (err) {
    console.error('[reports] render failed for', id, err);
    return notFound();
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A stored report is immutable; let the client's browser cache it, but keep it
      // off shared/CDN caches and out of search results (it's someone's client work).
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
