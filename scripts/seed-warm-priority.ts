/**
 * Seed the contractor warm PRIORITY queue from the existing warm-miss set (2026-11-13).
 *
 *   npx tsx scripts/seed-warm-priority.ts --gsc gsc.json          # dry run (default): prints the plan
 *   npx tsx scripts/seed-warm-priority.ts --gsc gsc.json --go     # writes scores
 *
 * --gsc: JSON { "<slug>": { "impressions": n, "clicks": n } } from Search Console (16 months).
 *
 * Production effects with --go: ZADD (GT) into seo:warm:priority:contractor-slugs only.
 * Reads the warm-miss set (SMEMBERS) and profile keys (MGET); NEVER removes or edits the set.
 * GT = a score is only ever raised, so re-running cannot erase live request counts.
 * Skips: thin contractors (render noindex) and slugs with no cached profile (alias-only; the
 * warm cannot resolve them until the alias path is authorized). No BigQuery.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'node:fs';
import { kv } from '@vercel/kv';
import { DATA_VERSION } from '../src/lib/bigquery/cache';
import { WARM_QUEUE_KEY } from '../src/lib/seo/served-slugs';
import { WARM_PRIORITY_KEY, warmScore } from '../src/lib/seo/warm-priority';

async function main() {
  const go = process.argv.includes('--go');
  const gi = process.argv.indexOf('--gsc');
  const gsc: Record<string, { impressions: number; clicks: number }> = gi > -1 ? JSON.parse(readFileSync(process.argv[gi + 1], 'utf8')) : {};
  const slugs = ((await kv.smembers<string[]>(WARM_QUEUE_KEY)) ?? []).filter(Boolean);
  const plan: Array<{ score: number; member: string }> = [];
  let thin = 0, unresolved = 0;
  for (let i = 0; i < slugs.length; i += 200) {
    const part = slugs.slice(i, i + 200);
    const vals = await kv.mget<unknown[]>(...part.map((s) => `bq:${DATA_VERSION}:rollup:by-slug:${s}:v2-merged`));
    part.forEach((slug, j) => {
      const row = Array.isArray(vals[j]) ? (vals[j] as Array<{ total_obligated?: number; award_count?: number }>)[0] : null;
      if (!row) { unresolved++; return; }
      const g = gsc[slug];
      const score = warmScore({ gscImpressions: g?.impressions, gscClicks: g?.clicks, totalObligated: Number(row.total_obligated ?? 0), awardCount: Number(row.award_count ?? 0) });
      if (score === null) { thin++; return; }
      plan.push({ score, member: slug });
    });
  }
  plan.sort((a, b) => b.score - a.score);
  const withGsc = plan.filter((p) => p.score >= 10_000).length;
  console.log(`\n${go ? 'SEEDING' : 'DRY RUN —'} priority queue from ${slugs.length} queued slugs`);
  console.log(`  to queue: ${plan.length} (with search history: ${withGsc})`);
  console.log(`  skipped: ${thin} thin (noindex), ${unresolved} unresolved (no cached profile)`);
  console.log(`  top: ${plan.slice(0, 5).map((p) => `${p.member}=${p.score}`).join(', ')}`);
  console.log(`  at 100/run hourly, capped 2,000/day: ~${Math.ceil(plan.length / 2000)} day(s) to drain`);
  if (!go) { console.log('\nDRY RUN — nothing written. Re-run with --go.\n'); return; }
  for (let i = 0; i < plan.length; i += 500) {
    const chunk = plan.slice(i, i + 500);
    await kv.zadd(WARM_PRIORITY_KEY, { gt: true }, chunk[0], ...chunk.slice(1));
  }
  console.log(`\n✓ ${plan.length} scored into ${WARM_PRIORITY_KEY}; queue depth now ${await kv.zcard(WARM_PRIORITY_KEY)}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
