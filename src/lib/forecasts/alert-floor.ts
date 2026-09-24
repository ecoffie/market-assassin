/**
 * Forecast PUBLISHER ALERT FLOORS — the explicit boundary that keeps historical onboarding out of alerts.
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md
 *
 * Key: agency_forecasts.source_agency, a code in FORECAST_SOURCE_AGENCY_CODES — the same canonical publisher
 * identity Discovery resolves buyers to. A row is alertable only if its publisher has an ACTIVE floor and
 * created_at > alertable_after. No floor, or 'suspended' → never alertable (fail closed).
 *
 * Who may move a floor:
 *   - an operator seeding floors at cutover (scripts/forecast-publisher-floor.ts --seed),
 *   - an onboarding/backfill job through runPublisherBackfill() — suspend first, activate at the load's
 *     last created_at only after it succeeds (a failed load stays suspended: no burst, no silent reopen).
 * The ordinary daily sync NEVER calls this module (pinned by alert-floor.unit.test.ts): a routine sync
 * inserts genuinely new rows that must stay alertable, and re-stamps old rows without changing created_at.
 *
 * Floors never move BACKWARD without `allowRewind` — a rewind would expose historical rows as "new".
 */
import { FORECAST_SOURCE_AGENCY_CODES } from './agency-identity';

export type FloorState = 'active' | 'suspended';
export type FloorRow = { source_agency: string; state: FloorState; alertable_after: string | null; reason?: string; set_by?: string };
export type FloorChange =
  | { kind: 'seed'; source_agency: string; alertable_after: string; reason: string; set_by: string }
  | { kind: 'suspend'; source_agency: string; reason: string; set_by: string }
  | { kind: 'activate'; source_agency: string; alertable_after: string; reason: string; set_by: string; allowRewind?: boolean };

export type FloorDecision =
  | { ok: true; next: FloorRow; noop: boolean }
  | { ok: false; error: string };

const KNOWN = new Set<string>(FORECAST_SOURCE_AGENCY_CODES as readonly string[]);
const t = (s: string) => new Date(s).getTime();

/** Pure: what a floor change would do. Validates identity, reason, monotonicity. */
export function decideFloorChange(prev: FloorRow | null, change: FloorChange): FloorDecision {
  if (!KNOWN.has(change.source_agency)) return { ok: false, error: `unknown publisher code "${change.source_agency}" — not in the canonical Discovery vocabulary` };
  if (!change.reason?.trim()) return { ok: false, error: 'a reason is required' };
  if (!change.set_by?.trim()) return { ok: false, error: 'set_by is required' };
  if (change.kind === 'seed') {
    if (prev) return { ok: true, next: prev, noop: true }; // seeding never overwrites an existing floor
    if (Number.isNaN(t(change.alertable_after))) return { ok: false, error: 'alertable_after is not a timestamp' };
    return { ok: true, noop: false, next: { source_agency: change.source_agency, state: 'active', alertable_after: new Date(change.alertable_after).toISOString(), reason: change.reason, set_by: change.set_by } };
  }
  if (change.kind === 'suspend') {
    if (prev?.state === 'suspended') return { ok: true, next: prev, noop: true };
    return { ok: true, noop: false, next: { source_agency: change.source_agency, state: 'suspended', alertable_after: prev?.alertable_after ?? null, reason: change.reason, set_by: change.set_by } };
  }
  if (Number.isNaN(t(change.alertable_after))) return { ok: false, error: 'alertable_after is not a timestamp' };
  if (prev?.alertable_after && t(change.alertable_after) < t(prev.alertable_after) && !change.allowRewind) {
    return { ok: false, error: `floor would move backward (${prev.alertable_after} → ${change.alertable_after}); that exposes historical rows as new — pass allowRewind with a reason` };
  }
  const next: FloorRow = { source_agency: change.source_agency, state: 'active', alertable_after: new Date(change.alertable_after).toISOString(), reason: change.reason, set_by: change.set_by };
  const noop = prev?.state === 'active' && prev.alertable_after != null && t(prev.alertable_after) === t(next.alertable_after!);
  return { ok: true, next, noop };
}

/** Write one floor change + its log row. `dryRun` returns the decision without writing. */
export async function applyFloorChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, change: FloorChange, opts: { dryRun: boolean },
): Promise<FloorDecision & { wrote?: boolean }> {
  const { data: prev, error: pe } = await db.from('forecast_publisher_alert_floor')
    .select('source_agency, state, alertable_after').eq('source_agency', change.source_agency).limit(1).maybeSingle();
  if (pe) return { ok: false, error: `read floor: ${pe.message}` };
  const d = decideFloorChange((prev as FloorRow | null) ?? null, change);
  if (!d.ok || d.noop || opts.dryRun) return { ...d, wrote: false };
  const { error: we } = await db.from('forecast_publisher_alert_floor')
    .upsert({ ...d.next, updated_at: new Date().toISOString() }, { onConflict: 'source_agency' });
  if (we) return { ok: false, error: `write floor: ${we.message}` };
  const { error: le } = await db.from('forecast_publisher_alert_floor_log').insert({
    source_agency: change.source_agency,
    prev_state: prev?.state ?? null, prev_alertable_after: prev?.alertable_after ?? null,
    new_state: d.next.state, new_alertable_after: d.next.alertable_after,
    reason: change.reason, set_by: change.set_by,
  });
  if (le) return { ok: false, error: `write floor log: ${le.message}` };
  return { ...d, wrote: true };
}

/** The last created_at held for a publisher (the boundary a completed load establishes). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function publisherLastCreatedAt(db: any, source: string): Promise<{ at: string | null } | { error: string }> {
  const { data, error } = await db.from('agency_forecasts').select('created_at').eq('source_agency', source)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return { error: error.message };
  return { at: (data?.created_at as string | undefined) ?? null };
}

/**
 * Run a historical onboarding / backfill for ONE publisher without turning its rows into alerts:
 *   suspend → load() → floor = the publisher's last created_at → active.
 * If load() throws, the floor stays SUSPENDED (fail closed) and the error propagates.
 */
export async function runPublisherBackfill<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, source: string, reason: string, setBy: string, load: () => Promise<T>,
): Promise<T> {
  const s = await applyFloorChange(db, { kind: 'suspend', source_agency: source, reason: `backfill start: ${reason}`, set_by: setBy }, { dryRun: false });
  if (!s.ok) throw new Error(`cannot suspend ${source}: ${s.error}`);
  const result = await load();
  const last = await publisherLastCreatedAt(db, source);
  if ('error' in last) throw new Error(`backfill for ${source} loaded but floor NOT activated (stays suspended): ${last.error}`);
  if (!last.at) throw new Error(`backfill for ${source} loaded 0 rows — floor stays suspended`);
  const a = await applyFloorChange(db, { kind: 'activate', source_agency: source, alertable_after: last.at, reason: `backfill complete: ${reason}`, set_by: setBy }, { dryRun: false });
  if (!a.ok) throw new Error(`backfill for ${source} loaded but floor NOT activated (stays suspended): ${a.error}`);
  return result;
}
