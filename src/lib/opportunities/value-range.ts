/**
 * Comparable-award value range for an opportunity — the grounded "price" hook.
 *
 * SAM open-opportunity notices almost never carry a dollar value, so we DERIVE a range from REAL
 * award history. Source = our CACHED 143K-row recompete_opportunities table (synced from
 * USASpending), queried via the opp_value_range Postgres RPC: one instant DB call for the
 * 10th/50th/90th percentile of total_obligation matching the opp's NAICS (+ agency), capped at
 * $500M to drop IDIQ-ceiling outliers. NO live USASpending API → NO rate limit.
 *
 * The 10–90 band is a backtested "likely range": against 225 real awards it covered the ACTUAL
 * award amount ~80% of the time. NO fabrication — every figure is a real obligated amount; under 5
 * comparables → null (card shows nothing). The predecessor's own contract value (find-predecessor)
 * is a stronger anchor and is preferred by the caller when present; this is the broad fallback.
 *
 * postWithBackoff (live USASpending, with retry/backoff) is retained + exported ONLY for the
 * offline backtest harness (which validates the model against live award amounts).
 */

const API_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

/**
 * POST to USASpending with retry + exponential backoff on 429 / 5xx / network errors — USASpending
 * throttles hard, so a bare fetch fails a lot of rows under bulk load. Honors Retry-After when the
 * server sends it. Throws only after all retries are exhausted (the caller treats a throw as
 * "transient — retry later", NOT as "no comparables"). Returns the parsed JSON on success.
 */
export async function postWithBackoff(body: unknown, timeoutMs: number, maxRetries = 4): Promise<Record<string, unknown>> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (resp.ok) return (await resp.json()) as Record<string, unknown>;
      // Retryable server states: 429 (rate limit), 5xx (transient). 4xx (except 429) = a real bad
      // request → don't retry.
      if (resp.status !== 429 && resp.status < 500) throw new Error(`usaspending ${resp.status}`);
      lastErr = new Error(`usaspending ${resp.status}`);
      // Honor Retry-After (seconds) if present; else exponential backoff w/ jitter (0.5s→8s).
      const ra = parseInt(resp.headers.get('retry-after') || '', 10);
      const waitMs = ra > 0 ? ra * 1000 : Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 400);
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, waitMs));
    } catch (e) {
      lastErr = e;
      // Network error / abort — also backoff-retry.
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 400)));
    } finally {
      clearTimeout(to);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('usaspending: retries exhausted');
}

export interface ValueHistogramBucket {
  min: number;
  max: number;
  count: number;
}

export interface ValueRange {
  low: number;        // 25th percentile
  median: number;     // 50th
  high: number;       // 75th percentile
  n: number;          // # of comparable awards the range is built from
  basis: string;      // human label of what was matched (e.g. "541512 at DEPT OF DEFENSE")
  source: 'comparable_awards';
  // Distribution of the SAME comparable-award set (opp_value_histogram RPC) — powers the
  // M-Estimate(TM) chart. Optional: absent when the histogram migration hasn't landed yet, or
  // when the RPC errors/returns nothing (degrades to percentile-only display — never a fake chart).
  distribution?: ValueHistogramBucket[];
}

function normNaics(naics: string | null): string[] {
  if (!naics) return [];
  return [...new Set(
    naics.split(/[,\s]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c.length >= 2 && c.length <= 6),
  )];
}

/**
 * Compute the value range for NAICS (+ agency + sub-agency) from our CACHED award data (143K rows
 * in recompete_opportunities) via the opp_value_range RPC — one instant DB query, NO live
 * USASpending API, NO rate limit. Returns the 25th/50th/75th percentiles of total_obligation
 * (capped $1K–$500M to drop IDIQ ceilings). The 25–75 band (middle 50% of contracts) is a TIGHTER,
 * more useful range than the old 10–90.
 *
 * Progressive narrowing for the TIGHTEST honest band: sub-agency-scoped first (a specific buying
 * command clusters tighter) → agency → NAICS-only. Uses the first level with ≥ MIN_SAMPLE
 * comparables. Returns null when even NAICS-only is thin (never fabricated).
 *
 * ⚠️ ACCURACY CEILING: federal contracts in one NAICS genuinely span millions (Army construction
 * runs $650K … $8M), and our cached data has no PSC / set-aside / dollar-tier to segment further,
 * so a "$100K-accurate" point estimate is NOT achievable from award data alone — the band IS the
 * honest unit. opts.timeoutMs is accepted but unused (kept for the caller's signature).
 */
export async function getComparableAwardRange(
  naics: string | null,
  agency: string | null,
  opts: { psc?: string | null; subAgency?: string | null; timeoutMs?: number } = {},
): Promise<ValueRange | null> {
  const codes = normNaics(naics);
  if (!codes.length) return null; // NAICS is the minimum key
  const MIN_SAMPLE = 8; // slightly higher now — a tight 25-75 band needs enough points to be stable
  const code = codes[0];
  const sub = opts.subAgency ? String(opts.subAgency).trim() : null;

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // Best-effort distribution fetch for the M-Estimate(TM) chart — SAME naics/agency/sub scope as
  // the percentile call that won, so the bars and the median/band always describe the same
  // comparable set. Gracefully degrades to undefined (no chart, percentile display unaffected)
  // when the opp_value_histogram RPC hasn't been migrated yet or errors/returns nothing
  // ([[postgrest_missing_column_nulls]] — a missing function must not null the whole intel call).
  async function fetchDistribution(ag: string | null, sa: string | null): Promise<ValueHistogramBucket[] | undefined> {
    try {
      const { data, error } = await db.rpc('opp_value_histogram', { p_naics: code, p_agency: ag, p_sub: sa, p_buckets: 10 });
      if (error) { console.error('[value-range] opp_value_histogram:', error.message); return undefined; }
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) return undefined;
      return rows.map((r: { bucket_min: number | string; bucket_max: number | string; count: number | string }) => ({
        min: Math.round(Number(r.bucket_min)),
        max: Math.round(Number(r.bucket_max)),
        count: Number(r.count),
      }));
    } catch (e) {
      console.error('[value-range] opp_value_histogram threw:', e);
      return undefined;
    }
  }

  const psc = opts.psc ? String(opts.psc).trim() : null;
  async function run(ag: string | null, sa: string | null, label: string, byPsc = false): Promise<ValueRange | null> {
    // p_psc narrows to the PSC/FSC FAMILY ("what was bought") — the right key for a product buy on a
    // broad NAICS (Eric 2026-08-03: NAICS 541519 IT-services dollars for a radio buy). Only sent when
    // byPsc; the 20260803_value_range_psc migration added p_psc (default NULL, backward compatible).
    const args: Record<string, unknown> = { p_naics: code, p_agency: ag, p_sub: sa };
    if (byPsc && psc) args.p_psc = psc;
    const { data, error } = await db.rpc('opp_value_range', args);
    if (error) {
      // A PSC call that hits the PRE-migration 3-arg RPC errors "no function matches" — that's not a
      // transient failure, it's "PSC not available yet". Degrade to the NAICS tiers (return null),
      // never throw, so the M-Estimate still renders the honest NAICS band until the migration lands.
      if (byPsc) { console.error('[value-range] PSC tier unavailable (pre-migration?):', error.message); return null; }
      throw new Error(`opp_value_range: ${error.message}`); // real transient/DB error → caller retries
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || Number(row.n) < MIN_SAMPLE || row.p50 == null) return null;
    // The chart histogram RPC is NAICS/agency-keyed (no PSC arg) — skip it on the PSC tier so its
    // bars can't disagree with a PSC-scoped band (better no chart than a mismatched one).
    const distribution = byPsc ? undefined : await fetchDistribution(ag, sa);
    return {
      low: Math.round(Number(row.p10)),   // 25th
      median: Math.round(Number(row.p50)),
      high: Math.round(Number(row.p90)),  // 75th
      n: Number(row.n),
      basis: label,
      source: 'comparable_awards',
      ...(distribution ? { distribution } : {}),
    };
  }

  // Progressive narrowing: sub-agency (tightest) → agency → NAICS-only. First with enough data wins.
  //
  // ⚠️ The sub-agency tier matches on SUB-AGENCY ALONE — it does NOT also AND the agency filter.
  // (Eric 2026-08-03: every same-NAICS card showed the identical NAICS-wide median.) The reason:
  // SAM's department string and USASpending's awarding_agency string DISAGREE on format — SAM sends
  // "INTERIOR, DEPARTMENT OF THE", USASpending stores "Department of the Interior" — so the agency
  // ILIKE matches 0 rows. When the sub tier passed BOTH (agency AND sub), that broken agency filter
  // NULLED an otherwise-good sub-agency band (BLM 237990 = $1.76M across 15 real comps) and the whole
  // thing fell through to NAICS-wide ($4.9M) on EVERY Interior/DoD card. The sub-agency name
  // ("Bureau of Land Management") IS specific enough on its own — it identifies the buying command
  // without needing the parent department pinned on top — and it matches cleanly (ILIKE handles the
  // case difference). So: sub tier = sub only. The agency tier below still ANDs nothing new (it was
  // already agency-only) and shares the same string-mismatch weakness, so it mostly no-ops for the
  // mismatched departments and correctly falls to NAICS-only — an honest, wider band, never fabricated.
  // PSC FIRST (Eric 2026-08-03): the PSC/FSC family is "what was bought" — for a product buy on a
  // broad NAICS it's the RIGHT market (radio comps ~$2.1M, not NAICS 541519 IT-services $$). Only
  // when it has enough comparables (MIN_SAMPLE, enforced in run()); otherwise degrade to the NAICS
  // tiers below — an honest wider band beats a thin/absent PSC band, and a pre-migration DB no-ops
  // this tier to null. The label names the PSC so the UI can say what it measured.
  if (psc) { const r = await run(null, null, `${code} · PSC ${psc}`, true); if (r) return r; }
  if (sub) { const r = await run(null, sub, `${code} · ${sub}`); if (r) return r; }
  if (agency) { const r = await run(agency, null, `${code} at ${agency}`); if (r) return r; }
  return run(null, null, code);
}
