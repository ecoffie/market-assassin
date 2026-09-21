/**
 * Platform Health — the Observatory measuring ITSELF.
 *
 * ORIGIN (2026-08-15). Eric, after I reported "/awards, the contractor DB and Past Awards are
 * serving stale data" — a claim I had INFERRED from a failing oracle and never measured (the
 * ingest had in fact run successfully every Sunday, and both surfaces were serving real rows):
 *
 *   *"The important sentence wasn't about BigQuery. It was: 'I inferred it and stated it as fact.'
 *   That's the governance lesson… Nothing surfaced the measurement where I'd see it. That's not an
 *   engineering failure, that's an observability failure."*
 *
 * So this module exists to make data-health claims CHECKABLE AT A GLANCE instead of inferrable.
 *
 * ── THE ONE RULE THIS FILE ENFORCES ─────────────────────────────────────────────────────────
 * **Never report a status we did not measure.** Every check returns one of:
 *   · `healthy` / `degraded` / `failed`  — we ran the check and this is the result
 *   · `unknown`                          — WE COULD NOT MEASURE, and `blockedBy` says why
 *
 * `unknown` is a first-class outcome, not an error. The BigQuery quota exhaustion is exactly this
 * case: it blocks the query that MEASURES freshness, which is a completely different fact from
 * "the data is stale" — and conflating the two is the mistake this module was built to prevent.
 * (Eric's Rule 4: *"Never say 'the data is stale.' Say 'freshness verification is currently
 * unavailable because…'"*)
 *
 * Corollary: a check that THROWS must surface as `unknown` with the real error text, never as
 * `healthy` (a swallowed error that reads green is worse than no check) and never as `failed`
 * (which would assert a problem we haven't actually observed in the data).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type HealthStatus = 'healthy' | 'degraded' | 'failed' | 'unknown';

export interface DatasetHealth {
  key: string;
  name: string;
  category: string;
  /** Declared refresh cadence from the registry — the EXPECTATION we judge freshness against. */
  cadence: string;
  /** ISO date of the last recorded build/ingest. Null = never stamped (not the same as stale). */
  lastBuilt: string | null;
  daysSinceBuilt: number | null;
  recordCount: number | null;
  status: HealthStatus;
  /** Why we couldn't measure — populated ONLY when status is 'unknown'. */
  blockedBy?: string;
  /** Plain-English reading of the status, always traceable to the fields above. */
  detail: string;
}

export interface JobHealth {
  jobName: string;
  cronExpr: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  hoursSinceRun: number | null;
  status: HealthStatus;
  detail: string;
}

export interface PlatformHealth {
  datasets: DatasetHealth[];
  jobs: JobHealth[];
  /** Checks we deliberately could NOT run, each naming its blocker. The honesty surface. */
  unmeasured: Array<{ check: string; blockedBy: string }>;
  generatedAt: string;
  /** True when ANY block of this report failed to load — the report says so rather than partially lying. */
  degraded: boolean;
}

/** Cadence → the age (in days) past which a dataset is genuinely overdue, not merely old. */
const CADENCE_DAYS: Record<string, number> = {
  'real-time': 1,
  daily: 2,
  weekly: 10,        // a weekly job gets a 3-day grace window before it reads as late
  monthly: 40,
  quarterly: 100,
  'as-published': Infinity,   // no schedule to be late against
};

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(`${iso}${iso.length === 10 ? 'T00:00:00Z' : ''}`).getTime();
  if (!isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 864e5);
}

/**
 * Judge a dataset against its OWN declared cadence.
 *
 * ⚠️ A live-API source has no `last_built` by design (nothing builds it — it's fetched on demand),
 * so a null there means "not applicable", NOT "stale". Reporting those as failures would flood the
 * page with red that means nothing, and a page that cries wolf stops being read.
 */
function judgeDataset(row: {
  key: string; name: string; category: string; refresh_cadence: string | null;
  last_built: string | null; record_count: number | null;
}): DatasetHealth {
  const cadence = row.refresh_cadence || 'unknown';
  const days = ageDays(row.last_built);
  const base = {
    key: row.key, name: row.name, category: row.category, cadence,
    lastBuilt: row.last_built, daysSinceBuilt: days, recordCount: row.record_count,
  };

  // Live APIs are fetched per-request; there is no build to be stale.
  if (row.category === 'live_api') {
    return { ...base, status: 'healthy', detail: 'Live API — fetched on demand, nothing to refresh.' };
  }

  if (!row.last_built) {
    // NEVER stamped ≠ stale. We genuinely do not know when this last refreshed.
    return {
      ...base,
      status: 'unknown',
      blockedBy: 'no last_built stamp in the data_sources registry',
      detail: 'Never stamped — freshness cannot be verified for this source.',
    };
  }

  const limit = CADENCE_DAYS[cadence] ?? Infinity;
  if (days == null) {
    return { ...base, status: 'unknown', blockedBy: 'unparseable last_built date', detail: 'Stamp present but unreadable.' };
  }
  if (days <= limit) {
    return { ...base, status: 'healthy', detail: `Refreshed ${days}d ago · ${cadence} cadence.` };
  }
  return {
    ...base,
    status: 'degraded',
    detail: `Last refreshed ${days}d ago — past the ${cadence} cadence (expected within ${limit}d).`,
  };
}

/** A scheduled job is judged on whether it RAN, and whether its last run reported success. */
function judgeJob(row: { job_name: string; cron_expr: string; last_run_at: string | null; last_status: string | null }): JobHealth {
  const hrs = row.last_run_at ? Math.floor((Date.now() - new Date(row.last_run_at).getTime()) / 36e5) : null;
  const base = { jobName: row.job_name, cronExpr: row.cron_expr, lastRunAt: row.last_run_at, lastStatus: row.last_status, hoursSinceRun: hrs };

  if (!row.last_run_at) {
    return { ...base, status: 'unknown', detail: 'Registered but has never run — nothing measured yet.' };
  }
  if (row.last_status === 'error' || row.last_status === 'timeout') {
    return { ...base, status: 'failed', detail: `Last run reported "${row.last_status}" ${hrs}h ago.` };
  }
  // 'dispatched' = fired but never reported completion. That is genuinely unknown, not success:
  // long jobs are ack'd early by design, so we cannot tell a still-running job from a dead one.
  if (row.last_status === 'dispatched') {
    return { ...base, status: 'unknown', detail: `Dispatched ${hrs}h ago but never reported completion — outcome unknown.` };
  }
  return { ...base, status: 'healthy', detail: `Last run succeeded ${hrs}h ago.` };
}

export async function getPlatformHealth(): Promise<PlatformHealth> {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const unmeasured: PlatformHealth['unmeasured'] = [];
  let degraded = false;

  const [dsRes, jobRes] = await Promise.all([
    sb.from('data_sources')
      .select('key, name, category, refresh_cadence, last_built, record_count')
      .eq('is_active', true)
      .order('category'),
    sb.from('cron_jobs')
      .select('job_name, cron_expr, last_run_at, last_status')
      .eq('enabled', true)
      .order('job_name'),
  ]);

  // A failed BLOCK is reported as unmeasured — the page shows a hole, not a green row.
  if (dsRes.error) {
    degraded = true;
    unmeasured.push({ check: 'Dataset freshness', blockedBy: `data_sources read failed: ${dsRes.error.message}` });
  }
  if (jobRes.error) {
    degraded = true;
    unmeasured.push({ check: 'Scheduled job health', blockedBy: `cron_jobs read failed: ${jobRes.error.message}` });
  }

  const datasets = (dsRes.data || []).map(judgeDataset);
  const jobs = (jobRes.data || []).map(judgeJob);

  // ── The BigQuery verification check ───────────────────────────────────────────────────────
  // This is the check whose absence caused the original wrong claim. It probes the SAME query the
  // freshness oracle runs. Three distinct outcomes, deliberately NOT collapsed:
  //   quota exhausted → UNKNOWN  ("we cannot verify"), never "stale"
  //   query succeeds  → healthy/degraded on the real age
  //   any other error → UNKNOWN with the real message
  try {
    const { BigQuery } = await import('@google-cloud/bigquery');
    // ⚠️ GCP_SA_JSON is stored BASE64-ENCODED in this project (measured: a raw JSON.parse threw
    // `Unexpected token 'e', "ewogICJ0eX"…` — that's `{"ty…` base64'd). Decode when it doesn't
    // start with '{'. Getting this wrong made a CREDENTIAL-FORMAT error masquerade as the
    // blocker text on the page, which is precisely the kind of misleading status this module
    // exists to prevent.
    const raw = process.env.GCP_SA_JSON || '';
    const decoded = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const creds = decoded ? JSON.parse(decoded) : null;
    if (!creds) {
      unmeasured.push({ check: 'BigQuery awards freshness', blockedBy: 'GCP_SA_JSON not configured in this environment' });
    } else {
      const bq = new BigQuery({ projectId: creds.project_id, credentials: creds });
      const [rows] = await bq.query({
        query: 'SELECT MAX(action_date) AS latest FROM `market-assasin.usaspending.awards` WHERE fiscal_year >= 2026',
        maximumBytesBilled: String(2 * 1024 ** 3),
      });
      const latest = rows?.[0]?.latest?.value ?? rows?.[0]?.latest ?? null;
      const days = ageDays(typeof latest === 'string' ? latest.slice(0, 10) : null);
      datasets.push({
        key: 'bq_awards_verified', name: 'BigQuery awards — VERIFIED against the table', category: 'verified',
        cadence: 'weekly', lastBuilt: typeof latest === 'string' ? latest.slice(0, 10) : null,
        daysSinceBuilt: days, recordCount: null,
        status: days != null && days <= 21 ? 'healthy' : 'degraded',
        detail: days != null
          ? `Newest award action_date is ${days}d old (government reporting lags ~2 weeks).`
          : 'Query returned no date.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The quota case gets its own plain-English blocker so nobody has to interpret a GCP error.
    const quota = /quota/i.test(msg);
    unmeasured.push({
      check: 'BigQuery awards freshness',
      blockedBy: quota
        ? 'BigQuery daily query quota (QueryUsagePerDay) is exhausted — this blocks VERIFICATION only. It does not mean the data is stale; the ingest and the cached surfaces are judged separately above.'
        : msg,
    });
  }

  return { datasets, jobs, unmeasured, generatedAt: new Date().toISOString(), degraded };
}
