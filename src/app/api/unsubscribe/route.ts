/**
 * One-click unsubscribe (RFC 8058) for every Mindy email. Links come only from src/lib/email/unsubscribe.ts
 * (sendEmail fills them per recipient): /api/unsubscribe?e=<b64url email>&t=<hmac>[&s=<email type>].
 *
 *   GET  → confirmation page with a single "Unsubscribe" button and a "manage preferences" link. Writes NOTHING:
 *          mail security scanners fetch every link on delivery.
 *   POST → performs the unsubscribe. Two callers: the page's button (form post), and the mailbox provider's one-click
 *          request (body "List-Unsubscribe=One-Click", the e/t values in the URL).
 *
 * Unsubscribe = no more non-transactional Mindy mail: the address is written to email_suppressions (checked by
 * sendEmail's guard, fails closed) and alerts + briefings are switched off on its settings row. Receipts, password
 * and security codes are transactional and unaffected. An unsigned or tampered link changes nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUnsubscribe } from '@/lib/email/unsubscribe';
import { applyUnsubscribe, unsubscribePage } from '@/lib/email/unsubscribe-apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const html = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const email = verifyUnsubscribe(q.get('e'), q.get('t'));
  if (!email) return html(unsubscribePage({ state: 'invalid' }), 400);
  return html(unsubscribePage({ state: 'confirm', email, e: q.get('e')!, t: q.get('t')!, s: q.get('s') }));
}

export async function POST(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  let e = q.get('e');
  let t = q.get('t');
  let s = q.get('s');
  let oneClick = false;
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (form) {
      oneClick = form.get('List-Unsubscribe') === 'One-Click';
      e = (form.get('e') as string | null) ?? e;
      t = (form.get('t') as string | null) ?? t;
      s = (form.get('s') as string | null) ?? s;
    }
  }
  const email = verifyUnsubscribe(e, t);
  if (!email) {
    return oneClick ? new NextResponse('invalid unsubscribe link', { status: 400 }) : html(unsubscribePage({ state: 'invalid' }), 400);
  }
  const result = await applyUnsubscribe(db(), email, { emailType: s, via: oneClick ? 'list_unsubscribe_one_click' : 'unsubscribe_page' });
  if (!result.ok) {
    console.error('[unsubscribe] failed for a verified address:', result.error);
    return oneClick ? new NextResponse('unsubscribe failed; please retry', { status: 500 }) : html(unsubscribePage({ state: 'error' }), 500);
  }
  return oneClick ? new NextResponse('unsubscribed', { status: 200 }) : html(unsubscribePage({ state: 'done', email }));
}
