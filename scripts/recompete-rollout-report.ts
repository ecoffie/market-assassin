/**
 * Recompete compute-once rollout — read recompete_compute_once_log and summarize (Gate 2, 2026-09-24).
 * Read-only. Outcome counts, every mismatch/error row in full, old/new latency percentiles.
 *
 *   npx tsx scripts/recompete-rollout-report.ts --since <iso> [--mode shadow|canary|authority] [--json]
 */
import { config } from 'dotenv';
import { Client } from 'pg';
config({ path: '.env.local', quiet: true });

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function main() {
  const since = arg('--since');
  if (!since) throw new Error('--since <iso> required');
  const mode = arg('--mode');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `SELECT at, deployment, mode, served, forced, compared, outcome, mismatch_fields, params, bbox,
            old_ms, new_ms, market_total, in_view, pins, follow_ons, error
       FROM recompete_compute_once_log WHERE at >= $1 AND ($2::text IS NULL OR mode = $2) ORDER BY at`,
    [since, mode],
  );
  await c.end();
  const by = (k: string) => rows.reduce<Record<string, number>>((a, r) => { const v = String(r[k]); a[v] = (a[v] || 0) + 1; return a; }, {});
  const cmp = rows.filter((r) => r.compared);
  const oldMs = cmp.map((r) => r.old_ms).filter((x): x is number => x != null);
  const newMs = rows.map((r) => r.new_ms).filter((x): x is number => x != null);
  const out = {
    since, mode, rows: rows.length,
    deployments: by('deployment'), served: by('served'), forced: by('forced'), outcomes: by('outcome'),
    latency_ms: {
      old: { n: oldMs.length, p50: pct(oldMs, 50), p95: pct(oldMs, 95), max: pct(oldMs, 100) },
      new: { n: newMs.length, p50: pct(newMs, 50), p95: pct(newMs, 95), max: pct(newMs, 100) },
    },
    market_total_range: [Math.min(...rows.map((r) => r.market_total ?? Infinity)), Math.max(...rows.map((r) => r.market_total ?? -1))],
    non_identical: rows.filter((r) => r.compared && r.outcome !== 'identical')
      .map((r) => ({ at: r.at, outcome: r.outcome, fields: r.mismatch_fields, params: r.params, bbox: r.bbox, error: r.error })),
    errors: rows.filter((r) => r.error).map((r) => ({ at: r.at, served: r.served, error: r.error })),
  };
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
