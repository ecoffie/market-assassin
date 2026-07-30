/**
 * Recompete detail enrichment — the shared per-row logic for filling
 * recompete_opportunities.psc_code / psc_description / description from USASpending's
 * award-DETAIL endpoint. Used by BOTH the one-time local drain
 * (scripts/backfill-recompete-detail.ts) AND the steady-state cron
 * (/api/cron/enrich-recompete-detail), so the fetch + field extraction never drift.
 *
 * WHY this exists at all: the recompete sync's source (spending_by_award SEARCH) returns
 * "Product or Service Code" / "Award Description" NULL even when requested — the DETAIL
 * endpoint (/api/v2/awards/<id>/) has them. Our contract_id column IS the
 * generated_internal_id that endpoint keys on. naics_description is already derived for
 * free at query time (query.ts + /api/recompete); this fills the two the code can't derive.
 *
 * ⚠️ THROTTLE (measured 2026-07-30): a short concurrency-5 burst is fine, but ~1000
 * SUSTAINED requests throttle our IP (RemoteDisconnected). So callers MUST pace: the cron
 * does a SMALL batch per tick (throttle never trips), the local drain runs serial + delay
 * + retry. resolveDetailFields retries a dropped connection (transient) before giving up.
 *
 * ⚠️ FAIL-LOUD: a transient fetch failure THROWS (DetailFetchError) — the caller leaves the
 * row's detail_checked_at NULL so a later tick/run retries it. A SUCCESSFUL fetch that
 * returned empty fields is stamped (honest empty; often the fields ARE present). An errored
 * fetch must NEVER be stamped as done — that permanently skips a row that has data.
 */
import { fetchAwardDetail } from '@/lib/usaspending/award-detail';

export interface RecompeteDetailFields {
  psc_code: string | null;
  psc_description: string | null;
  description: string | null;
}

/** Transient fetch failure (dropped connection / 5xx / null) — retry, do NOT stamp. */
export class DetailFetchError extends Error {
  constructor(public contractId: string) {
    super(`detail fetch failed for ${contractId} — transient, leave row NULL for retry`);
    this.name = 'DetailFetchError';
  }
}

/** Postgres rejects NUL in text columns — strip it from FPDS free text before writing. */
export function stripNul(s: string | null | undefined): string | null {
  if (s == null) return null;
  const cleaned = s.replace(/\x00/g, '').trim();
  return cleaned.length ? cleaned : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the three detail fields for one contract_id, with retry-and-backoff on a
 * transient drop (the same id usually succeeds after a pause under the IP throttle).
 * Throws DetailFetchError after `maxRetries` exhausted.
 */
export async function resolveRecompeteDetail(
  contractId: string,
  opts: { maxRetries?: number } = {},
): Promise<RecompeteDetailFields> {
  const maxRetries = opts.maxRetries ?? 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s, …
    try {
      const detail = await fetchAwardDetail(contractId);
      if (detail) {
        return {
          psc_code: stripNul(detail.pscCode),
          psc_description: stripNul(detail.pscDescription),
          description: stripNul(detail.description),
        };
      }
      // null = non-2xx / dropped — retry (the id is valid; the sync wrote this row).
    } catch {
      // network/parse error — retry
    }
  }
  throw new DetailFetchError(contractId);
}
