/**
 * GET /api/admin/conversions?password=<ADMIN_PASSWORD>&range=today|yesterday|week|month|year|7d|30d|90d
 *     (or &range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD). Dates are US Eastern; default last 30 days.
 * Every number is read live for that window (2026-11-12):
 *   1. Lead magnets — page visitors (GA4) vs registrations (GHL contacts with the tag, added in the window).
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
import { avgEngagedSeconds, formatDuration, pageVisitors, rate, trialButtonClickers, visitorsFromHomepage } from '@/lib/ga4/conversions';
import { easternDate, resolveRange, type DateRange } from '@/lib/admin/date-range';

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

async function newAccounts(startIso: string, endIso: string): Promise<number> {
  const { count, error } = await getCountClient().from('user_notification_settings')
    .select('user_email', { count: 'exact', head: true }).gte('created_at', startIso).lt('created_at', endIso);
  if (error) throw new Error(error.message);
  if (count === null) throw new Error('count unavailable');
  return count;
}

async function trialStarts(startSec: number, endSec: number): Promise<number> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe not configured');
  const stripe = new Stripe(key);
  let n = 0;
  for await (const s of stripe.checkout.sessions.list({ created: { gte: startSec, lt: endSec }, status: 'complete', limit: 100 })) {
    const link = typeof s.payment_link === 'string' ? s.payment_link : s.payment_link?.id;
    if (link && TRIAL_LINK_IDS.has(link)) n++;
  }
  return n;
}

/** Mindy subscription products (Stripe). App = Pro/Team; credits = MCP credit plans. */
const APP_PRODUCTS = new Set(['prod_UI5RXVGKsdywuf']);
const CREDIT_PRODUCTS = new Set(['prod_UumkGov5iWq6yV', 'prod_UumkgIa3mxdZeA', 'prod_VGXw6X6F4tSZvz']);
type PaidCount = { app: number; credits: number };

/** Paid Mindy subscriptions in [startSec, endSec), by Eastern day and month (abandoned checkouts excluded). */
async function paidSignups(startSec: number, endSec: number): Promise<{ byDay: Record<string, PaidCount>; byMonth: Record<string, PaidCount> }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe not configured');
  const stripe = new Stripe(key);
  const byDay: Record<string, PaidCount> = {};
  const byMonth: Record<string, PaidCount> = {};
  // A trial is not a sale: it counts on the day the card is first charged (trial end), and only if
  // it didn't cancel first. Look back 30 extra days so trials that convert inside the window are found.
  const nowSec = Math.floor(Date.now() / 1000);
  for await (const s of stripe.subscriptions.list({ created: { gte: startSec - 30 * 86400, lt: endSec }, status: 'all', limit: 100 })) {
    if (s.status === 'incomplete_expired' || s.status === 'incomplete' || s.status === 'trialing') continue;
    const paidAt = s.trial_end ?? s.created;
    if (paidAt > nowSec || paidAt < startSec || paidAt >= endSec) continue;
    if (s.trial_end && s.canceled_at && s.canceled_at <= s.trial_end) continue;
    const product = s.items.data[0]?.price?.product;
    const pid = typeof product === 'string' ? product : product?.id;
    const kind = pid && APP_PRODUCTS.has(pid) ? 'app' : pid && CREDIT_PRODUCTS.has(pid) ? 'credits' : null;
    if (!kind) continue;
    const day = easternDate(paidAt * 1000);
    (byDay[day] ??= { app: 0, credits: 0 })[kind]++;
    (byMonth[day.slice(0, 7)] ??= { app: 0, credits: 0 })[kind]++;
  }
  return { byDay, byMonth };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const range = resolveRange({ range: sp.get('range'), from: sp.get('from'), to: sp.get('to') });
  const startIso = new Date(range.startMs).toISOString();
  const endIso = new Date(range.endMs).toISOString();
  const startSec = Math.floor(range.startMs / 1000);
  const endSec = Math.ceil(range.endMs / 1000);
  const dates = { startDate: range.from, endDate: range.to };

  const paths = ['/', '/pricing', ...LEAD_MAGNETS.map((m) => m.path)];
  const [visitors, fromHome, accounts, trials, paid, clickers, pricingTime, ...magnetRegs] = await Promise.all([
    attempt(() => pageVisitors(paths, dates)),
    attempt(() => visitorsFromHomepage('/pricing', dates)),
    attempt(() => newAccounts(startIso, endIso)),
    attempt(() => trialStarts(startSec, endSec)),
    attempt(() => paidSignups(startSec, endSec)),
    attempt(() => trialButtonClickers('/pricing', dates)),
    attempt(() => avgEngagedSeconds('/pricing', dates)),
    ...LEAD_MAGNETS.map((m) => attempt(() => countContactsByTag(m.tag, fetch, { gte: startIso, lte: endIso }))),
  ]);
  const v = val(visitors);
  const visit = (p: string) => (v ? (v[p] ?? null) : null);

  const report = {
    success: true, range: { preset: range.preset, from: range.from, to: range.to, label: range.label, start: startIso, end: endIso },
    leadMagnets: LEAD_MAGNETS.map((m, i) => {
      const regs = val(magnetRegs[i]);
      return { name: m.name, path: m.path, visitors: visit(m.path), registrations: regs, rate: rate(regs, visit(m.path)) };
    }),
    pricing: {
      visitors: visit('/pricing'),
      newAccounts: val(accounts), accountRate: rate(val(accounts), visit('/pricing')),
      trialsStarted: val(trials), trialRate: rate(val(trials), visit('/pricing')),
      trialClickers: val(clickers)?.people ?? null, trialClicks: val(clickers)?.clicks ?? null,
      trialClickRate: rate(val(clickers)?.people ?? null, visit('/pricing')),
      checkoutCompletion: rate(val(trials), val(clickers)?.people ?? null),
      avgEngagedSeconds: val(pricingTime), avgEngagedTime: formatDuration(val(pricingTime)),
    },
    homepage: {
      visitors: visit('/'), toPricing: val(fromHome), rate: rate(val(fromHome), visit('/')),
    },
    paidSignups: val(paid) ?? { byDay: null, byMonth: null },
    errors: {
      ga4: visitors.ok ? undefined : visitors.error, ga4Referrer: fromHome.ok ? undefined : fromHome.error,
      accounts: accounts.ok ? undefined : accounts.error, stripe: trials.ok ? undefined : trials.error,
      paidSignups: paid.ok ? undefined : paid.error,
      ga4TrialClicks: clickers.ok ? undefined : clickers.error,
      ga4PricingTime: pricingTime.ok ? undefined : pricingTime.error,
      ghl: magnetRegs.some((m) => !m.ok) ? magnetRegs.map((m) => (m.ok ? 'ok' : m.error)) : undefined,
    },
    notes: [
      'Dates are US Eastern time. Visitors = Google Analytics active users who viewed that page in the window.',
      'Lead-magnet registrations = GHL contacts with that tag whose contact was created in the window (someone already on your list who registers counts on the day they first joined the list).',
      'New accounts = alert-settings rows created in the window (every new account gets one).',
      'Trials started = completed Stripe checkouts on the four 14-day trial links.',
      'Clicked a trial button = people on /pricing who clicked "Start 14-day trial" (Google Analytics; our trial_click event plus GA4 outbound clicks to Stripe checkout). Checkout completion = trials started ÷ people who clicked.',
      'Avg time on pricing = Google Analytics engaged time on /pricing per visitor (time the tab was in front of them).',
      'Paid sign-ups = new Stripe subscriptions to Mindy (App = Pro/Team, Credits = MCP credit plans), by Eastern date; a free trial counts on the day it is first charged, abandoned checkouts and trials that cancel are excluded, one-time purchases not counted.',
    ],
  };
  if (sp.get('format') === 'json') return NextResponse.json(report);

  return new NextResponse(renderHtml(report, val(paid), range, sp.get('password') ?? ''), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

type Report = {
  leadMagnets: { name: string; path: string; visitors: number | null; registrations: number | null; rate: string }[];
  pricing: {
    visitors: number | null; newAccounts: number | null; accountRate: string; trialsStarted: number | null; trialRate: string;
    trialClickers: number | null; trialClicks: number | null; trialClickRate: string; checkoutCompletion: string; avgEngagedTime: string;
  };
  homepage: { visitors: number | null; toPricing: number | null; rate: string };
  notes: string[];
};
type Paid = { byDay: Record<string, PaidCount>; byMonth: Record<string, PaidCount> } | null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fmt = (x: number | null) => (x === null ? '<span class="bad">unavailable</span>' : x.toLocaleString('en-US'));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function tile(label: string, num: string, sub: string) {
  return `<div class="tile"><span class="label">${label}</span><span class="num">${num}</span><span class="sub">${sub}</span></div>`;
}
/** Horizontal bars, widths relative to the first (largest) step. */
function bars(steps: { label: string; value: number | null; note?: string }[], color: string) {
  const max = Math.max(1, ...steps.map((s) => s.value ?? 0));
  return `<div class="funnel">${steps.map((s) => {
    const w = s.value === null ? 0 : Math.max(2, (s.value / max) * 100);
    return `<div class="step"><span>${s.label}</span><div class="track"><div class="bar" style="width:${w}%;background:${color}"></div><span class="val">${fmt(s.value)}${s.note ? ` <span class="muted">· ${s.note}</span>` : ''}</span></div></div>`;
  }).join('')}</div>`;
}

const PICKER: [string, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days']];

function picker(range: DateRange, password: string): string {
  const pw = encodeURIComponent(password);
  const links = PICKER.map(([k, l]) => `<a class="chip"${range.preset === k ? ' aria-current="true"' : ''} href="?password=${pw}&amp;range=${k}">${l}</a>`).join('');
  return `<nav class="picker" aria-label="Date range">${links}
<form class="custom" method="get"><input type="hidden" name="password" value="${esc(password)}"><input type="hidden" name="range" value="custom">
<label>From <input type="date" id="from" name="from" value="${range.from}" required></label><label>To <input type="date" id="to" name="to" value="${range.to}" required></label><button type="submit"${range.preset === 'custom' ? ' aria-current="true"' : ''}>Apply</button></form></nav>`;
}

function renderHtml(r: Report, paid: Paid, range: DateRange, password: string): string {
  const months = paid ? Object.keys(paid.byMonth).sort() : [];
  const daysList = paid ? Object.keys(paid.byDay).sort().reverse() : [];
  const sum = (o: Record<string, PaidCount>) => Object.values(o).reduce((a, c) => a + c.app + c.credits, 0);
  const paidTotal = paid ? sum(paid.byMonth) : null;
  const spanDays = Math.round((Date.UTC(+range.to.slice(0, 4), +range.to.slice(5, 7) - 1, +range.to.slice(8)) - Date.UTC(+range.from.slice(0, 4), +range.from.slice(5, 7) - 1, +range.from.slice(8))) / 86400_000) + 1;
  const appTotal = paid ? Object.values(paid.byMonth).reduce((a, c) => a + c.app, 0) : null;
  const creditTotal = paid ? Object.values(paid.byMonth).reduce((a, c) => a + c.credits, 0) : null;
  const mindyDay = r.leadMagnets[0];

  const take = [
    r.pricing.visitors !== null ? `<b>${fmt(r.pricing.visitors)}</b> people saw the pricing page` : '',
    r.pricing.trialsStarted !== null ? `and <b>${fmt(r.pricing.trialsStarted)}</b> started a free trial (${r.pricing.trialRate}).` : '.',
    paidTotal !== null ? `<b>${paidTotal}</b> paid sign-up${paidTotal === 1 ? '' : 's'}.` : '',
  ].filter(Boolean).join(' ');

  const monthRows = months.slice().reverse().map((m) => {
    const c = paid!.byMonth[m];
    return `<tr><td>${monthName(m)}</td><td class="r">${c.app}</td><td class="r">${c.credits}</td><td class="r"><b>${c.app + c.credits}</b></td></tr>`;
  }).join('');
  const dayRows = daysList.map((d) => {
    const c = paid!.byDay[d];
    return `<tr><td>${dayName(d)}</td><td class="r">${c.app}</td><td class="r">${c.credits}</td><td class="r"><b>${c.app + c.credits}</b></td></tr>`;
  }).join('');
  const table = (rows: string, first: string) => `<div class="tablewrap"><table><thead><tr><th>${first}</th><th class="r">App (Pro/Team)</th><th class="r">Credit plans</th><th class="r">Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No paid sign-ups.</td></tr>'}</tbody></table></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conversions</title>
<style>
:root{--fg:#1f1e1d;--muted:#73716b;--bg:#faf9f5;--panel:#fff;--line:#e8e6dc;--grid:#f0eee6;--ok:#2f7d4f;--bad:#b42318;--c1:#c96442;--c2:#4f6fa8;--c3:#6a8a4f;--serif:Georgia,'Times New Roman',serif;--sans:Inter,system-ui,-apple-system,sans-serif}
@media (prefers-color-scheme:dark){:root{--fg:#ecebe6;--muted:#a3a19a;--bg:#1f1e1d;--panel:#2a2927;--line:#3a3936;--grid:#34332f;--c1:#d97757;--c2:#7d9bd6;--c3:#8fb06f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 var(--sans)}
.wrap{max-width:1100px;margin:0 auto;padding:32px 16px 64px;display:grid;gap:28px}
h1{font:400 34px/1.15 var(--serif);margin:0}h2{margin:0;font-size:18px;font-weight:600}h3{margin:0;font-size:16px;font-weight:600}
.head p{margin:6px 0 0;color:var(--muted)}.head .take{color:var(--fg)}b{font-weight:600}
.sec{display:grid;gap:14px}.note{margin:0;color:var(--muted);font-size:13px}
.tiles{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))}
.tile,.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;display:grid;gap:6px;align-content:start;min-width:0}
.card{gap:14px}.grid2{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))}
.label{font-size:13px;color:var(--muted)}.num{font:400 34px/1.15 var(--serif);font-variant-numeric:tabular-nums}.sub{font-size:13px;color:var(--muted)}
.funnel{display:grid;gap:10px}.step{display:grid;grid-template-columns:minmax(7rem,11rem) 1fr;gap:10px;align-items:center;font-size:13px}
.track{position:relative;height:30px;background:var(--grid);border-radius:8px;overflow:hidden}.bar{position:absolute;inset:0 auto 0 0;border-radius:8px;opacity:.85}
.val{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-variant-numeric:tabular-nums;white-space:nowrap}
.tablewrap{overflow:auto;max-height:30rem}table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th{position:sticky;top:0;background:var(--panel);text-align:left;font-weight:600;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:8px 10px;border-bottom:1px solid var(--line)}.r{text-align:right}.muted{color:var(--muted)}.bad{color:var(--bad)}.ok{color:var(--ok)}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line)}.tab{font:inherit;background:none;border:0;border-bottom:2px solid transparent;padding:10px 16px;color:var(--muted);cursor:pointer;margin-bottom:-1px}
.tab[aria-selected=true]{color:var(--fg);border-bottom-color:currentColor;font-weight:600}.pane{display:grid;gap:28px}
.cols{display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:8px}.col{flex:1;display:grid;gap:4px;justify-items:center;font-size:12px;color:var(--muted);min-width:0}
.colbar{width:100%;max-width:56px;border-radius:6px 6px 0 0;display:flex;flex-direction:column-reverse;overflow:hidden}
.picker{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.chip,.custom button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--fg);text-decoration:none;cursor:pointer}
.chip[aria-current=true],.custom button[aria-current=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}.custom{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;color:var(--muted)}
.custom input{font:inherit;font-size:13px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--fg)}
.legend{display:flex;gap:16px;font-size:13px;color:var(--muted)}.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
</style></head><body><div class="wrap">
<header class="head"><h1>Conversions</h1><p>${esc(range.label)} · live · Eastern time</p><p class="take">${take}</p></header>
${picker(range, password)}
<div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="funnel" aria-selected="true">Funnel</button><button class="tab" role="tab" data-tab="paid" aria-selected="false">Paid sign-ups</button></div>

<div class="pane" id="funnel">
<section class="sec"><div class="tiles">
${tile('Homepage visitors', fmt(r.homepage.visitors), `${r.homepage.rate} went to pricing`)}
${tile('Pricing visitors', fmt(r.pricing.visitors), `${fmt(r.homepage.toPricing)} came from the homepage`)}
${tile('Clicked a trial button', fmt(r.pricing.trialClickers), `${r.pricing.trialClickRate} of pricing visitors`)}
${tile('Avg time on pricing', esc(r.pricing.avgEngagedTime), 'Engaged time per visitor')}
${tile('Trials started', fmt(r.pricing.trialsStarted), `${r.pricing.trialRate} of pricing visitors`)}
${tile('New accounts', fmt(r.pricing.newAccounts), `${r.pricing.accountRate} of pricing visitors`)}
${tile('Mindy Day registered', fmt(mindyDay?.registrations ?? null), `${mindyDay?.rate ?? '—'} of page visitors`)}
</div></section>

<section class="sec"><h2>Customer flow</h2><div class="grid2">
<div class="card"><h3>Homepage → pricing → sign-up</h3>${bars([
    { label: 'Homepage visitors', value: r.homepage.visitors },
    { label: 'Went to pricing', value: r.homepage.toPricing, note: r.homepage.rate },
    { label: 'All pricing visitors', value: r.pricing.visitors },
    { label: 'Clicked a trial button', value: r.pricing.trialClickers, note: r.pricing.trialClickRate },
    { label: 'Trials started', value: r.pricing.trialsStarted, note: `${r.pricing.checkoutCompletion} of clickers` },
    { label: 'New accounts (any source)', value: r.pricing.newAccounts, note: r.pricing.accountRate },
  ], 'var(--c1)')}</div>
${r.leadMagnets.map((m) => `<div class="card"><h3>${esc(m.name)}</h3><p class="note">${esc(m.path)}</p>${bars([
    { label: 'Page visitors', value: m.visitors },
    { label: 'Registered', value: m.registrations, note: m.rate },
  ], 'var(--c2)')}</div>`).join('')}
</div></section>
</div>

<div class="pane" id="paid" hidden>
<section class="sec"><div class="tiles">
${tile('Paid sign-ups', fmt(paidTotal), `${fmt(appTotal)} app · ${fmt(creditTotal)} credit plans`)}
${tile('Free trials started', fmt(r.pricing.trialsStarted), 'Become paid when first charged')}
${tile('Days with a sign-up', paid ? String(daysList.length) : fmt(null), `out of ${spanDays}`)}
</div></section>
<section class="sec"><h2>Month by month</h2><div class="card">
<div class="legend"><span><span class="dot" style="background:var(--c1)"></span>App (Pro/Team)</span><span><span class="dot" style="background:var(--c2)"></span>Credit plans</span></div>
<div class="cols">${(() => {
    const max = Math.max(1, ...months.map((m) => paid!.byMonth[m].app + paid!.byMonth[m].credits));
    return months.map((m) => {
      const c = paid!.byMonth[m];
      const h = ((c.app + c.credits) / max) * 110;
      return `<div class="col"><b style="color:var(--fg)">${c.app + c.credits}</b><div class="colbar" style="height:${h}px"><div style="flex:${c.app};background:var(--c1)"></div><div style="flex:${c.credits};background:var(--c2)"></div></div><span>${monthName(m).slice(0, 3)}</span></div>`;
    }).join('');
  })()}</div>
${table(monthRows, 'Month')}</div></section>
<section class="sec"><h2>Day by day</h2><p class="note">Only days with at least one paid sign-up.</p><div class="card">${table(dayRows, 'Day')}</div></section>
</div>

<p class="note">${r.notes.map(esc).join('<br>')}</p>
</div>
<script>
document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){
  document.querySelectorAll('.tab').forEach(function(x){x.setAttribute('aria-selected',String(x===b));});
  document.querySelectorAll('.pane').forEach(function(p){p.hidden=p.id!==b.dataset.tab;});
});});
</script></body></html>`;
}
