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
import { alertableScope } from '@/lib/saved-searches/alert-scope';
import type { SavedSearchMode } from '@/lib/saved-searches/constants';
import type { SupabaseClient } from '@supabase/supabase-js';
import { valueShapeError, savedSearchNaicsError } from '@/lib/saved-searches/validate-filters';

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
 * Attach this browser's anonymous watches to a VERIFIED account.
 *
 * ⚠️ SECURITY: `verifiedEmail` MUST come from a validated MI session, never from a request body
 * (the first version enabled alerts on an arbitrary body email — an email-abuse path).
 *
 * OWNERSHIP PROOF = the browser's `anon:<uuid>` (localStorage `mindy_anon_id`, mirrored to the
 * first-party `mindy_anon` cookie). It is minted with crypto.randomUUID and never shown in a URL
 * another person sees. A WATCH ID ALONE CANNOT CLAIM ANYTHING: rows move only where
 * `user_email = <that anon id>`.
 *
 * Rules (option A, Eric 2026-10-10):
 *   · Claiming NEVER subscribes anyone. Watches move with `alerts_enabled = false`, filters untouched.
 *   · Alerts turn on only for `enableAlertsFor` — the ONE watch the user explicitly opted into — and
 *     only when that watch is now owned by `verifiedEmail` (an owner settings change, like PATCH).
 *     Its scope is narrowed to what email can deliver (alertableScope); recompete-only stays off.
 *   · IDEMPOTENT: a moved row is no longer anonymous, so a repeat claim (another sign-in, a retry)
 *     finds nothing to move. A watch already OWNED by any account can never be transferred, because
 *     only `anon:` rows are ever matched — switching accounts cannot move it.
 *   · NO DUPLICATES: an anonymous watch identical (mode + filters) to one the account already holds
 *     is left where it is and counted as `alreadyOnAccount`.
 *   · Never bulk-claims history: only the caller's own anon id is ever read.
 */
export interface ClaimResult {
  ok: boolean;
  /** Watches moved onto the account in THIS call (alerts off). */
  claimed: number;
  /** Anonymous watches skipped because the account already holds an identical one. */
  alreadyOnAccount: number;
  /** Watches whose alerts were turned on by this call (0 or 1 — only an explicit opt-in). */
  alertsOn: number;
  /** The opted-in watch could not be emailed (recompete only), so its alerts stay off. */
  notEmailable: number;
  /** The opted-in watch had recompete removed from its alert scope (not emailable). */
  comingBackExcluded: number;
  error?: string;
}

function watchKey(mode: unknown, filters: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify([String(mode || 'open'), sortDeep(filters ?? {})]);
}

export async function claimAnonWatch(
  db: SupabaseClient,
  anonId: string,
  verifiedEmail: string,
  opts: { enableAlertsFor?: string | null } = {},
): Promise<ClaimResult> {
  const zero = { claimed: 0, alreadyOnAccount: 0, alertsOn: 0, notEmailable: 0, comingBackExcluded: 0 };
  const fail = (error: string): ClaimResult => ({ ok: false, ...zero, error });
  if (!isAnonId(anonId)) return fail('invalid anon id');
  const e = verifiedEmail.trim().toLowerCase();
  if (!e.includes('@')) return fail('invalid email');
  // Defence in depth: an anon id must never become an "account".
  if (isAnonId(e)) return fail('anon id is not an account');
  const owner = anonId.trim().toLowerCase();

  const { data: anonRows, error: readErr } = await db
    .from('saved_searches').select('id,mode,filters').eq('user_email', owner);
  if (readErr) return fail(readErr.message);
  const pending = (anonRows || []) as Array<{ id: string; mode: string; filters: Record<string, unknown> | null }>;

  let claimed = 0;
  let alreadyOnAccount = 0;
  if (pending.length) {
    const { data: mine, error: mineErr } = await db
      .from('saved_searches').select('mode,filters').eq('user_email', e);
    if (mineErr) return fail(mineErr.message);
    const held = new Set(((mine || []) as Array<{ mode: string; filters: unknown }>).map((r) => watchKey(r.mode, r.filters)));
    const move = pending.filter((r) => !held.has(watchKey(r.mode, r.filters))).map((r) => r.id);
    alreadyOnAccount = pending.length - move.length;
    if (move.length) {
      // ⚠️ Never count a capped RETURNING payload; a NULL count is UNKNOWN, never 0 (Rule #11).
      const { count, error } = await db
        .from('saved_searches')
        .update({ user_email: e, alerts_enabled: false, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('user_email', owner)
        .in('id', move);
      if (error) return fail(error.message);
      if (count == null) return fail('claim count returned NULL — unknown, not zero');
      claimed = count;
    }
  }

  // The explicit opt-in — the only way alerts turn on, and only for a watch this account now owns.
  let alertsOn = 0;
  let notEmailable = 0;
  let comingBackExcluded = 0;
  const optIn = typeof opts.enableAlertsFor === 'string' ? opts.enableAlertsFor.trim() : '';
  if (optIn) {
    const { data: row, error } = await db
      .from('saved_searches').select('id,mode,filters,user_email').eq('id', optIn).eq('user_email', e).maybeSingle();
    if (error) return { ok: false, claimed, alreadyOnAccount, alertsOn, notEmailable, comingBackExcluded, error: error.message };
    if (row) {
      const r = row as { id: string; mode: string; filters: Record<string, unknown> | null };
      const plan = alertableScope((r.mode || 'open') as SavedSearchMode, r.filters || {});
      if (plan.kind === 'none') notEmailable = 1;
      else {
        const patch: Record<string, unknown> = { alerts_enabled: true, updated_at: new Date().toISOString() };
        if (plan.kind === 'partial') { patch.filters = plan.filters; comingBackExcluded = 1; }
        const { error: upErr } = await db.from('saved_searches').update(patch).eq('id', r.id).eq('user_email', e);
        if (upErr) return { ok: false, claimed, alreadyOnAccount, alertsOn, notEmailable, comingBackExcluded, error: upErr.message };
        alertsOn = 1;
      }
    }
  }
  return { ok: true, claimed, alreadyOnAccount, alertsOn, notEmailable, comingBackExcluded };
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
  // Every value the alert cron will parse must be a shape it can read. A verified owner's watch alerts
  // immediately, and claimAnonWatch turns an anon row into an alerting one without re-reading it — so the
  // check belongs here, at the only insert. (2026-10-01: `sapBuyer: true` broke a search for 4 days.)
  if (filters != null) {
    const valueErr = valueShapeError(filters as Record<string, unknown>)
      ?? savedSearchNaicsError(filters as Record<string, unknown>);
    if (valueErr) return { ok: false, error: valueErr };
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
