/**
 * GET /api/admin/signup-types?password=<ADMIN_PASSWORD>&days=90
 * Growth plan item 05: who signs up (by "Which best describes you?"), and which types pay and refer.
 *   answered  — users who picked that type (latest answer per user, in the window)
 *   paid      — of those, users with a real purchase row (superseded duplicates skipped)
 *   referrers — of those, users with at least one granted referral
 * Read-only. Any failed read is an error, never a zero. HTML by default, &format=json for raw data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { getReadClient } from '@/lib/supabase/server-clients';
import { SIGNUP_TYPES, signupTypeLabel } from '@/lib/mindy/signup-type';

export const dynamic = 'force-dynamic';
const PAGE = 1000;

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(Math.max(Number(sp.get('days')) || 90, 1), 730);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const db = getReadClient();
  try {
    type Ev = { user_email: string; created_at: string; metadata: { signup_type?: string } | null };
    const events = await readAll<Ev>((a, b) => db.from('user_engagement')
      .select('user_email, created_at, metadata')
      .eq('event_source', 'onboarding').eq('metadata->>action', 'signup_type')
      .gte('created_at', since).order('created_at').range(a, b), 'user_engagement');
    const latest = new Map<string, string>();
    for (const e of events) {
      const t = e.metadata?.signup_type;
      if (e.user_email && t) latest.set(e.user_email.toLowerCase(), t);
    }
    const emails = [...latest.keys()];
    const paid = new Set<string>();
    const referrers = new Set<string>();
    for (let i = 0; i < emails.length; i += 200) {
      const chunk = emails.slice(i, i + 200);
      type P = { user_email: string; amount_paid: number | null };
      const purchases = await readAll<P>((a, b) => db.from('purchases').select('user_email, amount_paid')
        .in('user_email', chunk).is('superseded_by', null).order('user_email').range(a, b), 'purchases');
      for (const p of purchases) if (Number(p.amount_paid) > 0) paid.add(p.user_email.toLowerCase());
      type R = { referrer_email: string };
      const refs = await readAll<R>((a, b) => db.from('mcp_referrals').select('referrer_email')
        .in('referrer_email', chunk).eq('status', 'granted').order('referrer_email').range(a, b), 'mcp_referrals');
      for (const r of refs) referrers.add(r.referrer_email.toLowerCase());
    }
    const byType = SIGNUP_TYPES.map((t) => {
      const who = emails.filter((e) => latest.get(e) === t.id);
      return {
        type: t.id, label: t.label, answered: who.length,
        paid: who.filter((e) => paid.has(e)).length,
        referrers: who.filter((e) => referrers.has(e)).length,
      };
    });
    const report = { success: true, days, since, totalAnswered: emails.length, byType };
    if (sp.get('format') === 'json') return NextResponse.json(report);
    const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
    const rows = byType.map((r) => `<tr><td>${signupTypeLabel(r.type)}</td><td class="n">${r.answered}</td><td class="n">${r.paid} <span class="m">${pct(r.paid, r.answered)}</span></td><td class="n">${r.referrers} <span class="m">${pct(r.referrers, r.answered)}</span></td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signup types</title>
<style>body{font:14px/1.45 Inter,system-ui,sans-serif;color:#12100E;background:#FBFAF7;margin:0;padding:28px}h1{font:600 24px Georgia,serif;margin:0 0 4px}.sub{color:#6B6459;margin:0 0 18px}
table{width:100%;max-width:760px;border-collapse:collapse;background:#fff;border:1px solid #DCD8CF}th,td{padding:9px 10px;border-bottom:1px solid #EDEAE3;text-align:left}th{background:#F3F0E9;font-size:12px}.n{text-align:right}.m{color:#7A7266;font-size:12px}</style></head><body>
<h1>Who signs up, and who pays and refers</h1><p class="sub">Last ${days} days · ${emails.length} people answered "Which best describes you?" at the end of onboarding.</p>
<table><thead><tr><th>Type</th><th class="n">Answered</th><th class="n">Paid</th><th class="n">Referred someone</th></tr></thead><tbody>${rows}</tbody></table>
<p class="sub" style="margin-top:14px">Change the window with <code>&amp;days=30</code>. Add <code>&amp;format=json</code> for raw data.</p></body></html>`;
    return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'read failed' }, { status: 502 });
  }
}
