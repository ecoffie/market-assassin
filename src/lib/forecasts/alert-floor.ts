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
 *   - an onboarding/backfill job through runPublisherBackfill() — suspend (verified) → load → reconcile, and it
 *     STOPS suspended with a proposed floor; activation is a separate explicit act (scripts/forecast-publisher-floor.ts).
 * The database floor guard (writer.ts) refuses any other path that tries to CREATE rows while the floor is active.
 * The ordinary daily sync NEVER calls this module (pinned by alert-floor.unit.test.ts): a routine sync
 * inserts genuinely new rows that must stay alertable, and re-stamps old rows without changing created_at.
 *
 * Floors never move BACKWARD without `allowRewind` — a rewind would expose historical rows as "new".
 */
import { FORECAST_SOURCE_AGENCY_CODES } from './agency-identity';
import { isTimestamp, tsMicros } from '@/lib/saved-searches/forecast-watermark';

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

/** Pure: what a floor change would do. Validates identity, reason, monotonicity. */
export function decideFloorChange(prev: FloorRow | null, change: FloorChange): FloorDecision {
  if (!KNOWN.has(change.source_agency)) return { ok: false, error: `unknown publisher code "${change.source_agency}" — not in the canonical Discovery vocabulary` };
  if (!change.reason?.trim()) return { ok: false, error: 'a reason is required' };
  if (!change.set_by?.trim()) return { ok: false, error: 'set_by is required' };
  if (change.kind === 'seed') {
    if (prev) return { ok: true, next: prev, noop: true }; // seeding never overwrites an existing floor
    if (!isTimestamp(change.alertable_after)) return { ok: false, error: 'alertable_after is not a timestamp' };
    return { ok: true, noop: false, next: { source_agency: change.source_agency, state: 'active', alertable_after: change.alertable_after, reason: change.reason, set_by: change.set_by } };
  }
  if (change.kind === 'suspend') {
    if (prev?.state === 'suspended') return { ok: true, next: prev, noop: true };
    return { ok: true, noop: false, next: { source_agency: change.source_agency, state: 'suspended', alertable_after: prev?.alertable_after ?? null, reason: change.reason, set_by: change.set_by } };
  }
  if (!isTimestamp(change.alertable_after)) return { ok: false, error: 'alertable_after is not a timestamp' };
  if (prev?.alertable_after && tsMicros(change.alertable_after) < tsMicros(prev.alertable_after) && !change.allowRewind) {
    return { ok: false, error: `floor would move backward (${prev.alertable_after} → ${change.alertable_after}); that exposes historical rows as new — pass allowRewind with a reason` };
  }
  // Stored exactly as given (microsecond precision). Rounding through Date would put the row created AT the
  // boundary on the alertable side of its own floor.
  const next: FloorRow = { source_agency: change.source_agency, state: 'active', alertable_after: change.alertable_after, reason: change.reason, set_by: change.set_by };
  const noop = prev?.state === 'active' && prev.alertable_after != null && tsMicros(prev.alertable_after) === tsMicros(next.alertable_after!);
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
 * The ONLY sanctioned path for a historical onboarding / backfill of ONE publisher:
 *
 *   suspend (verified) → load → reconcile → STOP, still suspended, with a PROPOSED floor
 *
 * It never re-activates the publisher. Activation is a separate explicit act after the load has been reviewed:
 *   scripts/forecast-publisher-floor.ts --activate <CODE> --after <proposedFloor> --reason "…" --go
 * While suspended the publisher sends no alerts, and the database floor guard lets the load create rows.
 * A throw from load() or a failed reconcile leaves it suspended and propagates — no burst, no silent reopen.
 */
export async function runPublisherBackfill<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, source: string, reason: string, setBy: string,
  load: () => Promise<T>,
  reconcile: (result: T) => Promise<{ ok: boolean; detail?: string }>,
): Promise<{ result: T; state: 'suspended_awaiting_activation'; proposedFloor: string }> {
  const s = await applyFloorChange(db, { kind: 'suspend', source_agency: source, reason: `backfill start: ${reason}`, set_by: setBy }, { dryRun: false });
  if (!s.ok) throw new Error(`cannot suspend ${source}: ${s.error}`);
  // Verify, never assume: a load must not start against an active floor.
  const { data: now, error: re } = await db.from('forecast_publisher_alert_floor').select('state').eq('source_agency', source).limit(1).maybeSingle();
  if (re || now?.state !== 'suspended') throw new Error(`${source} is not suspended (${re?.message ?? now?.state ?? 'no row'}) — refusing to load`);
  const result = await load();
  const rec = await reconcile(result);
  if (!rec.ok) throw new Error(`backfill for ${source} did not reconcile (stays suspended): ${rec.detail ?? 'no detail'}`);
  const last = await publisherLastCreatedAt(db, source);
  if ('error' in last) throw new Error(`backfill for ${source} reconciled but its boundary could not be read (stays suspended): ${last.error}`);
  if (!last.at) throw new Error(`backfill for ${source} holds 0 rows — stays suspended`);
  return { result, state: 'suspended_awaiting_activation', proposedFloor: last.at };
}
