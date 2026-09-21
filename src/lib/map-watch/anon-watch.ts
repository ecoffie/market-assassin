/**
 * Anonymous map watches — let the 96% keep something.
 *
 * ── THE MEASURED PROBLEM ───────────────────────────────────────────────────
 * Measured on production over 30 days:
 *   · 8,583 distinct users touched the Opportunity Map
 *   · only 329 of them were SIGNED IN — 8,254 (96%) were anonymous
 *   · 41 users have EVER created a saved search (0.5% of monthly map users)
 *   · 87% of all users visit on exactly ONE day and never return
 *
 * The Map already has a perfectly good "Save search" button. It is unreachable
 * for 96% of the traffic: it demands a signed-in session AND a `window.prompt`
 * asking the user to NAME something before they get any value — at the exact
 * moment of intent.
 *
 * Anonymous visitors already carry a STABLE `anon:<uuid>` identity in
 * `user_engagement` (measured: individual anon ids recur across 2–5 distinct
 * days; 147 returned on more than one day). That identity is enough to let them
 * keep a market without an account.
 *
 * ── THE DESIGN ─────────────────────────────────────────────────────────────
 * Reuse `saved_searches` exactly as it is. No migration: `user_email` is plain
 * TEXT with no FK or CHECK, so an `anon:<uuid>` owner stores natively.
 *
 * ⚠️ `saved_searches.alerts_enabled` DEFAULTS TO TRUE. An anon row must set it
 * FALSE explicitly, or the alert cron (`.eq('alerts_enabled', true)`) would try
 * to email an address that is not an address. Alerts turn on only when a real
 * email is attached, which is also the moment the watch becomes a habit loop.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** `anon:` + a uuid, as emitted by the map's telemetry identity. */
const ANON_RE = /^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAnonId(v: string | null | undefined): boolean {
  return !!v && ANON_RE.test(v.trim());
}

/** Owner key for a watch: a verified email, else a well-formed anon id. */
export function watchOwner(email: string | null, anonId: string | null): string | null {
  const e = email?.trim().toLowerCase();
  if (e && e.includes('@')) return e;
  const a = anonId?.trim().toLowerCase();
  return isAnonId(a) ? a! : null;
}

export interface MapWatchInput {
  owner: string;
  mode?: string;
  filters?: Record<string, unknown>;
  bbox?: Record<string, number> | null;
  /** Caller-supplied label; a readable one is derived when absent. */
  name?: string | null;
}

/**
 * A name the user never had to type.
 *
 * The old flow blocked on `window.prompt` for a name. Naming a thing you have
 * not seen yet is work, and it happened before any value was delivered — so the
 * default is derived from what the user is already looking at, and stays
 * editable afterwards.
 */
export function deriveWatchName(
  filters: Record<string, unknown> | undefined,
  mode: string | undefined,
): string {
  const f = filters ?? {};
  const parts: string[] = [];
  const pick = (k: string) => (typeof f[k] === 'string' && f[k] ? String(f[k]) : null);

  const q = pick('q');
  const naics = pick('naics');
  const agency = pick('agency') ?? pick('subAgency') ?? pick('department');
  const state = pick('state');
  const setAside = pick('setAside');

  if (q) parts.push(q);
  if (naics) parts.push(`NAICS ${naics}`);
  if (agency) parts.push(agency);
  if (setAside && setAside !== 'all') parts.push(setAside);
  if (state && state !== 'all') parts.push(state);

  const label = parts.length > 0 ? parts.join(' · ') : 'Everything on this map';
  const scope = mode && mode !== 'open' ? ` (${mode})` : '';
  return `${label}${scope}`.slice(0, 80);
}

export interface SaveWatchResult {
  ok: boolean;
  id?: string;
  name?: string;
  /** TRUE only when a real email owns the row — anon watches never alert. */
  alertsEnabled: boolean;
  error?: string;
}

/**
 * Persist a watch. Anonymous rows are stored with `alerts_enabled = false`.
 */
export async function saveMapWatch(
  db: SupabaseClient,
  input: MapWatchInput,
): Promise<SaveWatchResult> {
  const anon = isAnonId(input.owner);
  const name = (input.name?.trim() || deriveWatchName(input.filters, input.mode)).slice(0, 80);
  const row = {
    user_email: input.owner,
    name,
    mode: input.mode || 'open',
    filters: input.filters ?? {},
    bbox: input.bbox ?? null,
    // ⚠️ The column DEFAULTS to true. Never let an anon row inherit that.
    alerts_enabled: !anon,
  };
  const { data, error } = await db.from('saved_searches').insert(row).select('id,name').single();
  if (error) return { ok: false, alertsEnabled: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id, name, alertsEnabled: !anon };
}

/**
 * Attach a VERIFIED account to an anonymous watch — the upgrade moment.
 *
 * ⚠️ SECURITY: `verifiedEmail` MUST come from a validated MI session, never from
 * a request body. The first version of this function accepted an arbitrary email
 * and enabled alerts on it, which let any holder of an anon uuid point alert
 * email at a victim's address. That is an email-abuse path, and the fix is that
 * the caller cannot supply the address at all — the server derives it from the
 * signed session.
 *
 * This is still the ONLY path that turns alerts on, so a watch cannot start
 * emailing anyone who did not verify that they own the mailbox. Scoped to the
 * anon id that owns the row, so one visitor cannot claim another's watch.
 */
export async function claimAnonWatch(
  db: SupabaseClient,
  anonId: string,
  verifiedEmail: string,
): Promise<{ ok: boolean; claimed: number; error?: string }> {
  if (!isAnonId(anonId)) return { ok: false, claimed: 0, error: 'invalid anon id' };
  const e = verifiedEmail.trim().toLowerCase();
  if (!e.includes('@')) return { ok: false, claimed: 0, error: 'invalid email' };
  // Defence in depth: an anon id must never become an "account".
  if (isAnonId(e)) return { ok: false, claimed: 0, error: 'anon id is not an account' };

  // ⚠️ Never count a RETURNING payload as the write total. `UPDATE … .select()`
  // updates every matching row but RETURNS at most 1,000, so `data.length` would
  // silently under-report. `{ count: 'exact' }` reports the real number, and a
  // NULL count is UNKNOWN — never coerced to 0 (Bug Prevention Rule #11).
  const { count, error } = await db
    .from('saved_searches')
    .update(
      { user_email: e, alerts_enabled: true, updated_at: new Date().toISOString() },
      { count: 'exact' },
    )
    .eq('user_email', anonId.trim().toLowerCase());
  if (error) return { ok: false, claimed: 0, error: error.message };
  if (count == null) {
    return { ok: false, claimed: 0, error: 'claim count returned NULL — unknown, not zero' };
  }
  return { ok: true, claimed: count };
}

/** Most watches one anonymous identity may hold. Bounds unauthenticated writes. */
export const MAX_ANON_WATCHES = 25;

/** Largest accepted serialized filter payload, in bytes. */
export const MAX_FILTER_BYTES = 4096;

export interface PayloadCheck { ok: boolean; error?: string }

/**
 * Validate an anonymous watch payload before it reaches the database.
 *
 * An unauthenticated endpoint must not accept an unbounded blob: `filters` is
 * stored as jsonb and read back by the alert cron, so an oversized or
 * deeply-nested object is both a storage and a processing cost.
 */
export function checkWatchPayload(
  filters: unknown,
  bbox: unknown,
  name: unknown,
): PayloadCheck {
  if (filters != null && (typeof filters !== 'object' || Array.isArray(filters))) {
    return { ok: false, error: 'filters must be an object' };
  }
  if (bbox != null && (typeof bbox !== 'object' || Array.isArray(bbox))) {
    return { ok: false, error: 'bbox must be an object' };
  }
  if (name != null && typeof name !== 'string') {
    return { ok: false, error: 'name must be a string' };
  }
  if (typeof name === 'string' && name.length > 200) {
    return { ok: false, error: 'name too long' };
  }
  try {
    const size = JSON.stringify({ filters: filters ?? {}, bbox: bbox ?? null }).length;
    if (size > MAX_FILTER_BYTES) return { ok: false, error: 'payload too large' };
  } catch {
    return { ok: false, error: 'payload not serializable' };
  }
  return { ok: true };
}

/** How many watches this anonymous identity already holds. */
export async function countAnonWatches(
  db: SupabaseClient,
  anonId: string,
): Promise<number | null> {
  const { count, error } = await db
    .from('saved_searches')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', anonId.trim().toLowerCase());
  // A null/errored count is UNKNOWN. Callers must treat it as "cannot verify the
  // cap" and refuse, never as zero.
  if (error || count == null) return null;
  return count;
}
