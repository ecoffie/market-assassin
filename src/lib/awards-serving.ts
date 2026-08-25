import { createClient } from '@supabase/supabase-js';
import { DATA_VERSION } from './bigquery/cache';

/**
 * Durable awards serving layer — the authoritative copy of the precomputed
 * /contractors/<uei>/contracts pages.
 *
 * READ ORDER (enforced by getServedAwardsPage, never reordered):
 *   1. Redis hit                       — fast path
 *   2. this table                      — durable truth; may repopulate Redis
 *   3. honest unavailable state        — noindex, never a fabricated zero
 *
 * ⚠️ THERE IS NO STEP 4. A web request must never trigger a live BigQuery scan:
 * that turns crawler traffic into an uncontrolled recurring bill, which is why
 * live reads were disabled in the first place. The table is populated by an
 * offline build, not by page views.
 *
 * Background: Redis was previously the ONLY copy of this data, on a 90-day TTL,
 * and `queryCached()` returns [] on a miss — indistinguishable from a genuine
 * zero. 11,772 pages published "0 contracts" they could not support and the
 * cluster was demoted ~86%. A durable table cannot lapse; a cache can.
 */

export interface ServedAwardRow {
  award_id: string | null;
  piid: string | null;
  awarding_agency: string | null;
  awarding_office: string | null;
  naics_code: string | null;
  naics_description: string | null;
  description: string | null;
  obligation_amount: number | null;
  action_date: string | null;
  pop_start_date: string | null;
  pop_end_date: string | null;
  pop_state: string | null;
  set_aside: string | null;
}

/**
 * The three counts, kept distinct on purpose.
 *
 * Conflating them is exactly how "29 Federal Contracts" ended up as the title
 * over a 124-row table. For Senture LLC all three are correct measurements of
 * different things.
 */
export interface AwardCounts {
  /** Distinct contracts (award_id / PIID). Senture: 23. */
  contracts: number;
  /** Award ACTIONS rendered on the page (obligation_amount > 0). Senture: 124. */
  displayedActions: number;
  /** All actions incl. $0 modifications. Senture: 330. */
  totalActions: number;
  /** SUM(obligation_amount) over displayed actions only. */
  displayedObligated: number;
}

export interface ServedPage {
  rows: ServedAwardRow[];
  counts: AwardCounts;
  /** MAX(action_date) in the source when this page was built. */
  sourceAsOf: string | null;
  generatedAt: string;
  /** Which tier answered. For logging and for deciding whether to warm Redis. */
  servedFrom: 'redis' | 'table';
}

function serviceClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Read one precomputed page from the durable table.
 *
 * Returns null for BOTH "no such row" and "the read failed" — the caller treats
 * either as unavailable and renders the honest state. That is deliberate: this
 * function must never let a failure masquerade as an empty result, which is the
 * bug the whole exercise exists to eliminate.
 */

/**
 * Resolve the ACTIVE awards generation.
 *
 * Readers must go through this pointer rather than filtering on
 * `lifecycle = 'live'`. Promotion used to be two statements — retire the old,
 * promote the new — and a forced-failure test on 2026-08-25 proved that between
 * them ZERO rows were live. That window opens on every successful refresh, so
 * concurrent visitors would briefly get the honest-unavailable state and a
 * noindex on pages that are perfectly fine.
 *
 * With the pointer, promotion is a single-row UPDATE: a reader sees the old
 * generation or the new one, never zero and never a mix.
 *
 * Returns null if the pointer is unreadable — the caller then renders the honest
 * unavailable state rather than guessing a version.
 */
let activeVersionCache: { value: string | null; at: number } | null = null;
const ACTIVE_VERSION_TTL_MS = 30_000; // brief: a promote must take effect promptly

export async function getActiveAwardsVersion(): Promise<string | null> {
  const now = Date.now();
  if (activeVersionCache && now - activeVersionCache.at < ACTIVE_VERSION_TTL_MS) {
    return activeVersionCache.value;
  }
  const supabase = serviceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('awards_active_version')
    .select('active_version')
    .eq('id', 1)
    .limit(1) // single-row pointer table (CHECK id=1) — bound stated explicitly
    .maybeSingle();
  if (error) {
    console.error('[awards-serving] active-version read failed:', error.message);
    return null; // never fall back to a guess
  }
  const value = data?.active_version ?? null;
  activeVersionCache = { value, at: now };
  return value;
}

export async function readServedPage(
  recipientUei: string,
  pageNumber: number,
  pageSize: number,
): Promise<ServedPage | null> {
  const supabase = serviceClient();
  if (!supabase) return null;

  // Resolve the ACTIVE generation, never `lifecycle='live'` — see
  // getActiveAwardsVersion() for the zero-live window that motivated this.
  const version = await getActiveAwardsVersion();
  if (!version) return null;

  const { data, error } = await supabase
    .from('awards_serving_pages')
    .select(
      'payload, contract_count, displayed_action_count, total_action_count, displayed_obligated, source_as_of, generated_at',
    )
    .eq('recipient_uei', recipientUei)
    .eq('page_number', pageNumber)
    .eq('page_size', pageSize)
    .eq('data_version', version)
    .maybeSingle();

  // Check `error` explicitly. A PostgREST failure returns data:null with an error
  // set, and treating that as "no rows" would recreate the false-zero bug in a
  // new layer.
  if (error) {
    console.error(
      `[awards-serving] read failed for ${recipientUei} p${pageNumber}:`,
      error.message,
    );
    return null;
  }
  if (!data) return null;

  return {
    rows: (data.payload ?? []) as ServedAwardRow[],
    counts: {
      contracts: data.contract_count ?? 0,
      displayedActions: data.displayed_action_count ?? 0,
      totalActions: data.total_action_count ?? 0,
      displayedObligated: Number(data.displayed_obligated ?? 0),
    },
    sourceAsOf: data.source_as_of ?? null,
    generatedAt: data.generated_at,
    servedFrom: 'table',
  };
}

/**
 * How deep public pagination goes.
 *
 * Only warmed pages are linked. Advertising page 4 when only 3 are built sends a
 * reader to an honest-but-empty state, which is a worse experience than saying
 * plainly that we show the most recent N actions.
 */
export const SERVED_PAGE_SIZE = 50;
export const SERVED_MAX_PAGES = 3;

/** The honest ceiling to state in copy: "the 150 most recent award actions". */
export const SERVED_MAX_ACTIONS = SERVED_PAGE_SIZE * SERVED_MAX_PAGES;

/**
 * TTL jitter for the Redis write-behind.
 *
 * Deterministic per key so a rebuild is idempotent, and spread across a ~40-day
 * band so a bulk warm cannot expire as one cohort and recreate the outage. Jitter
 * alone is NOT a refresh strategy — it spreads the failure rather than preventing
 * it — so it exists alongside the scheduled rolling refresh, not instead of it.
 */
export function jitteredTtlSeconds(key: string, baseDays = 90, spreadDays = 40): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const offset = (h % (spreadDays * 2)) - spreadDays; // −spread … +spread
  return Math.max(7, baseDays + offset) * 24 * 60 * 60;
}

/**
 * The "as of" date for a recipient's award data: MAX(action_date) in the source at
 * build time. Distinct from generated_at — a fresh build over stale source is not
 * fresh data, and a reader deserves to know which one they are looking at.
 *
 * Returns null when unknown; the page then shows no date rather than guessing one.
 */
export async function getAwardsSourceAsOf(recipientUei: string): Promise<string | null> {
  const supabase = serviceClient();
  if (!supabase) return null;
  const version = await getActiveAwardsVersion();
  if (!version) return null;
  const { data, error } = await supabase
    .from('awards_serving_pages')
    .select('source_as_of')
    .eq('recipient_uei', recipientUei)
    .eq('data_version', version)
    .limit(1)
    .maybeSingle();
  if (error || !data?.source_as_of) return null;
  const [y, m, d] = String(data.source_as_of).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * The set of recipient UEIs that have a LIVE page-1 serving row.
 *
 * The sitemap gates on this PER RECIPIENT, never on a global "the table has data"
 * boolean. The difference is not academic: there are 12,000 sitemap candidates but
 * only 9,639 recipients with a served page. A global flag would emit ~2,361 URLs
 * that the pages themselves render `noindex` — telling Google to crawl what we
 * simultaneously tell it to ignore.
 *
 * Excluded by construction:
 *   - the 54 recipients whose every action is zero-dollar or negative
 *   - candidate profiles with no awards serving row at all
 *   - any non-live lifecycle or non-current data_version
 *
 * Fails CLOSED: on error the set is empty, so the cluster is omitted rather than
 * asserted with uncertainty. An omitted URL returns on the next build; an
 * asserted-but-noindex one is the contradiction that demoted the cluster.
 */
export async function getServedContractsUeis(): Promise<Set<string>> {
  const supabase = serviceClient();
  if (!supabase) return new Set();

  // Gate on the ACTIVE generation, so the sitemap and the pages agree about
  // which version is live even mid-promotion.
  const version = await getActiveAwardsVersion();
  if (!version) return new Set();

  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('awards_serving_pages')
      .select('recipient_uei')
      .eq('data_version', version)
      .eq('page_number', 1) // page 1 is what a /contracts URL resolves to
      .order('recipient_uei', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[awards-serving] served-UEI scan failed:', error.message);
      return new Set(); // fail closed — never a partial set
    }
    const rows = data ?? [];
    for (const r of rows) out.add(r.recipient_uei as string);
    if (rows.length < PAGE) break;
    if (out.size > 200_000) break; // backstop
  }
  return out;
}
