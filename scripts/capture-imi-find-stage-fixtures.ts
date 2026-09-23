/**
 * Capture the FROZEN acquisition-stage sample for the IMI FIND tests (read-only, Workstream C).
 * Separate from capture-imi-find-fixtures.ts so re-running it never rewrites the company/notice
 * snapshots Workstream A froze.
 *
 *   npx tsx scripts/capture-imi-find-stage-fixtures.ts     # writes stage-sample.json
 *
 * READ-ONLY by construction: Supabase `select` only. For every stage rule it records a few ACTIVE
 * notices the rule's own PostgREST predicate admits, plus NEGATIVE controls a naive keyword match
 * would wrongly admit (an Award Notice titled "IDIQ", a solicitation titled "RFI", a J&A naming an
 * OTA). It also records the live per-group counts at capture time so a test can show the measured
 * denominator next to the frozen sample.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { STAGE_RULES, ACQUISITION_STAGE_GROUPS, stageOrExpr, stageRuleExpr, unknownStageOrExpr } from '../src/lib/opportunities/acquisition-stage';

const OUT = join(process.cwd(), 'src/lib/opportunities/__fixtures__/imi-find/stage-sample.json');
const CAPTURED_AT = new Date().toISOString();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const COLS = 'notice_id, solicitation_number, title, notice_type, active';
const PER_RULE = 4;

async function main() {
  const rows: Array<Record<string, unknown>> = [];
  const queries: string[] = [];
  for (const r of STAGE_RULES) {
    const expr = stageRuleExpr(r);
    const { data, error } = await sb.from('sam_opportunities').select(COLS).eq('active', true).or(expr).order('notice_id').limit(PER_RULE);
    if (error) throw error;
    queries.push(`${r.group}/${r.signal}: select ${COLS} where active and (${expr}) order by notice_id limit ${PER_RULE}`);
    for (const d of data || []) rows.push({ ...d, _sampled_for: `${r.group}/${r.signal}` });
  }
  // Negative controls — a keyword match without the structured notice type must NOT admit these.
  const negatives: Array<[string, string, string]> = [
    ['award_notice_titled_vehicle', 'Award Notice', '\\m(idiq|matoc|macc|bpa)\\M'],
    ['solicitation_titled_rfi', '(solicitation|combined)', '\\m(rfi|request for information)\\M'],
    ['justification_naming_non_far', 'justification', '\\m(ota|other transaction|baa|cso)\\M'],
    ['special_notice_plain', 'special notice', '\\m(industry day|notice of intent)\\M'],
  ];
  for (const [tag, nt, title] of negatives) {
    const { data, error } = await sb.from('sam_opportunities').select(COLS).eq('active', true)
      .filter('notice_type', 'imatch', nt).filter('title', 'imatch', title).order('notice_id').limit(3);
    if (error) throw error;
    queries.push(`negative ${tag}: select ${COLS} where active and notice_type ~* '${nt}' and title ~* '${title}' order by notice_id limit 3`);
    for (const d of data || []) rows.push({ ...d, _sampled_for: `negative/${tag}` });
  }
  const live: Record<string, number | null> = {};
  for (const g of ACQUISITION_STAGE_GROUPS) {
    const { count, error } = await sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true).or(stageOrExpr(g));
    live[g] = error ? null : count ?? null;
  }
  {
    const { count, error } = await sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true).or(unknownStageOrExpr());
    live.UNKNOWN_NOTICE_TYPE = error ? null : count ?? null;
  }
  {
    const { count, error } = await sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true);
    live.ACTIVE_TOTAL = error ? null : count ?? null;
  }
  writeFileSync(OUT, `${JSON.stringify({
    _provenance: {
      captured_at: CAPTURED_AT,
      source: 'supabase.sam_opportunities (active = true)',
      query: queries,
      live_counts_at_capture: live,
      note: 'Each row carries _sampled_for (the rule or negative control it was drawn for). The test re-derives every classification from the frozen notice_type + title.',
    },
    data: rows,
  }, null, 2)}\n`);
  console.log('wrote stage-sample.json', rows.length, 'rows', JSON.stringify(live));
}

main().catch((e) => { console.error(e); process.exit(1); });
