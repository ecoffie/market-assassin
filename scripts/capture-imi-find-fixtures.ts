/**
 * Capture the FROZEN IMI FIND fixtures (read-only). Re-run only to refresh the snapshot; the
 * tests read the JSON under src/lib/opportunities/__fixtures__/imi-find/ and never touch prod.
 *
 *   npx tsx scripts/capture-imi-find-fixtures.ts            # writes the fixture files
 *
 * READ-ONLY by construction: Supabase `select` + Vercel KV `get` only. It deliberately does NOT go
 * through lib/sam/utils.checkCache (that path increments sam_api_cache.hit_count — a write) and
 * never calls live SAM. Every file records table + filter + capture time in `_provenance`.
 *
 * Acceptance client: Industrial Mechanical Inc. (IMI), UEI M66AH329AJM6, Watkinsville GA.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const OUT = join(process.cwd(), 'src/lib/opportunities/__fixtures__/imi-find');
const IMI_UEI = 'M66AH329AJM6';
const CAPTURED_AT = new Date().toISOString();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Same derivation as lib/sam/utils.generateCacheKey — duplicated so this script cannot write. */
function samCacheKey(apiType: string, params: Record<string, unknown>) {
  return crypto.createHash('md5').update(`${apiType}:${JSON.stringify(params, Object.keys(params).sort())}`).digest('hex');
}

function write(name: string, provenance: Record<string, unknown>, data: unknown) {
  writeFileSync(join(OUT, name), `${JSON.stringify({ _provenance: { captured_at: CAPTURED_AT, ...provenance }, data }, null, 2)}\n`);
  console.log('wrote', name);
}

const NOTICE_COLS =
  'notice_id, title, department, sub_tier, naics_code, psc_code, description, set_aside_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number, pop_state, pop_city, office_address, active, posted_date';
const RECOMPETE_COLS =
  'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,naics_code,naics_description,psc_code,psc_description,description,potential_total_value,total_obligation,period_of_performance_current_end,place_of_performance_state,place_of_performance_city,set_aside_type,recompete_likelihood,contract_type';

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 1 · IMI SAM entity — the raw Entity API response lookup_sam_entity reads (cache-first).
  const key = samCacheKey('entity', { ueiSAM: IMI_UEI });
  const { data: cacheRow, error: cacheErr } = await sb.from('sam_api_cache')
    // unranged-ok: cache_key is UNIQUE; maybeSingle returns at most one row.
    .select('cache_key, api_type, query_params, fetched_at, expires_at, response_data').eq('cache_key', key).maybeSingle();
  if (cacheErr) throw cacheErr;
  if (!cacheRow) throw new Error(`no sam_api_cache entity row for ${IMI_UEI} — do not fall back to live SAM here`);
  const entity = { ...(cacheRow.response_data as { entityData: Record<string, unknown>[] }).entityData[0] };
  // Contact PII is irrelevant to FIND; keep the fixture free of it.
  delete entity.pointsOfContact;
  write('imi-entity.json', {
    source: 'supabase.sam_api_cache (SAM Entity Management API v3 response, as cached by lookup_sam_entity)',
    query: `select response_data where cache_key = md5('entity:{"ueiSAM":"${IMI_UEI}"}') → entityData[0]`,
    cache_fetched_at: cacheRow.fetched_at,
    note: 'pointsOfContact removed (PII, not used by FIND).',
  }, entity);

  // 2 · Known-fit notices from the IMI manual run (imi-test.md), all notice versions.
  const sols = ['W911KF-26-S-0023', 'W911KF-26-S-0024', 'FA8517-27-R-0056', 'FA480326B0006', 'W911KF25SC002'];
  const { data: notices, error: nErr } = await sb.from('sam_opportunities').select(NOTICE_COLS).in('solicitation_number', sols).limit(200);
  if (nErr) throw nErr;
  write('imi-notices.json', {
    source: 'supabase.sam_opportunities',
    query: `select ${NOTICE_COLS} where solicitation_number in (${sols.join(', ')})`,
    known_fit: {
      'W911KF-26-S-0023': 'Anniston Okuma machine tools RFI, PSC J034 (in IMI SAM PSCs), AL',
      'W911KF-26-S-0024': 'Anniston shot blast machine RFI, PSC J036 (in IMI SAM PSCs), AL',
      'FA8517-27-R-0056': 'Robins KC-135 spoiler actuator fixture sources sought, NAICS 488190, GA',
      FA480326B0006: 'Shaw FY27 MACC, small-business set-aside under 236220 — recalled but must screen NOT_ELIGIBLE',
      W911KF25SC002: 'Anniston CSO (special notice) — context only',
    },
  }, (notices || []).map((r) => ({ ...r, description: String(r.description || '').slice(0, 2000) })));

  // 3 · Tyonek orders — the A2 holder-name defect (recompete rows).
  const { data: ty, error: tErr } = await sb.from('recompete_opportunities').select(RECOMPETE_COLS)
    .ilike('incumbent_name', '%TYONEK MACHINING%').is('quality_flag', null).limit(200);
  if (tErr) throw tErr;
  write('tyonek-recompete.json', {
    source: 'supabase.recompete_opportunities',
    query: `select ${RECOMPETE_COLS} where incumbent_name ilike '%TYONEK MACHINING%' and quality_flag is null`,
    note: 'FA8571-23-D-0004 is a single-award 8(a) requirements contract for a Versatile Diagnostic Automated Test Station (NAICS 334515, PSC 4920). "Machining" appears ONLY in the holder name.',
  }, ty);

  // 4 · Buy-side positive controls: GA future recompetes whose DESCRIPTION names the work.
  const { data: ctrl, error: cErr } = await sb.from('recompete_opportunities').select(RECOMPETE_COLS)
    .is('quality_flag', null).eq('place_of_performance_state', 'GA').gte('period_of_performance_current_end', CAPTURED_AT.slice(0, 10))
    .or('description.imatch.\\mfabricat,description.imatch.\\mmachining\\M,description.imatch.\\mpiping\\M,description.imatch.\\mrigging\\M')
    .order('period_of_performance_current_end', { ascending: true }).limit(8);
  if (cErr) throw cErr;
  write('ga-buyside-recompete.json', {
    source: 'supabase.recompete_opportunities',
    query: "select … where place_of_performance_state='GA' and pop_end >= capture date and description ~* (fabricat|machining|piping|rigging) order by pop_end limit 8",
  }, ctrl);

  // 5 · get_contractor_profile award rows for IMI (BQ result cache in KV — GET only).
  const kvKey = 'bq:v4-2026-08-28:rollup:M66AH329AJM6:recent-awards:5:v4-m';
  const awards = await kv.get(kvKey);
  if (!Array.isArray(awards)) throw new Error(`KV ${kvKey} missing — not capturing a fabricated award list`);
  write('imi-recent-awards.json', {
    source: 'Vercel KV — BigQuery result cache read by get_contractor_profile (getRecentAwardsForRecipient)',
    query: `GET ${kvKey}`,
  }, awards);
}

main().catch((e) => { console.error(e); process.exit(1); });
