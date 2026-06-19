/**
 * Data Quality Audit — the "truth audit" across every cached/synced data source.
 *
 * Yesterday grounded Market Research's LIVE-query numbers. This audits the CACHED
 * tables those + other surfaces read from — for the "renders fine, <1% rot at the
 * extremes" problem (implausible values, round-number placeholders, nulls in key
 * fields, staleness). READ-ONLY: reports severity, fixes nothing (quarantine is a
 * separate step once we agree on thresholds).
 *
 * Run: npx tsx scripts/data-quality-audit.ts
 */
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Finding = { table: string; check: string; count: number; severity: 'HIGH' | 'MED' | 'LOW'; note: string };
const findings: Finding[] = [];
const add = (f: Finding) => findings.push(f);

async function cnt(table: string, build: (q: any) => any): Promise<number> {
  const { count, error } = await build(sb.from(table).select('*', { count: 'exact', head: true }));
  return error ? -1 : (count || 0);
}

async function audit() {
  // --- recompete_opportunities: $ values + dates ---
  {
    const t = 'recompete_opportunities';
    const total = await cnt(t, q => q);
    add({ table: t, check: 'total rows', count: total, severity: 'LOW', note: 'baseline' });
    add({ table: t, check: 'value > $100B (implausible)', count: await cnt(t, q => q.gt('potential_total_value', 100e9)), severity: 'HIGH', note: 'sorts to top of value views → shows on stage' });
    add({ table: t, check: 'round-number placeholder values', count: await cnt(t, q => q.in('potential_total_value', [1e8, 1e9, 1e11, 1e12])), severity: 'HIGH', note: 'parse artifacts; fake-looking on screen' });
    add({ table: t, check: 'expiry date in the past (already expired)', count: await cnt(t, q => q.lt('period_of_performance_current_end', '2026-06-19')), severity: 'MED', note: '"expiring" view should not show already-expired' });
    add({ table: t, check: 'null estimated_recompete_date', count: await cnt(t, q => q.is('estimated_recompete_date', null)), severity: 'LOW', note: 'feature gap, not corruption' });
  }
  // --- sam_opportunities: department granularity + body + dates ---
  {
    const t = 'sam_opportunities';
    add({ table: t, check: 'total rows', count: await cnt(t, q => q), severity: 'LOW', note: 'baseline' });
    add({ table: t, check: 'null/empty description (body)', count: await cnt(t, q => q.is('description', null)), severity: 'MED', note: 'body search/relevance degraded (was cache-wide empty; backfill running)' });
    add({ table: t, check: 'sub_tier null (no service-branch granularity)', count: await cnt(t, q => q.is('sub_tier', null)), severity: 'MED', note: 'cannot slice Navy/Army/AF under DoD — blocks Navy demo' });
    add({ table: t, check: 'archived/expired still present', count: await cnt(t, q => q.lt('response_deadline', '2026-06-19')), severity: 'LOW', note: 'expected if archive retained; confirm UI filters active-only' });
  }
  // --- agency_forecasts: pop_state + set_aside population (the filter targets) ---
  {
    const t = 'agency_forecasts';
    const total = await cnt(t, q => q);
    add({ table: t, check: 'total rows', count: total, severity: 'LOW', note: 'baseline' });
    add({ table: t, check: 'null pop_state', count: await cnt(t, q => q.is('pop_state', null)), severity: 'LOW', note: 'state filter only works on populated rows (~half)' });
    add({ table: t, check: 'null set_aside_type', count: await cnt(t, q => q.is('set_aside_type', null)), severity: 'LOW', note: 'set-aside filter only works on populated rows' });
  }
  // --- federal_contacts: email/name completeness ---
  {
    const t = 'federal_contacts';
    add({ table: t, check: 'total rows', count: await cnt(t, q => q), severity: 'LOW', note: 'baseline' });
    add({ table: t, check: 'null contact_email', count: await cnt(t, q => q.is('contact_email', null)), severity: 'MED', note: 'a contact with no email is low-value' });
    add({ table: t, check: 'null contact_fullname', count: await cnt(t, q => q.is('contact_fullname', null)), severity: 'MED', note: 'a contact with no name is unusable' });
  }
  // --- sba_goaling + agency_intelligence + sam_events: presence checks ---
  {
    add({ table: 'sba_goaling', check: 'total rows', count: await cnt('sba_goaling', q => q), severity: 'LOW', note: 'FY2023 goaling; powers % SB' });
    add({ table: 'agency_intelligence', check: 'total rows', count: await cnt('agency_intelligence', q => q), severity: 'LOW', note: 'pain points / patterns' });
    add({ table: 'sam_events', check: 'total rows', count: await cnt('sam_events', q => q), severity: 'LOW', note: 'industry days / events' });
    add({ table: 'sam_events', check: 'event_date in the past', count: await cnt('sam_events', q => q.lt('event_date', '2026-06-19')), severity: 'LOW', note: 'past events should be filtered in "upcoming" views' });
  }
}

audit().then(() => {
  console.log('\n================ DATA QUALITY AUDIT ================\n');
  const order = { HIGH: 0, MED: 1, LOW: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  let lastSev = '';
  for (const f of findings) {
    if (f.severity !== lastSev) { console.log(`\n--- ${f.severity} ---`); lastSev = f.severity; }
    const flag = (f.severity !== 'LOW' && f.count > 0) ? ' ⚠️' : '';
    console.log(`  [${f.table}] ${f.check}: ${f.count < 0 ? '(error)' : f.count.toLocaleString()}${flag}  — ${f.note}`);
  }
  const actionable = findings.filter(f => f.severity !== 'LOW' && f.count > 0).length;
  console.log(`\n>>> ${actionable} actionable findings (MED/HIGH with count>0). HIGH = fix before any demo.\n`);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
