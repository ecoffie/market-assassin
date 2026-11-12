/**
 * GET /api/admin/daily-visitors?password=<ADMIN_PASSWORD>&days=30
 * How many people visit getmindy.ai each day (Google Analytics 4, property "Mindy — Web").
 * Visitors = GA4 active users. HTML by default, `&format=json` for raw data.
 * A GA failure is an error page with the fix, never a zero.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { getDailyVisitors } from '@/lib/ga4/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(Math.max(Number(sp.get('days')) || 30, 2), 365);
  try {
    const report = { success: true, ...(await getDailyVisitors(days)) };
    if (sp.get('format') === 'json') return NextResponse.json(report);
    return new NextResponse(renderHtml(report, days), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'GA4 request failed';
    console.error('[daily-visitors]', error);
    return NextResponse.json({ success: false, error }, { status: 502 });
  }
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const n = (v: number) => (Number.isFinite(v) ? v.toLocaleString() : '—');

function renderHtml(r: Awaited<ReturnType<typeof getDailyVisitors>>, days: number) {
  const max = Math.max(1, ...r.days.map((d) => d.visitors));
  const bars = r.days.map((d) => `<div class="bar" title="${d.date}: ${d.visitors} visitors"><span style="height:${Math.round((d.visitors / max) * 100)}%"></span></div>`).join('');
  const rows = [...r.days].reverse().map((d) => `<tr><td>${d.date}</td><td class="n"><b>${n(d.visitors)}</b></td><td class="n">${n(d.newVisitors)}</td><td class="n">${n(d.sessions)}</td><td class="n">${n(d.pageViews)}</td></tr>`).join('');
  const list = (items: Array<{ name: string; value: number }>) => items.map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${n(i.value)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daily visitors</title>
<style>body{font:14px/1.45 Inter,system-ui,sans-serif;color:#12100E;background:#FBFAF7;margin:0;padding:28px}h1{font:600 24px Georgia,serif;margin:0 0 4px}h2{font:600 16px Georgia,serif;margin:22px 0 8px}.sub{color:#6B6459;margin:0 0 18px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:18px}.card{background:#fff;border:1px solid #DCD8CF;border-radius:12px;padding:14px 16px}
.l{color:#6B6459;font-size:12px;text-transform:uppercase;letter-spacing:.06em}.v{font:600 26px Georgia,serif;margin-top:4px}
.chart{display:flex;align-items:flex-end;gap:3px;height:140px;background:#fff;border:1px solid #DCD8CF;border-radius:12px;padding:12px}.bar{flex:1;height:100%;display:flex;align-items:flex-end}.bar span{display:block;width:100%;background:#047857;border-radius:3px 3px 0 0;min-height:2px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #DCD8CF}th,td{padding:8px 10px;border-bottom:1px solid #EDEAE3;text-align:left}th{background:#F3F0E9;font-size:12px}.n{text-align:right}</style></head><body>
<h1>Daily visitors to getmindy.ai</h1><p class="sub">Last ${days} days · Google Analytics (property ${esc(r.propertyId)}). Visitors = unique active users per day. Today is still in progress.</p>
<div class="cards"><div class="card"><div class="l">Average per day</div><div class="v">${r.averageDailyVisitors === null ? '—' : n(r.averageDailyVisitors)}</div><div class="sub">over ${r.fullDaysCounted} full days</div></div>
<div class="card"><div class="l">Yesterday</div><div class="v">${n(r.days.at(-2)?.visitors ?? NaN)}</div></div>
<div class="card"><div class="l">Today so far</div><div class="v">${n(r.today?.visitors ?? NaN)}</div></div></div>
<div class="chart">${bars}</div>
<div class="grid"><div><h2>By day</h2><table><thead><tr><th>Date</th><th class="n">Visitors</th><th class="n">New</th><th class="n">Sessions</th><th class="n">Page views</th></tr></thead><tbody>${rows}</tbody></table></div>
<div><h2>Top pages</h2><table><thead><tr><th>Page</th><th class="n">Views</th></tr></thead><tbody>${list(r.topPages)}</tbody></table>
<h2>Where visitors come from</h2><table><thead><tr><th>Source</th><th class="n">Visitors</th></tr></thead><tbody>${list(r.topSources)}</tbody></table></div></div>
<p class="sub" style="margin-top:14px">Change the window with <code>&amp;days=7</code> (up to 365). Add <code>&amp;format=json</code> for raw data.</p></body></html>`;
}
