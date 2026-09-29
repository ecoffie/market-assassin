/**
 * One daily SEO health run. OBSERVE-ONLY: it records and reports; it never repairs.
 *
 * Steps (each failure is recorded, never swallowed):
 *   1. Read the live sitemap -> deterministic population. Unreadable = run 'failed', cursors untouched.
 *   2. Crawl canaries + the next rotation batch (our side: status, noindex, canonical, content).
 *      Skipped entirely if ENABLE_SEO_LIVE_BQ is on, because crawling an uncached page would
 *      then trigger a live BigQuery scan.
 *   3. URL Inspection on the next rotation batch (Google's decision). Stops on 429/5xx; the
 *      rest are retried next run. A permanent per-URL 4xx is recorded and moved past.
 *   4. Search Console date x page -> per-section daily trend (upsert).
 *   5. Escalations from stored history (see escalate.ts), then a Slack digest.
 * Cursors advance only across the contiguous prefix of URLs actually observed AND recorded.
 */
import {
  canaryDown,
  googleIndexedDrop,
  gscSectionDrop,
  sectionFailures,
  urlPersistent,
  type Escalation,
  type SectionRate,
} from './escalate';
import { classifyInspection, type IndexStatusResult } from './classify';
import { aggregateSections, crawlUrl, fetchSitemapUrls, pooled, type FetchFn } from './observe';
import { advanceCursor, buildPopulation, planBatch, populationHash, type Batch } from './sample';
import type { SeoHealthStore } from './store';
import {
  CANARY_PATHS,
  CRAWL_CONCURRENCY,
  CRAWL_FAILURES,
  CRAWL_PER_RUN,
  INSPECT_PER_RUN,
  RUN_TIME_BUDGET_MS,
  SITE_ORIGIN,
  sectionOf,
  type CrawlOutcome,
  type Cursor,
  type UrlCheck,
} from './types';
import { buildDigest } from './report';

export interface GscPort {
  /** searchAnalytics rows with keys [date, page]. */
  datePageRows(startDate: string, endDate: string): Promise<Array<{ keys: string[]; clicks: number; impressions: number }>>;
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
  budgets?: Partial<{ crawl: number; inspect: number; timeMs: number }>;
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

const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => iso(ms).slice(0, 10);

function tally<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

export async function runSeoHealth(deps: RunDeps): Promise<RunResult> {
  const origin = deps.origin ?? SITE_ORIGIN;
  const crawlSize = deps.budgets?.crawl ?? CRAWL_PER_RUN;
  const inspectSize = deps.budgets?.inspect ?? INSPECT_PER_RUN;
  const deadline = deps.now() + (deps.budgets?.timeMs ?? RUN_TIME_BUDGET_MS);
  const problems: string[] = [];
  const summary: Record<string, unknown> = { mode: 'observe-only' };

  let runId: number;
  try {
    runId = await deps.store.startRun();
  } catch (e) {
    // Cannot record anything: report failure, touch nothing else.
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

  // 1. Population
  let population: string[];
  try {
    population = buildPopulation(await fetchSitemapUrls(deps.fetch, origin));
  } catch (e) {
    problems.push(`sitemap unreadable: ${(e as Error).message}`);
    return finish('failed', []);
  }
  const popHash = populationHash(population);
  summary.population = population.length;

  // 2. Crawl
  const crawlCursor = await deps.store.loadCursor('crawl');
  const crawlBatch: Batch = planBatch(population, crawlCursor, crawlSize);
  let crawlChecks: UrlCheck[] = [];
  let canaryChecks: UrlCheck[] = [];
  let crawlNext: Cursor = crawlCursor;
  let crawlDone = 0;
  if (deps.liveBqEnabled()) {
    problems.push('crawl skipped: ENABLE_SEO_LIVE_BQ is on, so crawling uncached pages would run live BigQuery');
    summary.crawl = { skipped: 'live_bq_enabled' };
  } else {
    const canaryUrls = CANARY_PATHS.map((p) => origin + p);
    const canaryRes = await pooled(canaryUrls, CRAWL_CONCURRENCY, deadline, deps.now, (u) => crawlUrl(deps.fetch, u, { canary: true }));
    canaryChecks = canaryRes.filter((x): x is UrlCheck => !!x);
    const res = await pooled(crawlBatch.urls, CRAWL_CONCURRENCY, deadline, deps.now, (u) => crawlUrl(deps.fetch, u));
    crawlChecks = res.filter((x): x is UrlCheck => !!x);
    try {
      await deps.store.insertChecks(runId, canaryChecks);
      const written = await deps.store.insertChecks(runId, crawlChecks);
      const adv = advanceCursor(crawlCursor, crawlBatch, written);
      crawlNext = adv.cursor;
      crawlDone = adv.advancedBy;
      if (adv.advancedBy) await deps.store.saveCursor(crawlNext, runId);
    } catch (e) {
      problems.push(`crawl results not recorded (cursor unchanged): ${(e as Error).message}`);
    }
    if (crawlChecks.length < crawlBatch.urls.length) problems.push(`crawl: time budget reached after ${crawlChecks.length}/${crawlBatch.urls.length}; the rest resume next run`);
    const sections: Record<string, SectionRate> = {};
    for (const c of crawlChecks) {
      const s = (sections[c.section] ??= { total: 0, failures: 0 });
      s.total++;
      if (CRAWL_FAILURES.has(c.outcome as CrawlOutcome)) s.failures++;
    }
    summary.crawl = {
      planned: crawlBatch.urls.length,
      observed: crawlChecks.length,
      committed: crawlDone,
      outcomes: tally(crawlChecks.map((c) => c.outcome)),
      canaries: Object.fromEntries(canaryChecks.map((c) => [c.url.replace(origin, '') || '/', c.outcome])),
      sections,
      cycle: crawlNext.cycle,
    };
  }

  // 3. URL Inspection
  const inspectCursor = await deps.store.loadCursor('inspect');
  const inspectBatch = planBatch(population, inspectCursor, inspectSize);
  const inspectChecks: UrlCheck[] = [];
  let inspectNext: Cursor = inspectCursor;
  let inspectDone = 0;
  for (const url of inspectBatch.urls) {
    if (deps.now() >= deadline) {
      problems.push(`inspect: time budget reached after ${inspectChecks.length}/${inspectBatch.urls.length}; the rest resume next run`);
      break;
    }
    const started = deps.now();
    let r;
    try {
      r = await deps.gsc.inspect(url);
    } catch (e) {
      r = { ok: false as const, status: 0, error: (e as Error).message };
    }
    if (!r.ok && (r.status === 0 || r.status === 429 || r.status >= 500)) {
      problems.push(`inspect: stopped on transient error (HTTP ${r.status || 'network'}); ${inspectBatch.urls.length - inspectChecks.length} URLs resume next run`);
      break; // not recorded as observed: this URL is first in line next run
    }
    const v = r.ok ? classifyInspection(url, r.result as IndexStatusResult) : classifyInspection(url, null, `HTTP ${r.status}: ${r.error}`);
    inspectChecks.push({ url, section: sectionOf(url), source: 'inspect', outcome: v.outcome, http_status: r.ok ? 200 : r.status, latency_ms: deps.now() - started, detail: v.detail });
  }
  try {
    const written = await deps.store.insertChecks(runId, inspectChecks);
    const adv = advanceCursor(inspectCursor, inspectBatch, written);
    inspectNext = adv.cursor;
    inspectDone = adv.advancedBy;
    if (adv.advancedBy) await deps.store.saveCursor(inspectNext, runId);
  } catch (e) {
    problems.push(`inspection results not recorded (cursor unchanged): ${(e as Error).message}`);
  }
  const inspectOutcomes = tally(inspectChecks.map((c) => c.outcome));
  const decided = inspectChecks.filter((c) => c.outcome !== 'inspection_error').length;
  summary.inspect = {
    planned: inspectBatch.urls.length,
    observed: inspectChecks.length,
    committed: inspectDone,
    outcomes: inspectOutcomes,
    indexedShare: decided ? (inspectOutcomes.indexed ?? 0) / decided : null,
    cycle: inspectNext.cycle,
  };

  // 4. Search Console section trend (Google data lags about 2-3 days)
  let trendOk = false;
  try {
    const rows = await deps.gsc.datePageRows(day(deps.now() - 40 * 86_400_000), day(deps.now() - 86_400_000));
    await deps.store.upsertSectionDaily(aggregateSections(rows));
    trendOk = true;
  } catch (e) {
    problems.push(`search console trend unavailable: ${(e as Error).message}`);
  }

  // 5. Escalations from stored history
  const escalations: Escalation[] = [];
  try {
    const crawledUrls = [...crawlChecks, ...canaryChecks].map((c) => c.url);
    if (crawledUrls.length) escalations.push(...urlPersistent(await deps.store.crawlHistory(crawledUrls, iso(deps.now() - 180 * 86_400_000))));
    escalations.push(...canaryDown(await deps.store.canaryHistory(2)));
    const prev = await deps.store.previousRunSummary(runId);
    const nowSections = (summary.crawl as { sections?: Record<string, SectionRate> } | undefined)?.sections;
    const prevSections = (prev?.crawl as { sections?: Record<string, SectionRate> } | undefined)?.sections ?? null;
    if (nowSections) escalations.push(...sectionFailures(nowSections, prevSections));
    if (trendOk) escalations.push(...gscSectionDrop(await deps.store.sectionDaily(day(deps.now() - 45 * 86_400_000))));
    escalations.push(...googleIndexedDrop(await deps.store.inspections(iso(deps.now() - 14 * 86_400_000)), deps.now()));
  } catch (e) {
    problems.push(`escalation history unavailable: ${(e as Error).message}`);
  }

  const status: RunResult['status'] = problems.length ? 'partial' : 'ok';
  return finish(status, escalations, {
    population: population.length,
    population_hash: popHash,
    crawl_planned: crawlBatch.urls.length,
    crawl_done: crawlDone,
    crawl_cursor_start: crawlCursor.last_url,
    crawl_cursor_end: crawlNext.last_url,
    inspect_planned: inspectBatch.urls.length,
    inspect_done: inspectDone,
    inspect_cursor_start: inspectCursor.last_url,
    inspect_cursor_end: inspectNext.last_url,
  });
}
