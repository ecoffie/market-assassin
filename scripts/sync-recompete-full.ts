/**
 * Full USASpending -> recompete_opportunities sweep.
 *
 * Replaces the grouped/synthetic rows (data_source='contracts-data-import',
 * built by grouping awards on Recipient+Agency+NAICS and taking the group's
 * EARLIEST end date) with real per-contract rows that carry incumbent_uei.
 * See issue #280.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   npx tsx --env-file=.env.local scripts/sync-recompete-full.ts --top=10
 *   npx tsx --env-file=.env.local scripts/sync-recompete-full.ts --naics=236220 --apply
 *   npx tsx --env-file=.env.local scripts/sync-recompete-full.ts --all --apply
 *
 * Flags:
 *   --naics=a,b,c   explicit NAICS list
 *   --top=N         the N NAICS with the most existing rows
 *   --all           every NAICS present in the table
 *   --months=18     expiry window (default 18)
 *   --minValue=n    contract value floor (default 100000)
 *   --include-idvs  also sync IDVs (see AWARD_GROUPS notes -- off by default)
 *   --apply         actually write
 *   --state=path    resume file (default .recompete-sweep-state.json)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fetchExpiringForNaics, type SyncedContract } from '../src/lib/recompete/usaspending-sync';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const has = (name: string) => args.includes(`--${name}`);

const APPLY = has('apply');
const INCLUDE_IDVS = has('include-idvs');
const MONTHS = Number.parseInt(flag('months') || '18', 10);
const MIN_VALUE = Number.parseFloat(flag('minValue') || '100000');
const STATE_PATH = flag('state') || '.recompete-sweep-state.json';

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
// Vercel-pulled envs can carry a literal trailing \n which silently 401s.
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/\\n$/, '').trim();
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(url, key);

interface State { done: string[]; inserted: number; truncated: string[]; failed?: Record<string, string> }

function loadState(): State {
  if (!existsSync(STATE_PATH)) return { done: [], inserted: 0, truncated: [], failed: {} };
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return { failed: {}, ...parsed };
  } catch { return { done: [], inserted: 0, truncated: [], failed: {} }; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Supabase writes go over fetch too, so they get the same transient treatment
 * as the USASpending reads. Still throws once the budget is spent.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [1_000, 5_000, 15_000];
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (error) {
      if (attempt >= delays.length) throw error;
      console.log(`      ${label} failed (${(error as Error).message}) — retry ${attempt + 1}/${delays.length}`);
      await sleep(delays[attempt]);
    }
  }
}
function saveState(s: State) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

/**
 * Every NAICS currently represented in the table, most rows first.
 *
 * This scan previously stopped at a hardcoded 40,000-row cap. Once the sync
 * pushed the table past that, it silently reported 395 NAICS where the true
 * count was 477 -- an incomplete sweep that looked complete. The cap now
 * throws instead of truncating.
 *
 * The explicit ORDER BY is defensive, not a fix for the above: .range()
 * without ORDER BY is undefined in Postgres and this sweep INSERTS into the
 * table it is scanning, so pages could overlap or skip. (Measured at 52,748
 * rows, ordered and unordered scans happened to agree on all 477.)
 */
async function existingNaics(): Promise<string[]> {
  const HARD_CAP = 2_000_000; // a bound that throws, not one that truncates
  const rows: { naics_code: string | null }[] = [];

  for (let from = 0; ; from += 1000) {
    if (from >= HARD_CAP) throw new Error(`naics scan exceeded ${HARD_CAP} rows — refusing to truncate silently`);
    const { data, error } = await sb
      .from('recompete_opportunities')
      .select('naics_code')
      .order('naics_code', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true }) // tie-break so the order is total
      .range(from, from + 999);
    if (error) throw new Error(`naics scan failed at offset ${from}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const tally = new Map<string, number>();
  for (const r of rows) if (r.naics_code) tally.set(r.naics_code, (tally.get(r.naics_code) || 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

async function upsertBatch(rows: SyncedContract[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb
      .from('recompete_opportunities')
      .upsert(chunk, { onConflict: 'contract_id', ignoreDuplicates: false });
    // Never continue past a write failure -- a swallowed error here is exactly
    // how the table ended up trusted-but-wrong in the first place.
    if (error) throw new Error(`upsert failed (${chunk.length} rows, first=${chunk[0]?.contract_id}): ${error.message}`);
  }
}

async function main() {
  let targets: string[];
  if (flag('naics')) targets = flag('naics')!.split(',').map((s) => s.trim()).filter(Boolean);
  else if (has('all')) targets = await existingNaics();
  else if (flag('top')) targets = (await existingNaics()).slice(0, Number.parseInt(flag('top')!, 10));
  else { console.error('Specify --naics=..., --top=N, or --all'); process.exit(1); }

  const state = loadState();
  const todo = targets.filter((n) => !state.done.includes(n));

  console.log(`mode          : ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`window        : ${MONTHS} months | minValue $${MIN_VALUE.toLocaleString()} | IDVs ${INCLUDE_IDVS ? 'included' : 'excluded'}`);
  console.log(`NAICS targets : ${targets.length} (${todo.length} remaining, ${state.done.length} already done)`);
  console.log('');

  let totalRows = 0; let totalUei = 0;
  const truncated: string[] = [...state.truncated];

  for (const [idx, naics] of todo.entries()) {
    const t0 = Date.now();
    let pages = 0;

    // A single NAICS failing must not kill a multi-hour sweep -- but it must
    // never pass silently either. Record it, keep going, and report every
    // failure at the end with a non-zero exit.
    try {
      const { contracts, truncatedGroups } = await withRetry(`NAICS ${naics} fetch`, () =>
        fetchExpiringForNaics({
          naics, monthsAhead: MONTHS, minValue: MIN_VALUE, includeIdvs: INCLUDE_IDVS,
          onPage: () => { pages++; },
        })
      );

      const uei = contracts.filter((c) => c.incumbent_uei).length;
      totalRows += contracts.length;
      totalUei += uei;

      if (truncatedGroups.length) truncated.push(`${naics}:${truncatedGroups.join('+')}`);

      if (APPLY && contracts.length) await withRetry(`NAICS ${naics} upsert`, () => upsertBatch(contracts));

      state.done.push(naics);
      state.inserted += APPLY ? contracts.length : 0;
      state.truncated = truncated;
      delete state.failed![naics];
      saveState(state);

      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[${String(idx + 1).padStart(3)}/${todo.length}] NAICS ${naics.padEnd(7)} ` +
        `${String(contracts.length).padStart(5)} rows | UEI ${uei}/${contracts.length} | ${pages} pages | ${secs}s` +
        (truncatedGroups.length ? `  *** TRUNCATED: ${truncatedGroups.join(',')} (incomplete)` : '')
      );
    } catch (error) {
      state.failed![naics] = (error as Error).message;
      saveState(state);
      console.log(
        `[${String(idx + 1).padStart(3)}/${todo.length}] NAICS ${naics.padEnd(7)} ` +
        `*** FAILED: ${(error as Error).message.slice(0, 90)}`
      );
    }
  }

  console.log('\n=== sweep summary ===');
  console.log(`rows fetched   : ${totalRows}`);
  console.log(`with UEI       : ${totalUei}/${totalRows} (${totalRows ? (totalUei / totalRows * 100).toFixed(1) : 0}%)`);
  console.log(`written        : ${APPLY ? state.inserted : 0}${APPLY ? '' : '  (dry run)'}`);
  if (truncated.length) {
    console.log(`\n*** ${truncated.length} NAICS hit the page cap and are INCOMPLETE:`);
    for (const t of truncated.slice(0, 20)) console.log(`      ${t}`);
    console.log('    Re-run with a larger --maxPages, or narrow the window.');
  } else {
    console.log('truncation     : none — every NAICS walked back to today');
  }

  const failed = Object.entries(state.failed || {});
  if (failed.length) {
    console.log(`\n*** ${failed.length} NAICS FAILED and were skipped — coverage is INCOMPLETE:`);
    for (const [naics, msg] of failed.slice(0, 20)) console.log(`      ${naics}: ${msg.slice(0, 100)}`);
    console.log('    Re-run the same command; completed NAICS are skipped and only these retry.');
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => { console.error('SWEEP FAILED:', e.message); process.exit(1); });
