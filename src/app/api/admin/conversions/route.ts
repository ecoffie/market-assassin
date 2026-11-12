/**
 * GET /api/admin/conversions?password=<ADMIN_PASSWORD>&days=30
 * Funnel conversion rates (2026-11-12):
 *   1. Lead magnets — page visitors (GA4) vs registrations (GHL tag count, all-time for the tag).
 *   2. Pricing page — visitors (GA4) vs new accounts (alert-settings rows created in the window)
 *      and trials started (completed Stripe checkouts on the four 14-day trial links).
 *   3. Homepage → pricing — homepage visitors vs pricing visitors who came straight from it.
 * Every source is read independently: one failing shows "unavailable", never 0.
 * HTML by default, &format=json for raw data.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { getCountClient } from '@/lib/supabase/server-clients';
import { countContactsByTag } from '@/lib/ghl/event-registration';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { COURSE_GHL_TAG } from '@/lib/course/govcon-roadmap';
import { pageVisitors, rate, visitorsFromHomepage } from '@/lib/ga4/conversions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LEAD_MAGNETS = [
  { name: "Mindy Day — The Lazy Contractor's Blueprint", path: EVENT.path, tag: EVENT.ghlTag },
  { name: 'Free GovCon course', path: '/course', tag: COURSE_GHL_TAG },
];
/** The four 14-day trial payment links (src/components/public-site/pricing/app-plan-links.ts). */
const TRIAL_LINK_IDS = new Set([
  'plink_1Uaz3tK5zyiZ50PBQslxgml9', 'plink_1Uaz3tK5zyiZ50PBxaXnC6Sx',
  'plink_1Uaz3uK5zyiZ50PB59vthuYO', 'plink_1Uaz3uK5zyiZ50PBtVGngPdq',
]);

type Maybe<T> = { ok: true; value: T } | { ok: false; error: string };
const attempt = async <T,>(fn: () => Promise<T>): Promise<Maybe<T>> => {
  try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
};
const val = <T,>(m: Maybe<T>): T | null => (m.ok ? m.value : null);

async function newAccounts(since: string): Promise<number> {
  const { count, error } = await getCountClient().from('user_notification_settings')
    .select('user_email', { count: 'exact', head: true }).gte('created_at', since);
  if (error) throw new Error(error.message);
  if (count === null) throw new Error('count unavailable');
  return count;
}

async function trialStarts(sinceSec: number): Promise<number> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe not configured');
  const stripe = new Stripe(key);
  let n = 0;
  for await (const s of stripe.checkout.sessions.list({ created: { gte: sinceSec }, status: 'complete', limit: 100 })) {
    const link = typeof s.payment_link === 'string' ? s.payment_link : s.payment_link?.id;
    if (link && TRIAL_LINK_IDS.has(link)) n++;
  }
  return n;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(Math.max(Number(sp.get('days')) || 30, 1), 365);
  const sinceMs = Date.now() - days * 86400_000;
  const since = new Date(sinceMs).toISOString();

  const paths = ['/', '/pricing', ...LEAD_MAGNETS.map((m) => m.path)];
  const [visitors, fromHome, accounts, trials, ...magnetRegs] = await Promise.all([
    attempt(() => pageVisitors(paths, days)),
    attempt(() => visitorsFromHomepage('/pricing', days)),
    attempt(() => newAccounts(since)),
    attempt(() => trialStarts(Math.floor(sinceMs / 1000))),
    ...LEAD_MAGNETS.map((m) => attempt(() => countContactsByTag(m.tag))),
  ]);
  const v = val(visitors);
  const visit = (p: string) => (v ? (v[p] ?? null) : null);

  const report = {
    success: true, days, since,
    leadMagnets: LEAD_MAGNETS.map((m, i) => {
      const regs = val(magnetRegs[i]);
      return { name: m.name, path: m.path, visitors: visit(m.path), registrations: regs, rate: rate(regs, visit(m.path)) };
    }),
    pricing: {
      visitors: visit('/pricing'),
      newAccounts: val(accounts), accountRate: rate(val(accounts), visit('/pricing')),
      trialsStarted: val(trials), trialRate: rate(val(trials), visit('/pricing')),
    },
    homepage: {
      visitors: visit('/'), toPricing: val(fromHome), rate: rate(val(fromHome), visit('/')),
    },
    errors: {
      ga4: visitors.ok ? undefined : visitors.error, ga4Referrer: fromHome.ok ? undefined : fromHome.error,
      accounts: accounts.ok ? undefined : accounts.error, stripe: trials.ok ? undefined : trials.error,
      ghl: magnetRegs.some((m) => !m.ok) ? magnetRegs.map((m) => (m.ok ? 'ok' : m.error)) : undefined,
    },
    notes: [
      'Visitors = Google Analytics active users who viewed that page in the window.',
      'Lead-magnet registrations = every GHL contact with that tag (all-time), so the rate is most accurate when the window covers the whole campaign.',
      'New accounts = alert-settings rows created in the window (every new account gets one).',
      'Trials started = completed Stripe checkouts on the four 14-day trial links.',
    ],
  };
  if (sp.get('format') === 'json') return NextResponse.json(report);

  const n = (x: number | null) => (x === null ? '<span class="na">unavailable</span>' : x.toLocaleString('en-US'));
  const row = (label: string, a: string, b: string, r: string) => `<tr><td>${label}</td><td class="n">${a}</td><td class="n">${b}</td><td class="n r">${r}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conversions</title>
<style>body{font:14px/1.45 Inter,system-ui,sans-serif;color:#12100E;background:#FBFAF7;margin:0;padding:28px}h1{font:600 24px Georgia,serif;margin:0 0 4px}h2{font:600 17px Georgia,serif;margin:26px 0 8px}.sub{color:#6B6459;margin:0 0 6px}
table{width:100%;max-width:820px;border-collapse:collapse;background:#fff;border:1px solid #DCD8CF}th,td{padding:9px 12px;border-bottom:1px solid #EDEAE3;text-align:left}th{background:#F3F0E9;font-size:12px}.n{text-align:right}.r{font-weight:700}.na{color:#B42318}</style></head><body>
<h1>Conversions</h1><p class="sub">Last ${days} days (since ${since.slice(0, 10)}). Add <code>&amp;days=7</code> to change it, <code>&amp;format=json</code> for raw data.</p>
<h2>Lead magnets</h2><table><thead><tr><th>Page</th><th class="n">Visitors</th><th class="n">Registered</th><th class="n">Rate</th></tr></thead><tbody>
${report.leadMagnets.map((m) => row(`${m.name}<div class="sub">${m.path}</div>`, n(m.visitors), n(m.registrations), m.rate)).join('')}</tbody></table>
<h2>Pricing page → sign-ups</h2><table><thead><tr><th>Step</th><th class="n">Pricing visitors</th><th class="n">Converted</th><th class="n">Rate</th></tr></thead><tbody>
${row('New accounts', n(report.pricing.visitors), n(report.pricing.newAccounts), report.pricing.accountRate)}
${row('14-day trials started', n(report.pricing.visitors), n(report.pricing.trialsStarted), report.pricing.trialRate)}</tbody></table>
<h2>Homepage → pricing page</h2><table><thead><tr><th>Step</th><th class="n">Homepage visitors</th><th class="n">Went to pricing</th><th class="n">Rate</th></tr></thead><tbody>
${row('Clicked through to /pricing', n(report.homepage.visitors), n(report.homepage.toPricing), report.homepage.rate)}</tbody></table>
<p class="sub" style="margin-top:18px">${report.notes.join('<br>')}</p></body></html>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
