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

export interface ValueRange {
  low: number;        // 25th percentile
  median: number;     // 50th
  high: number;       // 75th percentile
  n: number;          // # of comparable awards the range is built from
  basis: string;      // human label of what was matched (e.g. "541512 at DEPT OF DEFENSE")
  source: 'comparable_awards';
}

function normNaics(naics: string | null): string[] {
  if (!naics) return [];
  return [...new Set(
    naics.split(/[,\s]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c.length >= 2 && c.length <= 6),
  )];
}

/**
 * Compute the value range for NAICS (+ agency) from our CACHED award data (143K rows in
 * recompete_opportunities) via the opp_value_range RPC — one instant DB query, NO live
 * USASpending API, NO rate limit. The RPC returns 10th/50th/90th percentiles of total_obligation
 * (capped at $500M to drop IDIQ ceilings). The 10–90 band is the backtested "likely range" (~80%
 * coverage). Tries agency-scoped first, falls back to NAICS-only if thin. Returns null when < 5
 * comparables (never fabricated). No fetch/timeout — the opts.timeoutMs param is accepted but
 * unused (kept for the caller's signature).
 */
export async function getComparableAwardRange(
  naics: string | null,
  agency: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  opts: { psc?: string | null; timeoutMs?: number } = {},
): Promise<ValueRange | null> {
  const codes = normNaics(naics);
  if (!codes.length) return null; // NAICS is the minimum key
  const MIN_SAMPLE = 5;
  // Use the first (primary) code for the range query.
  const code = codes[0];

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  async function run(ag: string | null): Promise<ValueRange | null> {
    const { data, error } = await db.rpc('opp_value_range', { p_naics: code, p_agency: ag });
    if (error) throw new Error(`opp_value_range: ${error.message}`); // transient/DB error → caller retries
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || Number(row.n) < MIN_SAMPLE || row.p50 == null) return null;
    return {
      low: Math.round(Number(row.p10)),
      median: Math.round(Number(row.p50)),
      high: Math.round(Number(row.p90)),
      n: Number(row.n),
      basis: `${code}${ag ? ` at ${ag}` : ''}`,
      source: 'comparable_awards',
    };
  }

  // Agency-scoped first (more specific); fall back to NAICS-only if too thin.
  const scoped = await run(agency || null);
  if (scoped) return scoped;
  if (agency) return run(null);
  return null;
}
