#!/usr/bin/env npx tsx
/**
 * Full & Open DNA reconciliation (repair board P1-A, approved 2026-09-27 — run ONLY after #1727
 * is production-live).
 *
 * Removes the persisted "Full & Open" DNA strand from still-open notices whose OWN record carries
 * no affirmative Full & Open evidence. Surgical by design — see src/lib/opportunities/
 * full-open-reconcile.ts: only the `full_open` strand/key changes; every other strand, its order,
 * `dna_computed_at` and every other column stay byte-identical.
 *
 *   npx tsx scripts/reconcile-full-open-dna.ts                  # DRY: read, classify, snapshot, count
 *   npx tsx scripts/reconcile-full-open-dna.ts --go             # snapshot → guarded write → re-read → reconcile
 *   npx tsx scripts/reconcile-full-open-dna.ts --verify <snap>  # re-run the reconciliation vs a snapshot
 *
 * Every run writes a snapshot (notice_id, set_aside_code, set_aside_description, opportunity_dna,
 * opportunity_dna_keys, dna_computed_at, classification) BEFORE any write, to --out (default
 * tmp/full-open-reconcile/). Writes are guarded on the snapshot's dna_computed_at, so a row the
 * sync recomputed in the meantime is never overwritten (reported as `superseded`, not failed).
 *
 * Exit 1 if failed > 0 or any row differs from its snapshot beyond the full_open strand.
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  planFullOpenReconciliation, verifyReconciled, FULL_OPEN_KEY,
  type FullOpenCandidate, type FullOpenPlan,
} from '../src/lib/opportunities/full-open-reconcile';

const GO = process.argv.includes('--go');
const argVal = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const VERIFY = argVal('--verify');
const OUT = argVal('--out') || 'tmp/full-open-reconcile';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Row = FullOpenCandidate & { dna_computed_at: string | null };
interface Snapshot { taken_at: string; host: string | undefined; rows: Array<Row & { plan: FullOpenPlan }> }

const COLS = 'notice_id, set_aside_code, set_aside_description, opportunity_dna, opportunity_dna_keys, dna_computed_at';

/** Every still-open active notice carrying the strand — paged (PostgREST caps a response at 1,000). */
async function readCandidates(nowIso: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('sam_opportunities').select(COLS)
      .eq('active', true).gt('response_deadline', nowIso)
      .contains('opportunity_dna_keys', [FULL_OPEN_KEY])
      .order('notice_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data || []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function readByIds(ids: string[]): Promise<Map<string, Row>> {
  const m = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('sam_opportunities').select(COLS).in('notice_id', ids.slice(i, i + 200)).range(0, 999);
    if (error) throw error;
    for (const r of (data || []) as Row[]) m.set(r.notice_id, r);
  }
  return m;
}

function tally(rows: Array<{ plan: FullOpenPlan }>) {
  const t: Record<string, number> = {};
  for (const r of rows) t[`${r.plan.cls}→${r.plan.action}`] = (t[`${r.plan.cls}→${r.plan.action}`] || 0) + 1;
  return t;
}

async function reconcile(snap: Snapshot, written: Map<string, 'updated' | 'superseded' | 'failed'>) {
  const after = await readByIds(snap.rows.map((r) => r.notice_id));
  let updated = 0, unchanged = 0, failed = 0, superseded = 0;
  const problems: string[] = [];
  const cls: Record<string, number> = {};
  for (const r of snap.rows) {
    const a = after.get(r.notice_id);
    const w = written.get(r.notice_id);
    if (w === 'failed') { failed++; problems.push(`${r.notice_id}: write failed`); continue; }
    if (!a) { failed++; problems.push(`${r.notice_id}: row vanished`); continue; }
    if ((a.dna_computed_at ?? null) !== (r.dna_computed_at ?? null)) { superseded++; continue; } // sync recomputed it — not ours
    // Without a write this run (DRY / --verify before --go), a 'remove' row is still expected unchanged.
    const effective: FullOpenPlan = r.plan.action === 'remove' && (w === 'updated' || (VERIFY && !a.opportunity_dna_keys?.includes(FULL_OPEN_KEY)))
      ? r.plan : { ...r.plan, action: 'keep' };
    const v = verifyReconciled(r, a, effective);
    if (!v.ok) { failed++; problems.push(`${r.notice_id}: ${v.reason}`); continue; }
    if (effective.action === 'remove') updated++; else unchanged++;
    const k = a.opportunity_dna_keys?.includes(FULL_OPEN_KEY) ? `${r.plan.cls} (strand kept)` : `${r.plan.cls} (strand removed)`;
    cls[k] = (cls[k] || 0) + 1;
  }
  console.log('\n| candidate | updated | unchanged | failed | superseded by sync |');
  console.log('|---|---|---|---|---|');
  console.log(`| ${snap.rows.length} | ${updated} | ${unchanged} | ${failed} | ${superseded} |`);
  console.log('\nResulting classifications:');
  for (const [k, n] of Object.entries(cls).sort()) console.log(`  ${k}: ${n}`);
  if (problems.length) { console.log('\nProblems:'); problems.slice(0, 50).forEach((p) => console.log('  ' + p)); }
  return failed;
}

async function main() {
  if (VERIFY) {
    const snap = JSON.parse(readFileSync(VERIFY, 'utf8')) as Snapshot;
    const failed = await reconcile(snap, new Map());
    process.exit(failed > 0 ? 1 : 0);
  }

  const nowIso = new Date().toISOString();
  const rows = await readCandidates(nowIso);
  const snap: Snapshot = {
    taken_at: nowIso,
    host: process.env.NEXT_PUBLIC_SUPABASE_URL,
    rows: rows.map((r) => ({ ...r, plan: planFullOpenReconciliation(r) })),
  };
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `snapshot-${nowIso.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(snap));
  const toRemove = snap.rows.filter((r) => r.plan.action === 'remove');
  console.log(`Snapshot: ${file}`);
  console.log(`Candidates (active, still open, persisted full_open strand): ${snap.rows.length}`);
  console.log('Plan (classification→action):', tally(snap.rows));
  console.log(`Exact write candidate count (strand to remove): ${toRemove.length}`);
  if (!GO) { console.log('\nDRY RUN — nothing written. Re-run with --go only under the approved window.'); return; }

  const written = new Map<string, 'updated' | 'superseded' | 'failed'>();
  let i = 0;
  const worker = async () => {
    while (i < toRemove.length) {
      const r = toRemove[i++];
      let q = db.from('sam_opportunities')
        .update({ opportunity_dna: r.plan.next!.opportunity_dna, opportunity_dna_keys: r.plan.next!.opportunity_dna_keys }, { count: 'exact' })
        .eq('notice_id', r.notice_id)
        .contains('opportunity_dna_keys', [FULL_OPEN_KEY]);
      // Guard on the snapshot: a row the sync recomputed since the snapshot is left alone.
      q = r.dna_computed_at ? q.eq('dna_computed_at', r.dna_computed_at) : q.is('dna_computed_at', null);
      const { error, count } = await q;
      if (error) { written.set(r.notice_id, 'failed'); console.error(`  ✗ ${r.notice_id}: ${error.message}`); }
      else if (count === 1) written.set(r.notice_id, 'updated');
      else if (count === 0) written.set(r.notice_id, 'superseded');
      else { written.set(r.notice_id, 'failed'); console.error(`  ✗ ${r.notice_id}: count=${count} (unknown ≠ 0)`); }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const failed = await reconcile(snap, written);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
