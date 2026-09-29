/**
 * One daily SEO health run. OBSERVE-ONLY: it records and reports; it never repairs.
 *
 * Steps (each failure is recorded, never swallowed):
 *   1. Read the live sitemap -> deterministic population -> one sorted population per stratum.
 *      Unreadable sitemap = run 'failed', cursors untouched.
 *   2. Crawl the canaries plus, per stratum, the next CRAWL_ALLOCATION[stratum] URLs after that
 *      stratum's own cursor. Skipped entirely if ENABLE_SEO_LIVE_BQ is on (crawling an uncached
 *      page would then trigger a live BigQuery scan).
 *   3. URL Inspection per stratum, INSPECT_ALLOCATION[stratum] URLs from its own cursor. Stops on
 *      429/5xx (the rest resume next run); a permanent per-URL 4xx is recorded and moved past.
 *   4. Search Console date x page, PAGINATED to completion, for the 31 mature days ending 3 days
 *      ago. Per-stratum trends and the drop check use only a complete response.
 *   5. Escalations from stored history (escalate.ts), then a Slack digest.
 * Each (stream, stratum) cursor advances only across the contiguous prefix of URLs actually
 * observed AND recorded.
 */
import {
  canaryDown,
  googleIndexedDrop,
  indexedShareByStratum,
  matureEndDay,
  calendar,
  stratumFailures,
  stratumImpressionDrop,
  urlPersistent,
  GSC_DROP,
  type Escalation,
  type StratumRate,
} from './escalate';
import { classifyInspection, type IndexStatusResult } from './classify';
import { aggregateStrata, crawlUrl, fetchSitemapUrls, pooled, type FetchFn, type PagedGscResult } from './observe';
import { advanceCursor, buildPopulation, partitionByStratum, planBatch, populationHash } from './sample';
import type { SeoHealthStore } from './store';
import {
  CANARY_PATHS,
  CRAWL_ALLOCATION,
  CRAWL_CONCURRENCY,
  CRAWL_FAILURES,
  INSPECT_ALLOCATION,
  RUN_TIME_BUDGET_MS,
  SITE_ORIGIN,
  STRATA,
  coverageDays,
  stratumOf,
  type CrawlOutcome,
  type Stratum,
  type Stream,
  type UrlCheck,
} from './types';
import { buildDigest } from './report';

export interface GscPort {
  /** searchAnalytics date x page for [startDate, endDate], paginated to completion (never throws). */
  datePageRows(startDate: string, endDate: string): Promise<PagedGscResult>;
  inspect(url: string): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; status: number; error: string }>;
}

export interface RunDeps {
  fetch: FetchFn;
  gsc: GscPort;
  store: SeoHealthStore;
  postSlack: (text: string, blocks: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  now: () => number;
  liveBqEnabled: () => boolean;
  origin?: string;
  budgets?: Partial<{ crawl: Partial<Record<Stratum, number>>; inspect: Partial<Record<Stratum, number>>; timeMs: number }>;
}

export interface RunResult {
  ok: boolean;
  status: 'ok' | 'partial' | 'failed';
  runId: number | null;
  problems: string[];
  summary: Record<string, unknown>;
  escalations: Escalation[];
  slack: 'posted' | 'failed' | 'skipped';
}

interface StreamStratumSummary {
  population: number;
  perRun: number;
  coverageDays: number | null;
  planned: number;
  observed: number;
  committed: number;
  cycle: number;
  outcomes: Record<string, number>;
}

const iso = (ms: number) => new Date(ms).toISOString();

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

export async function runSeoHealth(deps: RunDeps): Promise<RunResult> {
  const origin = deps.origin ?? SITE_ORIGIN;
  const crawlAlloc = { ...CRAWL_ALLOCATION, ...deps.budgets?.crawl };
  const inspectAlloc = { ...INSPECT_ALLOCATION, ...deps.budgets?.inspect };
  const deadline = deps.now() + (deps.budgets?.timeMs ?? RUN_TIME_BUDGET_MS);
  const problems: string[] = [];
  const summary: Record<string, unknown> = { mode: 'observe-only' };

  let runId: number;
  try {
    runId = await deps.store.startRun();
  } catch (e) {
    return { ok: false, status: 'failed', runId: null, problems: [`store unavailable: ${(e as Error).message}`], summary, escalations: [], slack: 'skipped' };
  }

  const finish = async (status: RunResult['status'], escalations: Escalation[], extra: Record<string, unknown> = {}): Promise<RunResult> => {
    summary.problems = problems;
    let slack: RunResult['slack'] = 'skipped';
    try {
      const digest = buildDigest({ status, summary, escalations, problems });
      const posted = await deps.postSlack(digest.text, digest.blocks);
      slack = posted.ok ? 'posted' : 'failed';
      if (!posted.ok) problems.push(`slack: ${posted.error ?? 'unknown error'}`);
    } catch (e) {
      slack = 'failed';
      problems.push(`slack: ${(e as Error).message}`);
    }
    try {
      await deps.store.updateRun(runId, { status, summary, escalations, slack_state: slack, error: problems.length ? problems.join(' | ').slice(0, 2000) : null, finished_at: iso(deps.now()), ...extra });
    } catch (e) {
      problems.push(`record run: ${(e as Error).message}`);
      return { ok: false, status: 'failed', runId, problems, summary, escalations, slack };
    }
    return { ok: status !== 'failed', status, runId, problems, summary, escalations, slack };
  };

  // 1. Population, partitioned into strata
  let population: string[];
  try {
    population = buildPopulation(await fetchSitemapUrls(deps.fetch, origin));
  } catch (e) {
    problems.push(`sitemap unreadable: ${(e as Error).message}`);
    return finish('failed', []);
  }
  const byStratum = partitionByStratum(population, stratumOf, STRATA);
  summary.population = population.length;
  summary.strata = Object.fromEntries(STRATA.map((s) => [s, byStratum[s].length]));

  // One stream (crawl or inspect) over all strata, each with its own cursor.
  const runStream = async (
    stream: Stream,
    alloc: Record<Stratum, number>,
    observe: (urls: string[], stratum: Stratum) => Promise<{ checks: UrlCheck[]; stop?: string }>,
  ): Promise<{ checks: UrlCheck[]; perStratum: Record<string, StreamStratumSummary> }> => {
    const all: UrlCheck[] = [];
    const perStratum: Record<string, StreamStratumSummary> = {};
    let stopped: string | undefined;
    // Rotate which stratum goes first by UTC day, so an early stop (time budget, Google 429)
    // cannot starve the same strata every run. Deterministic for a given day.
    const offset = Math.floor(deps.now() / 86_400_000) % STRATA.length;
    const order = [...STRATA.slice(offset), ...STRATA.slice(0, offset)];
    for (const stratum of order) {
      const pop = byStratum[stratum];
      const cursor = await deps.store.loadCursor(stream, stratum);
      const batch = planBatch(pop, cursor, stopped ? 0 : alloc[stratum]);
      let checks: UrlCheck[] = [];
      if (batch.urls.length) {
        const r = await observe(batch.urls, stratum);
        checks = r.checks;
        if (r.stop) stopped = r.stop;
      }
      let next = cursor;
      let committed = 0;
      try {
        const written = await deps.store.insertChecks(runId, checks);
        const adv = advanceCursor(cursor, batch, written);
        next = adv.cursor;
        committed = adv.advancedBy;
        if (committed) await deps.store.saveCursor(next, runId);
      } catch (e) {
        problems.push(`${stream}/${stratum}: results not recorded (cursor unchanged): ${(e as Error).message}`);
      }
      if (checks.length < batch.urls.length && !stopped) problems.push(`${stream}/${stratum}: ${checks.length}/${batch.urls.length} observed; the rest resume next run`);
      perStratum[stratum] = {
        population: pop.length,
        perRun: alloc[stratum],
        coverageDays: coverageDays(pop.length, alloc[stratum]),
        planned: batch.urls.length,
        observed: checks.length,
        committed,
        cycle: next.cycle,
        outcomes: tally(checks.map((c) => c.outcome)),
      };
      all.push(...checks);
    }
    if (stopped) problems.push(`${stream}: ${stopped}; remaining strata resume next run`);
    return { checks: all, perStratum };
  };

  // 2. Crawl
  let crawlChecks: UrlCheck[] = [];
  let canaryChecks: UrlCheck[] = [];
  if (deps.liveBqEnabled()) {
    problems.push('crawl skipped: ENABLE_SEO_LIVE_BQ is on, so crawling uncached pages would run live BigQuery');
    summary.crawl = { skipped: 'live_bq_enabled' };
  } else {
    const canaryRes = await pooled(CANARY_PATHS.map((p) => origin + p), CRAWL_CONCURRENCY, deadline, deps.now, (u) => crawlUrl(deps.fetch, u, { canary: true }));
    canaryChecks = canaryRes.filter((x): x is UrlCheck => !!x);
    try {
      await deps.store.insertChecks(runId, canaryChecks);
    } catch (e) {
      problems.push(`canary results not recorded: ${(e as Error).message}`);
    }
    const crawl = await runStream('crawl', crawlAlloc, async (urls) => {
      const res = await pooled(urls, CRAWL_CONCURRENCY, deadline, deps.now, (u) => crawlUrl(deps.fetch, u));
      const checks = res.filter((x): x is UrlCheck => !!x);
      return { checks, stop: deps.now() >= deadline ? 'time budget reached' : undefined };
    });
    crawlChecks = crawl.checks;
    const rates: Partial<Record<Stratum, StratumRate>> = {};
    for (const c of crawlChecks) {
      const r = (rates[c.stratum] ??= { total: 0, failures: 0 });
      r.total++;
      if (CRAWL_FAILURES.has(c.outcome as CrawlOutcome)) r.failures++;
    }
    summary.crawl = {
      byStratum: crawl.perStratum,
      rates,
      canaries: Object.fromEntries(canaryChecks.map((c) => [c.url.replace(origin, '') || '/', c.outcome])),
    };
  }

  // 3. URL Inspection
  const inspect = await runStream('inspect', inspectAlloc, async (urls) => {
    const checks: UrlCheck[] = [];
    for (const url of urls) {
      if (deps.now() >= deadline) return { checks, stop: 'time budget reached' };
      const started = deps.now();
      let r;
      try {
        r = await deps.gsc.inspect(url);
      } catch (e) {
        r = { ok: false as const, status: 0, error: (e as Error).message };
      }
      if (!r.ok && (r.status === 0 || r.status === 429 || r.status >= 500)) {
        return { checks, stop: `stopped on transient inspection error (HTTP ${r.status || 'network'})` };
      }
      const v = r.ok ? classifyInspection(url, r.result as IndexStatusResult) : classifyInspection(url, null, `HTTP ${r.status}: ${r.error}`);
      checks.push({ url, stratum: stratumOf(url), source: 'inspect', outcome: v.outcome, http_status: r.ok ? 200 : r.status, latency_ms: deps.now() - started, detail: v.detail });
    }
    return { checks };
  });
  summary.inspect = { byStratum: inspect.perStratum };

  // 4. Search Console trend over mature days, paginated to completion
  const endDay = matureEndDay(deps.now());
  const window = calendar(endDay, GSC_DROP.baselineDays + GSC_DROP.recentDays);
  const gsc = await deps.gsc.datePageRows(window[0], endDay);
  summary.searchConsole = { window: [window[0], endDay], rows: gsc.rowCount, pages: gsc.pages, complete: gsc.complete, error: gsc.error ?? null };
  const strataDaily = aggregateStrata(gsc.rows);
  if (!gsc.complete) {
    problems.push(`search console incomplete (${gsc.rowCount} rows over ${gsc.pages} pages): ${gsc.error ?? 'unknown'}; no trend computed`);
  } else {
    try {
      await deps.store.upsertStratumDaily(strataDaily);
    } catch (e) {
      problems.push(`search console trend not recorded: ${(e as Error).message}`);
    }
  }

  // 5. Escalations
  const escalations: Escalation[] = [];
  const drop = stratumImpressionDrop(strataDaily, { complete: gsc.complete, endDay, strata: STRATA });
  (summary.searchConsole as Record<string, unknown>).evaluated = drop.evaluated;
  (summary.searchConsole as Record<string, unknown>).baselinePerDay = drop.baselines;
  escalations.push(...drop.escalations);
  try {
    const crawledUrls = [...crawlChecks, ...canaryChecks].map((c) => c.url);
    if (crawledUrls.length) escalations.push(...urlPersistent(await deps.store.crawlHistory(crawledUrls, iso(deps.now() - 365 * 86_400_000))));
    if (canaryChecks.length) {
      // This run's canaries (in memory; the run is not finalized yet) vs the preceding completed run.
      const current = Object.fromEntries(canaryChecks.map((c) => [c.url, c.outcome]));
      escalations.push(...canaryDown(current, await deps.store.previousCompletedCanaries(runId)));
    }
    const prev = await deps.store.previousRunSummary(runId);
    const nowRates = (summary.crawl as { rates?: Partial<Record<Stratum, StratumRate>> } | undefined)?.rates;
    const prevRates = (prev?.crawl as { rates?: Partial<Record<Stratum, StratumRate>> } | undefined)?.rates ?? null;
    if (nowRates) escalations.push(...stratumFailures(nowRates, prevRates));
    const shares = indexedShareByStratum(await deps.store.inspections(iso(deps.now() - 14 * 86_400_000)), STRATA, deps.now());
    summary.indexedShare = shares;
    escalations.push(...googleIndexedDrop(shares));
  } catch (e) {
    problems.push(`escalation history unavailable: ${(e as Error).message}`);
  }

  const status: RunResult['status'] = problems.length ? 'partial' : 'ok';
  return finish(status, escalations, {
    population: population.length,
    population_hash: populationHash(population),
    crawl_planned: crawlChecks.length ? Object.values((summary.crawl as { byStratum: Record<string, StreamStratumSummary> }).byStratum).reduce((a, s) => a + s.planned, 0) : 0,
    crawl_done: crawlChecks.length ? Object.values((summary.crawl as { byStratum: Record<string, StreamStratumSummary> }).byStratum).reduce((a, s) => a + s.committed, 0) : 0,
    inspect_planned: Object.values(inspect.perStratum).reduce((a, s) => a + s.planned, 0),
    inspect_done: Object.values(inspect.perStratum).reduce((a, s) => a + s.committed, 0),
  });
}
