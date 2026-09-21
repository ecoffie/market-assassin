/**
 * Bounded, scheduled materialization of contractor records into the serving cache.
 *
 * THE ARCHITECTURE THIS IMPLEMENTS
 * --------------------------------
 *   canonical resolver → normalized record → bounded warm → KV → SEO pages + sitemap
 *
 * and never:
 *
 *   Googlebot request → live BigQuery
 *
 * The public contractor page reads KV only. `ENABLE_SEO_LIVE_BQ` stays OFF. This
 * job is the ONLY thing allowed to touch BigQuery on the SEO surface, it runs
 * offline, and it runs under hard limits.
 *
 * ONE SOURCE OF CONTRACTOR TRUTH
 * ------------------------------
 * It calls `getRollupsBySlugBatch()` and `resolveCanonicalSlugsBatch()` in
 * src/lib/bigquery/recipients.ts — the batch forms of the very functions the
 * public page and the MCP contractor tools already use, sharing the identical
 * SQL constants (`ROLLUP_BY_SLUG_SQL`, `CANONICAL_SLUG_SQL`). It does not carry
 * its own SQL.
 *
 * That rule is written in blood. The first version of this script re-implemented
 * the resolution SQL in batched form and silently dropped the `norm_match` arm.
 * The warm reported success and 49 slugs stayed 404 — among them
 * general-dynamics-corporation, the exact case norm_match exists for.
 *
 * WHY THE LIMITS ARE NOT OPTIONAL
 * -------------------------------
 * getmindy.ai and the authenticated product share one GCP project quota. When
 * `QueryUsagePerDay` is exhausted every query in the project fails instantly at
 * 0 bytes billed — including the guards, which then go blind. The authenticated
 * product's capacity outranks SEO coverage, so every limit fails CLOSED: on
 * doubt this stops early and reports partial coverage. A partial warm is
 * recoverable next run; a drained quota is a day-long product outage.
 *
 * ⚠️ A PARTIAL OR FAILED RUN MUST NOT PUBLISH URLS. It doesn't: the sitemap
 * gates on `getServeableSlugs()` (KV presence), so a slug this run never reached
 * is simply not advertised, and appears on a later build once warmed.
 *
 * ⚠️ ISR. Priming the cache does not flip a live URL by itself — contractor
 * routes use `revalidate = 604800`, so an already-rendered 404 stays cached at
 * the edge until a deploy invalidates it. Warm, deploy, THEN verify.
 *
 * USAGE
 *   npx tsx scripts/warm-contractor-slugs.ts --file slugs.txt --dry-run   # estimate only, 0 bytes
 *   npx tsx scripts/warm-contractor-slugs.ts --file slugs.txt --go        # execute
 *   npx tsx scripts/warm-contractor-slugs.ts --queue --go                 # drain recorded misses
 *
 * `--dry-run` is the DEFAULT. Executing requires an explicit `--go`, because a
 * fleet-wide backfill needs separate authorization, not a convenient default.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { kv } from '@vercel/kv';
import { bqDryRun } from '../src/lib/bigquery/client';
import { primeCache } from '../src/lib/bigquery/cache';
import {
  getRollupsBySlugBatch,
  resolveCanonicalSlugsBatch,
  normalizeCompanyName,
  ROLLUP_BY_SLUG_SQL,
  CANONICAL_SLUG_SQL,
  type RollupProfile,
} from '../src/lib/bigquery/recipients';
import { CONTRACTOR_WARM_LIMITS as L, dailyBudgetKey } from '../src/lib/seo/warm-limits';
import { WARM_QUEUE_KEY } from '../src/lib/seo/served-slugs';

const gib = (b: number) => (b / 1024 ** 3).toFixed(3);

/** `/contractors/foo/contracts`, a full URL, or a bare slug → `foo`. */
export function toSlug(line: string): string | null {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) return null;
  let s = raw;
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch {
    return null;
  }
  const m = s.match(/^\/?contractors\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]).toLowerCase();
  if (/^[a-z0-9][a-z0-9-]*$/i.test(s)) return s.toLowerCase();
  return null;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) return;
        await fn(items[idx]);
      }
    }),
  );
}

/** Rolling daily scan total, so the budget survives process restarts. */
async function readDailyBytes(): Promise<number> {
  try {
    return Number((await kv.get<number>(dailyBudgetKey())) ?? 0);
  } catch {
    // Cannot read the budget → assume it is spent. Fail closed.
    console.error('  ! daily budget unreadable — treating as exhausted');
    return Number.MAX_SAFE_INTEGER;
  }
}

async function addDailyBytes(n: number): Promise<void> {
  try {
    const cur = Number((await kv.get<number>(dailyBudgetKey())) ?? 0);
    await kv.set(dailyBudgetKey(), cur + n, { ex: 48 * 3600 });
  } catch {
    /* budget accounting is best-effort; the per-run ceilings still hold */
  }
}

interface Budget {
  runBytes: number;
  dayBytes: number;
  startedAt: number;
}

/** Every limit check in one place. Returns a reason to stop, or null. */
function stopReason(b: Budget, nextScanBytes: number): string | null {
  if (Date.now() - b.startedAt > L.maxRuntimeMs) return 'runtime ceiling reached';
  if (b.runBytes + nextScanBytes > L.maxBytesPerRun) return 'per-run byte ceiling would be exceeded';
  if (b.dayBytes + nextScanBytes > L.dailyScanBudgetBytes) return 'daily scan budget would be exceeded';
  if (nextScanBytes > L.maxBytesPerScan) return 'single scan exceeds maxBytesPerScan';
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const go = argv.includes('--go');
  const useQueue = argv.includes('--queue');
  const fileIdx = argv.indexOf('--file');
  const slugIdx = argv.indexOf('--slug');

  let rawLines: string[] = [];
  if (useQueue) {
    try {
      rawLines = (await kv.smembers<string[]>(WARM_QUEUE_KEY)) ?? [];
    } catch (e) {
      console.error('could not read the warm queue:', e);
      process.exit(1);
    }
  } else if (fileIdx !== -1 && argv[fileIdx + 1]) {
    rawLines = readFileSync(argv[fileIdx + 1], 'utf8').split('\n');
  } else if (slugIdx !== -1 && argv[slugIdx + 1]) {
    rawLines = [argv[slugIdx + 1]];
  } else {
    console.error('Usage: warm-contractor-slugs.ts (--file <f> | --slug <s> | --queue) [--go]');
    console.error('       default is a DRY RUN; --go executes.');
    process.exit(1);
  }

  let slugs = [...new Set(rawLines.map(toSlug).filter((s): s is string => Boolean(s)))];
  if (slugs.length === 0) {
    console.error('No usable slugs in input.');
    process.exit(1);
  }

  if (slugs.length > L.maxRecordsPerRun) {
    console.log(
      `\n⚠️  ${slugs.length} slugs requested; capping at maxRecordsPerRun=${L.maxRecordsPerRun}. ` +
        `Re-run to continue.`,
    );
    slugs = slugs.slice(0, L.maxRecordsPerRun);
  }

  console.log(`\n${go ? 'WARMING' : 'DRY RUN —'} ${slugs.length} contractor slug(s)`);
  console.log(
    `limits: ${L.slugsPerScan}/scan · ${gib(L.maxBytesPerScan)} GiB/scan · ` +
      `${gib(L.maxBytesPerRun)} GiB/run · ${gib(L.dailyScanBudgetBytes)} GiB/day · ` +
      `${L.maxRuntimeMs / 1000}s\n`,
  );

  const budget: Budget = { runBytes: 0, dayBytes: await readDailyBytes(), startedAt: Date.now() };
  console.log(`daily budget already used: ${gib(budget.dayBytes)} GiB\n`);

  const batches = chunk(slugs, L.slugsPerScan);
  const profiles: RollupProfile[] = [];
  let stopped: string | null = null;

  // ── Scan 1: profiles ──────────────────────────────────────────────────────
  for (const [i, part] of batches.entries()) {
    const est = await bqDryRun({ query: ROLLUP_BY_SLUG_SQL, params: { slugs: part } });
    const reason = stopReason(budget, est.bytesProcessed);
    if (reason) {
      stopped = `scan 1 batch ${i + 1}/${batches.length}: ${reason}`;
      break;
    }
    console.log(`scan 1 · batch ${i + 1}/${batches.length} · est ${gib(est.bytesProcessed)} GiB`);
    if (!go) {
      budget.runBytes += est.bytesProcessed;
      continue;
    }
    const rows = await getRollupsBySlugBatch(part, String(L.maxBytesPerScan));
    profiles.push(...rows);
    budget.runBytes += est.bytesProcessed;
    await addDailyBytes(est.bytesProcessed);
  }

  const found = new Map(profiles.map((r) => [r.canonical_slug, r]));
  if (go && found.size) {
    await mapLimit([...found.entries()], L.kvWriteConcurrency, async ([slug, row]) => {
      await primeCache(`rollup:by-slug:${slug}:v2-merged`, [row]);
    });
    console.log(`  primed ${found.size} profile key(s)`);
  }

  // ── Scan 2: aliases for whatever scan 1 missed ────────────────────────────
  const unmatched = slugs.filter((s) => !found.has(s));
  let redirects = new Map<string, string>();
  if (unmatched.length && !stopped) {
    for (const [i, part] of chunk(unmatched, L.slugsPerScan).entries()) {
      const est = await bqDryRun({
        query: CANONICAL_SLUG_SQL,
        params: { slugs: part, normSlugs: part.map(normalizeCompanyName) },
      });
      const reason = stopReason(budget, est.bytesProcessed);
      if (reason) {
        stopped = `scan 2 batch ${i + 1}: ${reason}`;
        break;
      }
      console.log(`scan 2 · batch ${i + 1} · est ${gib(est.bytesProcessed)} GiB`);
      if (!go) {
        budget.runBytes += est.bytesProcessed;
        continue;
      }
      const got = await resolveCanonicalSlugsBatch(part, String(L.maxBytesPerScan));
      for (const [k, v] of got) redirects.set(k, v);
      budget.runBytes += est.bytesProcessed;
      await addDailyBytes(est.bytesProcessed);
    }
    if (go && redirects.size) {
      await mapLimit([...redirects.entries()], L.kvWriteConcurrency, async ([slug, canonical]) => {
        await primeCache(`rollup:canonical-of:${slug}:v3-merged`, [{ canonical_slug: canonical }]);
      });
      console.log(`  primed ${redirects.size} redirect key(s)`);
    }
  }

  // Successfully warmed slugs leave the miss queue.
  if (go && useQueue) {
    const done = [...found.keys(), ...redirects.keys()];
    if (done.length) {
      try {
        await kv.srem(WARM_QUEUE_KEY, ...done);
      } catch {
        /* queue cleanup is best-effort */
      }
    }
  }

  const gone = unmatched.filter((s) => !redirects.has(s));

  console.log('\n──────── RESULT ────────');
  console.log(`mode                        : ${go ? 'EXECUTED' : 'DRY RUN (nothing billed)'}`);
  console.log(`slugs considered            : ${slugs.length}`);
  if (go) {
    const thin = [...found.values()].filter(
      (r) => Number(r.total_obligated || 0) < 25000 || Number(r.award_count || 0) < 2,
    ).length;
    console.log(`profile primed → serves 200 : ${found.size}`);
    console.log(`  …thin → 200 + noindex     : ${thin}`);
    console.log(`redirect primed → 308       : ${redirects.size}`);
    console.log(`genuinely gone → 404        : ${gone.length}`);
  }
  console.log(`bytes scanned this run      : ${gib(budget.runBytes)} GiB`);
  console.log(`daily total after run       : ${gib(budget.dayBytes + budget.runBytes)} GiB`);

  if (stopped) {
    console.log(`\n⚠️  STOPPED EARLY — ${stopped}`);
    console.log('    Coverage is PARTIAL. Unwarmed slugs are simply not advertised in the');
    console.log('    sitemap (it gates on cache presence), so nothing broken was published.');
    console.log('    Re-run to continue.');
  }
  if (!go) {
    console.log('\nNothing executed. Re-run with --go to warm.');
  } else {
    console.log('\n⚠️  NOT LIVE YET — contractor routes cache 7 days (revalidate = 604800).');
    console.log('    Deploy to invalidate, then verify:');
    console.log('      curl -s -o /dev/null -w "%{http_code}\\n" https://getmindy.ai/contractors/<slug>');
  }
  console.log();
}

main().catch((e) => {
  console.error('\nwarm-contractor-slugs failed:', e);
  process.exit(1);
});
