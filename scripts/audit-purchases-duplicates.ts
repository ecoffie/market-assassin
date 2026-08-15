/**
 * Report (and optionally MARK) purchase rows that duplicate another.
 *
 * WHY THIS EXISTS
 * Two Stripe webhooks in two repos write the same `purchases` table with
 * different conventions, and each dedups on its OWN column, so neither sees
 * the other's row:
 *   market-assassin /api/stripe-webhook -> stripe_session_id, amount in DOLLARS
 *   govcon-shop     /api/stripe-webhook -> order_id,          amount in CENTS
 *
 * Measured 2026-08-15: 283 rows / 161 distinct sessions; 121 sessions recorded
 * twice. SUM(amount_paid) overstates revenue by $20,858 (~22%) and the unit is
 * wrong for about half the rows.
 *
 * NOTHING IS EVER DELETED. `--mark` sets `superseded_by` on the redundant row,
 * pointing at the survivor. The row stays as provenance for what that writer
 * did, and `purchases_canonical` filters it out for readers. Reversible with
 * `UPDATE purchases SET superseded_by = NULL`.
 *
 * WHICH ROW SURVIVES: the one carrying the richer record — a tier, metadata, or
 * a license key — and on a tie, the earliest created_at. Never chosen by amount,
 * because the two writers disagree about units and the larger number is just
 * cents.
 *
 *   npx tsx scripts/audit-purchases-duplicates.ts           # report only
 *   npx tsx scripts/audit-purchases-duplicates.ts --mark    # write superseded_by
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

for (const file of ['.env.local', '.env']) {
  const f = path.join(process.cwd(), file);
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim();
    if (v) process.env[line.slice(0, i).trim()] = v;
  }
}

const MARK = process.argv.includes('--mark');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

interface Row {
  id: string; user_email: string; amount_paid: number | null; product_name: string | null;
  stripe_session_id: string | null; order_id: string | null; tier: string | null;
  metadata: unknown; license_key: string | null; created_at: string; superseded_by: string | null;
}

const sessionOf = (r: Row): string | null => {
  for (const v of [r.stripe_session_id, r.order_id]) if (v && v.startsWith('cs_')) return v;
  return null;
};
/**
 * Higher = keep. Never scored on amount — the two writers disagree about units,
 * so the bigger number is just cents and would pick arbitrarily.
 *
 * A BACKFILLED row always loses to a live one. Backfill rows were reconstructed
 * from Stripe after the fact and are explicitly stamped tier='backfill_unknown'
 * ("the webhook never derived one; we do NOT invent it"), so they carry less
 * truth than the row the live webhook wrote — even though the backfill also
 * attached metadata, which an earlier version of this scoring mistook for
 * richness and used to keep the WRONG row.
 */
const isBackfill = (r: Row): boolean =>
  r.tier === 'backfill_unknown' || (r.metadata as { backfilled?: boolean } | null)?.backfilled === true;

const richness = (r: Row): number =>
  (isBackfill(r) ? 0 : 8) +
  (r.tier && r.tier !== 'backfill_unknown' ? 4 : 0) +
  (!isBackfill(r) && r.metadata && Object.keys(r.metadata as object).length ? 2 : 0) +
  (r.license_key ? 1 : 0);

async function main() {
  // The migration adds superseded_by. Report works without it so this is
  // useful BEFORE the migration runs; only --mark actually needs the column.
  const BASE = 'id,user_email,amount_paid,product_name,stripe_session_id,order_id,tier,metadata,license_key,created_at';
  let hasColumn = true;
  const probe = await sb.from('purchases').select('superseded_by').limit(1);
  if (probe.error?.message.includes('superseded_by')) hasColumn = false;

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('purchases')
      .select(hasColumn ? `${BASE},superseded_by` : BASE)
      .range(from, from + 999);
    if (error) { console.error('read failed:', error.message); process.exit(1); }
    if (!data?.length) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  if (!hasColumn) {
    console.log('\nNOTE: purchases.superseded_by does not exist yet — run');
    console.log('      supabase/migrations/20260815_purchases_canonical_view.sql first.');
    console.log('      Reporting anyway; --mark is unavailable until then.');
  }

  const bySession = new Map<string, Row[]>();
  for (const r of rows) {
    const s = sessionOf(r);
    if (s) (bySession.get(s) ?? bySession.set(s, []).get(s)!).push(r);
  }

  const plans: Array<{ keep: Row; drop: Row[] }> = [];
  for (const [, group] of bySession) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => richness(b) - richness(a) || a.created_at.localeCompare(b.created_at));
    plans.push({ keep: sorted[0], drop: sorted.slice(1) });
  }

  const redundant = plans.reduce((n, p) => n + p.drop.length, 0);
  const alreadyMarked = rows.filter((r) => r.superseded_by).length;
  const cents = (r: Row) => ((r.amount_paid ?? 0) >= 1000 ? (r.amount_paid ?? 0) : (r.amount_paid ?? 0) * 100);
  const inflated = rows.reduce((s, r) => s + cents(r), 0);
  const truth = rows.filter((r) => !plans.some((p) => p.drop.some((d) => d.id === r.id))).reduce((s, r) => s + cents(r), 0);

  console.log(`\n=== purchases duplicate audit — ${MARK ? 'MARKING' : 'REPORT ONLY'} ===`);
  console.log(`rows: ${rows.length} | distinct sessions: ${bySession.size} | duplicated sessions: ${plans.length}`);
  console.log(`redundant rows: ${redundant} (already marked: ${alreadyMarked})`);
  console.log(`revenue counting every row: $${(inflated / 100).toLocaleString()}`);
  console.log(`revenue de-duplicated:      $${(truth / 100).toLocaleString()}`);
  console.log(`OVERSTATEMENT:              $${((inflated - truth) / 100).toLocaleString()}`);
  for (const p of plans.slice(0, 5)) {
    console.log(`\n  ${p.keep.user_email} "${p.keep.product_name}"`);
    console.log(`    KEEP ${p.keep.id.slice(0, 8)} amt=${p.keep.amount_paid} tier=${p.keep.tier ?? '-'}`);
    for (const d of p.drop) console.log(`    mark ${d.id.slice(0, 8)} amt=${d.amount_paid} tier=${d.tier ?? '-'}`);
  }
  if (plans.length > 5) console.log(`  … and ${plans.length - 5} more`);

  if (!MARK) { console.log('\nReport only — nothing written. Re-run with --mark to set superseded_by.\n'); return; }
  if (!hasColumn) { console.error('\nCannot --mark: purchases.superseded_by does not exist. Run the migration first.\n'); process.exit(1); }

  let ok = 0, failed = 0;
  for (const p of plans) {
    for (const d of p.drop) {
      if (d.superseded_by) continue;
      const { error } = await sb.from('purchases').update({ superseded_by: p.keep.id }).eq('id', d.id);
      if (error) { console.error(`  FAIL ${d.id}: ${error.message}`); failed++; } else ok++;
    }
  }
  console.log(`\nmarked: ${ok} | failed: ${failed}`);
  console.log('Reverse with: UPDATE purchases SET superseded_by = NULL;\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
