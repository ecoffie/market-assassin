/**
 * Backfill recompete_opportunities.psc_code from USASpending (the recoverable half of the PSC gap).
 *
 * WHY: recompete's psc_code is ~2% populated (2,893/147,113) because most rows were synced before
 * the sync captured PSC — but USASpending HAS the PSC on every award. So the 144,220 rows with a
 * contract_id but no psc_code are backfillable. The search brain crosswalks PSC→NAICS in the
 * meantime; this gives recompete a TRUE PSC filter. (Eric 2026-08-01.)
 *
 * HOW: for each row missing psc_code, GET /api/v2/awards/{contract_id}/ and read
 * product_or_service_code (verified: CONT_AWD_SPE2D126F0073_… → PSC 6525). Stamp psc_checked_at so
 * a restart skips checked rows (even ones USASpending returns null for — no PSC on record).
 *
 * Bulk-job rules: LOCAL tsx runner with a concurrency pool (NOT an HTTP cron loop). Resumable
 * (psc_checked_at). DRY-RUN first, ASK before the real write.
 *   npx tsx --env-file=.env.local scripts/backfill-recompete-psc.ts --dry            # counts + a sample, no writes
 *   npx tsx --env-file=.env.local scripts/backfill-recompete-psc.ts --limit=500      # small live slice to prove it
 *   npx tsx --env-file=.env.local scripts/backfill-recompete-psc.ts                  # full drain (resumable)
 */
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LIMIT = (() => { const a = args.find((x) => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const CONCURRENCY = 8;          // USASpending is public but rate-limits — keep it gentle
const PAGE = 1000;              // rows fetched per DB page
const AWARD_URL = 'https://api.usaspending.gov/api/v2/awards/';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch the PSC for one award id from USASpending. Returns the code, '' (checked, none), or throws. */
async function fetchPsc(contractId: string): Promise<string | ''> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(AWARD_URL + encodeURIComponent(contractId) + '/', { headers: { Accept: 'application/json' } });
      if (r.status === 404) return '';                 // award not found → checked, no PSC
      if (r.status === 429 || r.status >= 500) throw new Error('retryable ' + r.status);
      if (!r.ok) return '';                             // other 4xx → give up on this row (checked)
      const d = await r.json() as { product_or_service_code?: string; psc_hierarchy?: { base_code?: { code?: string } } };
      return (d.product_or_service_code || d.psc_hierarchy?.base_code?.code || '') as string;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(Math.min(30000, 800 * 2 ** attempt));
    }
  }
}

async function main() {
  console.log(`Recompete PSC backfill — ${DRY ? 'DRY RUN (no writes)' : 'LIVE'}${LIMIT !== Infinity ? ` — limit ${LIMIT}` : ''}`);

  // Size the job (grounded).
  const { count: total } = await sb.from('recompete_opportunities').select('*', { count: 'exact', head: true }).is('psc_code', null).is('psc_checked_at', null).not('contract_id', 'is', null);
  console.log(`Backfill target: ${total?.toLocaleString()} rows (psc_code NULL, not yet checked, has contract_id).`);
  if (DRY) {
    const { data, error } = await sb.from('recompete_opportunities').select('contract_id,piid,naics_code').is('psc_code', null).is('psc_checked_at', null).not('contract_id', 'is', null).limit(3);
    if (error) throw new Error('dry-run sample failed: ' + error.message);
    for (const row of data || []) {
      const psc = await fetchPsc(row.contract_id as string);
      console.log(`  ${row.piid} (naics ${row.naics_code}) → PSC ${psc || '(none on record)'}`);
    }
    console.log('DRY RUN complete — nothing written.');
    return;
  }

  let processed = 0, filled = 0, none = 0, done = false;
  const nowIso = () => new Date().toISOString();
  while (!done && processed < LIMIT) {
    const { data, error } = await sb
      .from('recompete_opportunities')
      .select('contract_id')
      .is('psc_code', null).is('psc_checked_at', null).not('contract_id', 'is', null)
      .limit(Math.min(PAGE, LIMIT - processed));
    if (error) throw new Error('page fetch failed: ' + error.message);
    if (!data || data.length === 0) { done = true; break; }

    // Concurrency pool over this page.
    for (let i = 0; i < data.length; i += CONCURRENCY) {
      const slice = data.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (row) => {
        const cid = row.contract_id as string;
        let psc: string | '' = '';
        try { psc = await fetchPsc(cid); } catch { psc = ''; }   // give up gracefully; stamp checked so we don't loop
        const patch: Record<string, unknown> = { psc_checked_at: nowIso() };
        if (psc) { patch.psc_code = psc; filled++; } else { none++; }
        const { error: upErr } = await sb.from('recompete_opportunities').update(patch).eq('contract_id', cid);
        if (upErr) console.error(`  update ${cid} failed: ${upErr.message}`);
        processed++;
      }));
      if (processed % 500 === 0) console.log(`  ${processed.toLocaleString()} processed · ${filled.toLocaleString()} filled · ${none.toLocaleString()} no-PSC`);
      await sleep(120);   // pace USASpending between pool batches
    }
  }
  console.log(`\nDONE. processed=${processed.toLocaleString()} · psc filled=${filled.toLocaleString()} · no-PSC-on-record=${none.toLocaleString()}`);
}

main().catch((e) => { console.error('BACKFILL FAILED:', e); process.exit(1); });
