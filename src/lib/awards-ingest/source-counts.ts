/**
 * USASpending source counts — contracts + IDV transactions by action_date month, the same grain the
 * warehouse holds. ONE implementation, shared by the A1 acceptance script and the production
 * completeness gate (moved here from scripts/bq-awards-a1-acceptance.ts, unchanged).
 *
 * `null` = the source could not be measured. Never 0: an unreachable API is not an empty month.
 */
export const USASPENDING_SEARCH = 'https://api.usaspending.gov/api/v2/search';

const DOD_TOPTIER = [{ type: 'awarding', tier: 'toptier', name: 'Department of Defense' }];

export function monthEndIso(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** POST with retries; throws after the last attempt (callers turn that into `null`). */
export async function usaspendingPost<T>(path: string, body: unknown, fetchImpl: FetchLike = fetch as unknown as FetchLike, attempts = 4, backoffMs = 2000): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetchImpl(`${USASPENDING_SEARCH}/${path}/`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.ok) return (await r.json()) as T;
    } catch { /* retry */ }
    if (i < attempts - 1) await new Promise((s) => setTimeout(s, backoffMs * (i + 1)));
  }
  throw new Error(`USASpending ${path} failed after ${attempts} attempts`);
}

/** Contracts + IDVs dated in `month`; `dodOnly` = awarding toptier Department of Defense. */
export async function sourceTxnCount(month: string, dodOnly: boolean, fetchImpl?: FetchLike, backoffMs?: number): Promise<number> {
  const filters: Record<string, unknown> = {
    time_period: [{ start_date: `${month}-01`, end_date: monthEndIso(month), date_type: 'action_date' }],
  };
  if (dodOnly) filters.agencies = DOD_TOPTIER;
  const r = await usaspendingPost<{ results: { contracts: number; idvs: number } }>(
    'spending_by_transaction_count', { filters }, fetchImpl, 4, backoffMs);
  const n = Number(r?.results?.contracts) + Number(r?.results?.idvs);
  if (!Number.isFinite(n) || n < 0) throw new Error(`USASpending spending_by_transaction_count returned no count for ${month}`);
  return n;
}

/** DoD and civilian (= all − DoD) source counts for one month; `null` per cohort when unmeasured. */
export async function sourceCohortCounts(month: string, fetchImpl?: FetchLike, backoffMs?: number): Promise<{ dod: number | null; civilian: number | null }> {
  const [all, dod] = await Promise.all([
    sourceTxnCount(month, false, fetchImpl, backoffMs).catch(() => null),
    sourceTxnCount(month, true, fetchImpl, backoffMs).catch(() => null),
  ]);
  return { dod, civilian: all === null || dod === null ? null : all - dod };
}
