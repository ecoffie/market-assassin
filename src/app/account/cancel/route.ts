/** getmindy.ai/account/cancel: see src/lib/account/cancel-link.ts. Routing only. */
import { BILLING_PATH, SIGN_IN_THEN_BILLING, CANCEL_REDIRECT_JS } from '@/lib/account/cancel-link';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Manage or cancel your subscription | Mindy</title>
<style>body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#fff;margin:0;padding:48px 16px;text-align:center}a{color:#047857}</style></head>
<body><p>Opening your billing settings…</p><p><a href="${BILLING_PATH.replace(/&/g, '&amp;')}">Go to Billing</a> · <a href="${SIGN_IN_THEN_BILLING}">Sign in</a></p>
<script>${CANCEL_REDIRECT_JS}</script></body></html>`;

export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(PAGE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
