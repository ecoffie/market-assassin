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
import { fetchAwardDetail, resolvePiidToId } from '@/lib/usaspending/award-detail';

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

  // ⚠️ contract_id is NOT always the generated_internal_id. For SOME rows it's the full
  // "CONT_AWD_<piid>_…" form the detail endpoint keys on (those 404 → 200 directly); for
  // MANY others it's a RAW PIID (e.g. "FA824018C7218", "DESC0014664"), and the detail
  // endpoint 404s on a raw PIID. This — NOT an IP throttle — is what failed most rows on
  // the burst run. When the id lacks the CONT_AWD_/ASST_ prefix, resolve it to the real
  // generated_internal_id via resolvePiidToId (the shared search-based resolver) first.
  const isGeneratedId = /^(CONT_AWD_|CONT_IDV_|ASST_)/.test(contractId);
  let generatedId = contractId;
  if (!isGeneratedId) {
    const resolved = await resolvePiidToId(contractId).catch(() => null);
    // A PIID that resolves to nothing is a GENUINE miss (award not in USASpending under
    // that PIID) — surface it as an empty result so the caller STAMPS it (don't retry a
    // 404 forever). Only a fetch/network failure below is the retry class.
    if (!resolved) {
      return { psc_code: null, psc_description: null, description: null };
    }
    generatedId = resolved;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s, …
    try {
      const detail = await fetchAwardDetail(generatedId);
      if (detail) {
        return {
          psc_code: stripNul(detail.pscCode),
          psc_description: stripNul(detail.pscDescription),
          description: stripNul(detail.description),
        };
      }
      // null = non-2xx / dropped — retry (the id resolved, so this is transient).
    } catch {
      // network/parse error — retry
    }
  }
  throw new DetailFetchError(contractId);
}
