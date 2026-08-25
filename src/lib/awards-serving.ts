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
export async function readServedPage(
  recipientUei: string,
  pageNumber: number,
  pageSize: number,
): Promise<ServedPage | null> {
  const supabase = serviceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('awards_serving_pages')
    .select(
      'payload, contract_count, displayed_action_count, total_action_count, displayed_obligated, source_as_of, generated_at',
    )
    .eq('recipient_uei', recipientUei)
    .eq('page_number', pageNumber)
    .eq('page_size', pageSize)
    .eq('data_version', DATA_VERSION)
    .eq('lifecycle', 'live')
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
