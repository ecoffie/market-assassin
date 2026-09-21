/**
 * Phase 2 — write capability_label + capability_summary onto contractor_capability_profiles.
 * docs/PRD-contractor-capability-profiles.md
 *
 * Reads the FACT columns Phase 1 wrote (top_pscs / top_agencies / specialty_* / award_count /
 * total_obligated / set_asides_won) and composes the two human-readable fields with the
 * deterministic transforms in src/lib/capability/psc-label.ts.
 *
 * NO LLM, NO NETWORK: this is pure string composition over data already in Supabase, so it is
 * cheap, idempotent and re-runnable. Rule #1 — the facts come from the columns; nothing here
 * introduces a claim the row doesn't support (unit tests assert every output token appears in
 * the source PSC string).
 *
 * Usage:
 *   npx tsx scripts/label-capability-profiles.ts --dry           # sample 25, no write
 *   npx tsx scripts/label-capability-profiles.ts --limit=1000    # partial write
 *   npx tsx scripts/label-capability-profiles.ts                 # label everything
 */
// Must load env BEFORE the supabase client reads process.env at module scope.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { cleanPscLabel, composeCapabilitySummary, type SpecialtyTier } from '../src/lib/capability/psc-label';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

interface Row {
  rollup_uei: string;
  rollup_name: string;
  top_pscs: Array<{ code?: string; description?: string }> | null;
  top_agencies: Array<{ agency?: string; share?: number }> | null;
  specialty_tier: SpecialtyTier | null;
  specialty_score: number | null;
  award_count: number;
  total_obligated: number;
  set_asides_won: string[] | null;
  last_award_date: string | null;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const limitArg = arg('limit');
  const hardLimit = limitArg ? parseInt(limitArg, 10) : undefined;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('❌ Supabase env missing'); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const PAGE = 1000;
  let from = 0, scanned = 0, labeled = 0, nullLabel = 0, written = 0;
  const samples: string[] = [];
  const t0 = Date.now();

  console.log(`Labeling capability profiles${dry ? ' (DRY — no write)' : ''}${hardLimit ? ` limit=${hardLimit}` : ''}…`);

  for (;;) {
    const take = hardLimit ? Math.min(PAGE, hardLimit - scanned) : PAGE;
    if (take <= 0) break;
    // Deterministic pagination: order by the PK so pages never overlap or skip as we write.
    const { data, error } = await sb
      .from('contractor_capability_profiles')
      .select('rollup_uei, rollup_name, top_pscs, top_agencies, specialty_tier, specialty_score, award_count, total_obligated, set_asides_won, last_award_date')
      .order('rollup_uei', { ascending: true })
      .range(from, from + take - 1);
    if (error) { console.error(`❌ read failed at offset ${from}: ${error.message}`); process.exit(1); }
    const rows = (data || []) as Row[];
    if (!rows.length) break;

    const updates: Array<{ rollup_uei: string; capability_label: string | null; capability_summary: string | null }> = [];
    for (const r of rows) {
      scanned++;
      const label = cleanPscLabel(r.top_pscs?.[0]?.description ?? null);
      const summary = composeCapabilitySummary({
        capability_label: label,
        specialty_tier: r.specialty_tier,
        specialty_score: r.specialty_score,
        award_count: r.award_count,
        total_obligated: r.total_obligated,
        top_agencies: r.top_agencies,
        top_pscs: r.top_pscs,
        last_award_date: r.last_award_date,
        set_asides_won: r.set_asides_won,
      });
      if (label) labeled++; else nullLabel++;
      if (samples.length < 25 && label) samples.push(`  ${r.rollup_name.slice(0, 34).padEnd(34)} │ ${summary}`);
      updates.push({ rollup_uei: r.rollup_uei, capability_label: label, capability_summary: summary });
    }

    if (!dry) {
      // MUST be UPDATE, not upsert. PostgREST treats an upsert payload as a full INSERT row, so
      // omitting rollup_name/top_pscs/etc. sends them as NULL — which tripped the NOT NULL
      // constraint on rollup_name and, without it, would have WIPED every fact column Phase 1
      // wrote. Per-row UPDATE touches only the two label columns. (Caught by the constraint on
      // the first full run — the DB guard did its job.)
      const CONC = 25; // small pool: 71K single-row updates, but PostgREST handles this fine
      for (let i = 0; i < updates.length; i += CONC) {
        const slice = updates.slice(i, i + CONC);
        const results = await Promise.all(slice.map((u) =>
          sb.from('contractor_capability_profiles')
            .update({ capability_label: u.capability_label, capability_summary: u.capability_summary })
            .eq('rollup_uei', u.rollup_uei)
        ));
        const failed = results.find((r) => r.error);
        if (failed?.error) { console.error(`❌ update failed: ${failed.error.message}`); process.exit(1); }
        written += slice.length;
      }
    }

    from += rows.length;
    if (rows.length < take) break;
    if (scanned % 10000 === 0) console.log(`  …${scanned} scanned, ${written} written`);
  }

  console.log(`\nsample summaries:\n${samples.join('\n')}`);
  console.log(`\nscanned ${scanned} · labeled ${labeled} (${((100 * labeled) / Math.max(scanned, 1)).toFixed(1)}%) · no label ${nullLabel}`);
  if (dry) { console.log('(dry run — nothing written)'); process.exit(0); }
  console.log(`✅ wrote ${written} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message || e); process.exit(1); });
