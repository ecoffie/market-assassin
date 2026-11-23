/**
 * Measurement + judgement for the alert throughput check (route.ts).
 *
 * UNKNOWN IS NEVER ZERO. A failed alert_log count used to return 0, so a database blip read as
 * "zero sends": it either fired a false regression WARNING (recent window = 0) or, inside the
 * baseline, silently dragged the mean down and could hide a real drop. A count that could not be
 * read is now `null`; any null in a type's recent window or baseline makes that type `unknown`
 * (with the error), and no ratio or regression verdict is computed from partial data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AlertType = 'daily' | 'weekly' | 'pursuit';

export type CountClient = Pick<SupabaseClient, 'from'>;

export type CountResult = { count: number; error: null } | { count: null; error: string };

export async function distinctSentCount(client: CountClient, alertType: AlertType, date: string): Promise<CountResult> {
  // alert_log has a UNIQUE (user_email, alert_date, alert_type) constraint, so for a
  // given type+date there is at most one row per user → count(*) == distinct users.
  // Use a HEAD count so PostgREST returns the EXACT total (via Content-Range) instead
  // of its default 1000-row page cap. The old fetch-and-dedupe silently undercounted a
  // busy day (daily ~1468 read as 1000) and could hide a partial drop (1500→1050 both
  // capping at 1000 = "100%").
  try {
    const { count, error } = await client
      .from('alert_log')
      .select('*', { count: 'exact', head: true })
      .eq('alert_type', alertType)
      .eq('alert_date', date)
      .eq('delivery_status', 'sent');
    if (error) return { count: null, error: `${alertType} ${date}: ${error.message}` };
    // A HEAD count with no error but no count is still not a measurement.
    if (typeof count !== 'number') return { count: null, error: `${alertType} ${date}: count not returned` };
    return { count, error: null };
  } catch (e) {
    return { count: null, error: `${alertType} ${date}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type WindowResult = { total: number | null; errors: string[] };

/**
 * Sum of distinct-per-day sends over the `days`-long window ending `startOffset` days
 * before `now` (startOffset=1 → the window ends yesterday). For a weekly cron whose
 * sends land on one day, a trailing 7-day window always contains exactly one send day,
 * so the sum tracks the weekly volume regardless of which weekday "yesterday" is.
 * Any unreadable day makes the whole window unknown (`total: null`).
 */
export async function windowSum(
  client: CountClient,
  alertType: AlertType,
  now: Date,
  startOffset: number,
  days: number,
): Promise<WindowResult> {
  let total = 0;
  const errors: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (startOffset + i));
    const r = await distinctSentCount(client, alertType, d.toISOString().slice(0, 10));
    if (r.error !== null) errors.push(r.error);
    else total += r.count;
  }
  return { total: errors.length ? null : total, errors };
}

export type ThroughputStatus = 'healthy' | 'warning' | 'no-baseline' | 'unknown';

export type Verdict = {
  status: ThroughputStatus;
  /** null when status is 'unknown' — a ratio over partial data would be fabricated. */
  ratio: number | null;
  baselineMean: number | null;
};

export function judgeThroughput(input: {
  recent: number | null;
  baselineCounts: (number | null)[];
  dropThreshold: number;
  minBaseline: number;
}): Verdict {
  const { recent, baselineCounts, dropThreshold, minBaseline } = input;
  if (recent === null || baselineCounts.length === 0 || baselineCounts.some((c) => c === null)) {
    return { status: 'unknown', ratio: null, baselineMean: null };
  }
  const counts = baselineCounts as number[];
  const baselineMean = counts.reduce((a, b) => a + b, 0) / counts.length;
  let status: ThroughputStatus = 'healthy';
  if (baselineMean < minBaseline) status = 'no-baseline';
  else if (recent < baselineMean * dropThreshold) status = 'warning';
  return { status, ratio: baselineMean > 0 ? +(recent / baselineMean).toFixed(2) : 0, baselineMean };
}
