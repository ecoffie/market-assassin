/**
 * Shared UEI-keyed contractor history — Map/in-app and MCP consume this one service.
 *
 * Serving order (no live USASpending on the request path):
 *   1. Warm Vercel KV via getBqContractorHistory(liveBq:false)
 *   2. If profile warm but detail caches incomplete → cold-fill when policy allows,
 *      else return enrichment_status:'budget_limited' (never false-complete empties)
 *   3. Budgeted / always cold BQ fill on full warm miss (policy)
 *   4. Last-known-good is inside queryCached on BQ failure
 *   5. sam_entities (lookupLocalEntityByUEI) for registered-zero vs unresolved
 *   6. degraded/unavailable
 */
import {
  getBqContractorHistory,
} from '@/lib/bigquery/recipients';
import { bqUnavailable } from '@/lib/bigquery/cache';
import {
  allowColdBqLookup,
  type ColdBqTurnState,
} from '@/lib/bigquery/cold-budget';
import type { ContractorSalesHistory } from '@/lib/contractor-sales-history';
import { slugifyContractorName } from '@/lib/contractor-sales-history';
import { lookupLocalEntityByUEI } from '@/lib/sam/entity-local-fallback';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';

export type ContractorHistoryResolution =
  | 'found'
  | 'registered_zero'
  | 'not_found'
  | 'malformed'
  | 'unavailable';

export type ColdBqPolicy = 'never' | 'always' | 'budgeted';

export interface GetContractorHistoryByUeiOptions {
  uei: string;
  /** Email / identity for the shared chat-bq budget key. Required when coldPolicy is budgeted. */
  actor?: string;
  /**
   * always — Map drawer (authorized cold).
   * budgeted — MCP/chat (Tier-2 limits).
   * never — warm-only / tests.
   */
  coldPolicy?: ColdBqPolicy;
  /** Optional turn counter for budgeted policy (defaults to a fresh turn). */
  turn?: ColdBqTurnState;
}

export interface ContractorHistoryByUeiResult {
  uei: string;
  resolution: ContractorHistoryResolution;
  /** Canonical name when identity is known. */
  name: string | null;
  history: ContractorSalesHistory | null;
  source: 'bigquery_normalized' | 'local_registry' | null;
  asOf: string | null;
  aggregates_cover: 'bq_ingest' | null;
  degraded: boolean;
  /** Serving path hint — only states the implementation can prove. */
  cache: 'warm' | 'cold_bq' | 'registry' | 'none';
  detail?: string;
}

function profileCacheKey(uei: string) {
  return `recipient:by-uei:${uei}:v2`;
}

function isDetailIncomplete(history: ContractorSalesHistory): boolean {
  return history.enrichment_status === 'budget_limited' || history.partial === true;
}

function emptyHistory(name: string, asOf: string | null): ContractorSalesHistory {
  return {
    success: true,
    source: 'local_registry',
    coverage: 'none',
    lastUpdated: asOf,
    contractor: {
      company: name,
      slug: slugifyContractorName(name),
      naics: [],
      agencies: [],
      totalContractValue: 0,
      contractCount: 0,
      hasContact: false,
      hasEmail: false,
      hasPhone: false,
    },
    match: { method: 'recipient_name', confidence: 'high', name },
    summary: {
      totalObligations: 0,
      awardCount: 0,
      latestFiscalYear: null,
      topAgency: null,
      averageAwardSize: 0,
    },
    series: [],
    topAgencies: [],
    topNaics: [],
    recentAwards: [],
    gated: { fullHistory: true, contacts: true, workflowActions: true, exports: true },
    enrichment_status: 'complete',
    partial: false,
    message:
      'Registered entity with no awards in the BigQuery warehouse ingest. Totals cover warehouse data, not a live USASpending pull.',
  };
}

function foundFromBq(
  uei: string,
  history: ContractorSalesHistory,
  cache: 'warm' | 'cold_bq',
): ContractorHistoryByUeiResult {
  const awardCount = history.summary?.awardCount ?? history.contractor?.contractCount ?? 0;
  const name = history.contractor?.company || null;
  const incomplete = isDetailIncomplete(history);
  const normalized: ContractorSalesHistory = {
    ...history,
    source: 'bigquery_normalized',
  };
  if (awardCount <= 0) {
    return {
      uei,
      resolution: 'registered_zero',
      name,
      history: { ...normalized, enrichment_status: 'complete', partial: false },
      source: 'bigquery_normalized',
      asOf: history.lastUpdated,
      aggregates_cover: 'bq_ingest',
      degraded: false,
      cache,
      detail: 'BQ profile present with zero warehouse awards',
    };
  }
  return {
    uei,
    resolution: 'found',
    name,
    history: normalized,
    source: 'bigquery_normalized',
    asOf: history.lastUpdated,
    aggregates_cover: 'bq_ingest',
    degraded: incomplete,
    cache,
    detail: incomplete
      ? 'Profile totals available; award/agency/NAICS detail not retrieved (enrichment_status=budget_limited)'
      : undefined,
  };
}

async function tryColdFill(
  policy: ColdBqPolicy,
  actor: string | undefined,
  turn: ColdBqTurnState,
): Promise<'ok' | 'denied'> {
  if (policy === 'never') return 'denied';
  if (policy === 'always') return 'ok';
  // budgeted — require a real actor identity; never a global unlimited fallback
  if (!actor?.trim()) return 'denied';
  const allowed = await allowColdBqLookup(actor, turn);
  return allowed ? 'ok' : 'denied';
}

/**
 * Canonical UEI contractor-history lookup for Map and MCP.
 */
export async function getContractorHistoryByUei(
  opts: GetContractorHistoryByUeiOptions,
): Promise<ContractorHistoryByUeiResult> {
  const uei = String(opts.uei || '').trim().toUpperCase();
  const policy: ColdBqPolicy = opts.coldPolicy ?? 'budgeted';
  const turn = opts.turn ?? { count: 0 };
  const base: Omit<ContractorHistoryByUeiResult, 'resolution'> = {
    uei,
    name: null,
    history: null,
    source: null,
    asOf: null,
    aggregates_cover: null,
    degraded: false,
    cache: 'none',
  };

  if (!uei || !isWellFormedUei(uei)) {
    return { ...base, resolution: 'malformed', detail: 'UEI must be exactly 12 alphanumeric characters' };
  }

  // 1) Warm KV (cacheOnly)
  let warm: ContractorSalesHistory | null = null;
  try {
    warm = await getBqContractorHistory({ uei, liveBq: false });
  } catch (err) {
    console.error('[history-by-uei] warm BQ path failed:', err);
  }

  if (warm?.contractor) {
    // Profile warm but detail caches incomplete → try cold fill; else honest partial.
    if (isDetailIncomplete(warm)) {
      const cold = await tryColdFill(policy, opts.actor, turn);
      if (cold === 'ok') {
        try {
          const live = await getBqContractorHistory({ uei, liveBq: true });
          if (live?.contractor) {
            return foundFromBq(uei, live, 'cold_bq');
          }
        } catch (err) {
          console.error('[history-by-uei] cold detail fill failed:', err);
          // Fall through to honest partial from warm profile totals.
        }
      }
      return foundFromBq(uei, warm, 'warm');
    }
    return foundFromBq(uei, warm, 'warm');
  }

  // After a cacheOnly miss, queryCached marks the profile key unavailable.
  const warmUnknown = bqUnavailable(profileCacheKey(uei), 0);

  // 2) Cold BQ when warm miss was "don't know" OR we still have no answer
  if (warmUnknown || !warm) {
    const cold = await tryColdFill(policy, opts.actor, turn);
    if (cold === 'ok') {
      try {
        const live = await getBqContractorHistory({ uei, liveBq: true });
        if (live?.contractor) {
          return foundFromBq(uei, live, 'cold_bq');
        }
        // Live BQ answered with no profile — fall through to registry
      } catch (err) {
        console.error('[history-by-uei] cold BQ failed:', err);
        return {
          ...base,
          resolution: 'unavailable',
          degraded: true,
          detail: 'BigQuery query failed and no warm history was available',
        };
      }
    } else if (warmUnknown) {
      return {
        ...base,
        resolution: 'unavailable',
        degraded: true,
        detail:
          policy === 'budgeted' && !opts.actor?.trim()
            ? 'Cold BigQuery requires a valid caller identity — warehouse history unavailable'
            : policy === 'budgeted'
            ? 'Cold BigQuery budget exhausted — warehouse history unavailable right now'
            : 'Warm cache miss and cold BigQuery disabled',
      };
    }
  }

  // 3) No BQ profile — local SAM registry distinguishes registered-zero vs unresolved
  const local = await lookupLocalEntityByUEI(uei);
  if (local.status === 'unavailable') {
    return {
      ...base,
      resolution: 'unavailable',
      degraded: true,
      detail: local.detail || 'Local SAM registry could not be checked',
    };
  }
  if (local.status === 'found') {
    const name =
      local.hit.entity.legalBusinessName ||
      local.hit.entity.dbaName ||
      uei;
    const history = emptyHistory(name, local.hit.asOf);
    return {
      uei,
      resolution: 'registered_zero',
      name,
      history,
      source: 'local_registry',
      asOf: local.hit.asOf,
      aggregates_cover: 'bq_ingest',
      degraded: false,
      cache: 'registry',
      detail: 'Active/known SAM registry row with no BigQuery award profile',
    };
  }
  return {
    ...base,
    resolution: 'not_found',
    detail: 'No BigQuery award profile and no local SAM registry row',
  };
}
