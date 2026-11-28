/**
 * The public answer for a hosted report link that was revoked by its owner or has expired (HTTP 410).
 *
 * Neutral by design (Eric, 2026-11-22): the same text for revoked and expired, and no report contents, no
 * subject, no customer or client name and no owner. It only tells someone who already holds the link that
 * it no longer works and what to do. Malformed and never-existed ids keep the identical 404 instead.
 */
import { NextResponse } from 'next/server';

export const GONE_MESSAGE = 'This report link has expired or was withdrawn by the person who shared it. Ask them for a new link.';

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export function reportLinkGone(opts: { json?: boolean } = {}): NextResponse {
  if (opts.json) {
    return NextResponse.json({ success: false, error: 'link_unavailable', message: GONE_MESSAGE }, { status: 410, headers: HEADERS });
  }
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report link unavailable</title>
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.c{max-width:460px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#475569;line-height:1.6;margin:0}a{color:#7c3aed}</style></head>
<body><div class="c"><h1>Report link unavailable</h1><p>${GONE_MESSAGE}</p>
<p style="margin-top:16px"><a href="https://getmindy.ai">Powered by Mindy</a></p></div></body></html>`,
    { status: 410, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
