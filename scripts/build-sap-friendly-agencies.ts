#!/usr/bin/env npx tsx
/**
 * Re-derive the SAP-friendly-BUYER agency bands for src/lib/opportunities/sap-friendly-agencies.ts.
 *
 * PO-share = (PURCHASE ORDER + BPA CALL) / total awards, per normalized agency key, from
 * recompete_opportunities (quality_flag IS NULL), over agencies with >= MIN_ROWS award rows.
 * Also maps the real sam_opportunities.department taxonomy → tier (the query targets for the
 * Open-map filter), reporting the unclassified share so we stay honest about coverage.
 *
 * Read-only. Prints paste-able constants for AGENCY_PO_SHARE + SAM_DEPARTMENT_TIERS. Run when the
 * award data materially shifts (e.g. after a large recompete resync).
 *
 *   npx tsx scripts/build-sap-friendly-agencies.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { normalizeAgencyKey } from '../src/lib/gov-contacts/agency-key';
import { sapBuyerTier } from '../src/lib/opportunities/sap-friendly-agencies';

const MIN_ROWS = 200;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1) PO-share per normalized agency key from the AWARD data.
  type AwardRow = { awarding_agency: string | null; contract_type: string | null };
  const awards: AwardRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('recompete_opportunities')
      .select('awarding_agency,contract_type').is('quality_flag', null).range(from, from + 999);
    if (error) { console.error('ERR recompete_opportunities:', error.message); process.exit(1); }
    if (!data || !data.length) break;
    awards.push(...(data as AwardRow[]));
    if (data.length < 1000 || from > 300000) break;
  }
  const agg: Record<string, { po: number; tot: number }> = {};
  for (const r of awards) {
    const k = normalizeAgencyKey(r.awarding_agency || ''); if (!k) continue;
    const a = agg[k] || (agg[k] = { po: 0, tot: 0 });
    a.tot++; if (r.contract_type === 'PURCHASE ORDER' || r.contract_type === 'BPA CALL') a.po++;
  }
  const share = Object.entries(agg).filter(([, v]) => v.tot >= MIN_ROWS)
    .map(([k, v]) => ({ k, poPct: Math.round((v.po / v.tot) * 100), tot: v.tot }))
    .sort((a, b) => b.poPct - a.poPct);
  console.log('\n// AGENCY_PO_SHARE (measured ' + new Date().toISOString().slice(0, 10) + ', >= ' + MIN_ROWS + ' award rows):');
  console.log('export const AGENCY_PO_SHARE: Record<string, number> = {');
  for (const s of share) console.log(`  ${JSON.stringify(s.k)}: ${s.poPct},`);
  console.log('};');

  // 2) Map the REAL sam_opportunities.department taxonomy → tier (the Open-filter query targets).
  type DeptRow = { department: string | null };
  const opps: DeptRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('sam_opportunities')
      .select('department').eq('active', true).range(from, from + 999);
    if (error) { console.error('ERR sam_opportunities:', error.message); process.exit(1); }
    if (!data || !data.length) break;
    opps.push(...(data as DeptRow[]));
    if (data.length < 1000 || from > 100000) break;
  }
  const byTier: Record<string, Set<string>> = { most: new Set(), somewhat: new Set(), vehicle: new Set() };
  let unclassified = 0;
  for (const r of opps) {
    const d = r.department || ''; if (!d) { unclassified++; continue; }
    const t = sapBuyerTier(d);
    if (t) byTier[t].add(d); else unclassified++;
  }
  console.log('\n// SAM_DEPARTMENT_TIERS (real active sam_opportunities.department strings):');
  for (const t of ['most', 'somewhat', 'vehicle']) {
    console.log(`  ${t}: ${JSON.stringify([...byTier[t]])},`);
  }
  console.log(`\n// unclassified active opps: ${unclassified} of ${opps.length} (${Math.round((unclassified / opps.length) * 100)}%)`);
}
main();
