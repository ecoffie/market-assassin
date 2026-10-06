/**
 * Record downstream side-effect suppressions for HIGH-CONFIDENCE scanner-created pursuits (T1).
 *
 *   npx tsx scripts/record-scanner-save-suppressions.ts          # DRY RUN (default): counts + sample
 *   npx tsx scripts/record-scanner-save-suppressions.ts --go     # write the suppression records
 *
 * Writes ONLY to pipeline_side_effect_suppressions. Never touches user_pipeline: the pursuits stay
 * visible and unchanged; only change-alert emails/SMS and automatic document fetches skip them.
 *
 * Candidates come from scanner_save_candidates_v1(cutoff) — T1 only (< 120 s after an alert that
 * contained the notice AND a ±1 s burst, before the #1845 deploy, no user confirmation). T2–T5 are
 * deliberately excluded: uncertain cases fail open. Idempotent: existing records are kept as they
 * are (ON CONFLICT DO NOTHING), so a re-run inserts nothing new.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const GO = process.argv.includes('--go');
const cutoffArg = process.argv.find((a) => a.startsWith('--cutoff='));
/** #1845 (email save requires confirmation) reached production at this instant. */
const CUTOFF = cutoffArg ? cutoffArg.split('=')[1] : '2026-10-06T11:36:36Z';
const CRITERIA = 'scanner_t1_v1';
const REASON =
  'Created by a mail link scanner: a daily_alert one-click save (GET, pre-#1845) < 120 s after an alert containing this notice, ' +
  'in a ±1 s burst with another save for the same user. Downstream change notifications and automatic document fetches are suppressed; the pursuit is unchanged.';
const PAGE = 1000;

interface Candidate {
  pipeline_id: string; user_email: string; notice_id: string; created_at: string;
  alert_sent_at: string; seconds_after_send: number; burst_peers: number;
}

const redact = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Page through the candidates and PROVE exhaustion (PostgREST caps every response at 1,000).
  const candidates: Candidate[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.rpc('scanner_save_candidates_v1', { p_cutoff: CUTOFF })
      .order('pipeline_id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`candidate read failed: ${error.message}`);
    candidates.push(...((data || []) as Candidate[]));
    if (!data || data.length < PAGE) break;
  }

  const { count: existing, error: exErr } = await sb.from('pipeline_side_effect_suppressions')
    .select('pipeline_id', { count: 'exact', head: true }).eq('criteria_version', CRITERIA);
  if (exErr || existing == null) throw new Error(`existing count failed: ${exErr?.message ?? 'null count'}`);

  const users = new Set(candidates.map((c) => c.user_email));
  console.log(`criteria: ${CRITERIA}   cutoff: ${CUTOFF}   mode: ${GO ? 'GO (writing)' : 'DRY RUN'}`);
  console.log(`T1 candidates: ${candidates.length} pursuits across ${users.size} users`);
  console.log(`already recorded under ${CRITERIA}: ${existing}`);
  if (candidates[0]) {
    const s = candidates[0];
    console.log('sample:', { ...s, user_email: redact(s.user_email) });
  }
  if (!GO) { console.log('\nDRY RUN — nothing written. Re-run with --go to record suppressions.'); return; }

  for (let i = 0; i < candidates.length; i += 500) {
    const rows = candidates.slice(i, i + 500).map((c) => ({
      pipeline_id: c.pipeline_id,
      user_email: c.user_email,
      reason: REASON,
      criteria_version: CRITERIA,
      evidence: {
        notice_id: c.notice_id, pipeline_created_at: c.created_at, alert_sent_at: c.alert_sent_at,
        seconds_after_send: c.seconds_after_send, burst_peers: c.burst_peers, cutoff: CUTOFF,
      },
      created_by: 'scripts/record-scanner-save-suppressions.ts',
    }));
    const { error } = await sb.from('pipeline_side_effect_suppressions').upsert(rows, { onConflict: 'pipeline_id', ignoreDuplicates: true });
    if (error) throw new Error(`write failed at batch ${i / 500}: ${error.message}`);
  }
  const { count: after, error: afErr } = await sb.from('pipeline_side_effect_suppressions')
    .select('pipeline_id', { count: 'exact', head: true }).eq('criteria_version', CRITERIA);
  if (afErr || after == null) throw new Error(`verification count failed: ${afErr?.message ?? 'null count'}`);
  console.log(`recorded under ${CRITERIA}: ${after} (expected ${Math.max(existing, candidates.length)})`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
