/**
 * Opportunity Share Attribution — the first-party loop
 *
 *   SHARE → CLICK → SIGNUP → ACTIVATION → PAID
 *
 * Mindy's own events are the source of truth; GA4 is supplemental. Every stage lives in a table
 * that already existed — nothing here creates a second event store:
 *
 *   SHARE   user_engagement  action=listing_share   metadata {share_id, notice_id, kind, method}
 *                            user_email = the sharer (verified email, else their anon:<uuid>)
 *   CLICK   user_engagement  action=map_view / listing_open   metadata {entry:'share', share_id,
 *                            notice_id}, user_email = the visitor's anon:<uuid>
 *   SIGNUP  signup_attribution  one row per account: anon_id + share_id + first_touch, written at
 *                            the account's first verified session (every auth class)
 *   ACTIVATION  user_saved_opportunities / saved_searches / user_pipeline (existing rows)
 *   PAID    purchases_canonical (by account email) + the gca_attr → KV checkout record
 *
 * ── WHY SHARE IDS ARE VALIDATED, NOT TRUSTED ────────────────────────────────
 * `sh` arrives in a URL anyone can type. A share id only attributes an arrival when the
 * EARLIEST listing_share carrying that id (a) exists, (b) names the same notice the arrival
 * opened, (c) happened before the arrival, and (d) was not made by the arriving browser itself.
 * Earliest-wins means a forged later listing_share reusing a real id cannot take it over, and a
 * random or malformed id simply never resolves. The browser's `entry` label is a claim; this
 * module is where the claim is checked.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SHARE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ANON_RE = /^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isShareId(v: unknown): v is string {
  return typeof v === 'string' && SHARE_ID_RE.test(v);
}
export function isAnonId(v: unknown): v is string {
  return typeof v === 'string' && ANON_RE.test(v.trim());
}

/** Share methods the Map can record. Anything else is dropped rather than stored. */
export const SHARE_METHODS = ['clipboard', 'native', 'prompt'] as const;

/**
 * Normalise share fields on an incoming engagement event BEFORE it is stored.
 * A malformed share id is removed (never stored), and an arrival that claimed `entry:'share'`
 * without a well-formed id is relabelled `share_invalid` — so a mangled or typed-in `sh` can
 * never be counted as share traffic, even before the funnel query validates real ids.
 */
export function sanitizeShareMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const m = { ...metadata };
  if ('share_id' in m) {
    const raw = typeof m.share_id === 'string' ? m.share_id.trim().toLowerCase() : '';
    if (isShareId(raw)) m.share_id = raw;
    else { delete m.share_id; m.share_id_invalid = true; }
  }
  if (m.entry === 'share' && !isShareId(m.share_id)) m.entry = 'share_invalid';
  if (m.action === 'listing_share') {
    if (typeof m.method === 'string' && !(SHARE_METHODS as readonly string[]).includes(m.method)) delete m.method;
  }
  return m;
}

export interface ShareArrival {
  shareId: string;
  noticeId: string;
  sharer: string;          // verified email or anon:<uuid> of whoever shared
  shareAt: string;
  arrivalAt: string;
  kind: string | null;
  method: string | null;
}

type EngagementRow = { user_email: string; created_at: string; metadata: Record<string, unknown> | null };

/**
 * The first VALID share arrival for one anonymous browser, or null.
 * `before` bounds the search (an arrival after the account existed did not acquire it).
 */
export async function resolveFirstShareArrival(
  db: SupabaseClient,
  anonId: string,
  opts: { before?: string } = {},
): Promise<{ ok: true; arrival: ShareArrival | null } | { ok: false; error: string }> {
  let q = db
    .from('user_engagement')
    .select('user_email, created_at, metadata')
    .eq('user_email', anonId)
    .eq('event_source', 'opportunity_map')
    .eq('metadata->>entry', 'share')
    .order('created_at', { ascending: true })
    .limit(50);
  if (opts.before) q = q.lte('created_at', opts.before);
  const { data: arrivals, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (arrivals ?? []) as EngagementRow[];
  const candidates = rows.filter((r) => isShareId(r.metadata?.share_id));
  if (candidates.length === 0) return { ok: true, arrival: null };

  const ids = [...new Set(candidates.map((r) => String(r.metadata!.share_id)))].slice(0, 50);
  const { data: shares, error: shareErr } = await db
    .from('user_engagement')
    .select('user_email, created_at, metadata')
    .eq('event_source', 'opportunity_map')
    .eq('metadata->>action', 'listing_share')
    .in('metadata->>share_id', ids)
    .order('created_at', { ascending: true })
    .limit(500);
  if (shareErr) return { ok: false, error: shareErr.message };

  // Earliest listing_share per id is canonical (a forged later copy cannot take it over).
  const canonical = new Map<string, EngagementRow>();
  for (const s of (shares ?? []) as EngagementRow[]) {
    const id = String(s.metadata?.share_id || '');
    if (id && !canonical.has(id)) canonical.set(id, s);
  }

  for (const a of candidates) {
    const id = String(a.metadata!.share_id);
    const s = canonical.get(id);
    if (!s) continue;                                                       // unknown / fake id
    const shareNotice = String(s.metadata?.notice_id || '');
    const arrivalNotice = String(a.metadata?.notice_id || '');
    if (!shareNotice || shareNotice !== arrivalNotice) continue;            // id lifted onto another notice
    if (Date.parse(s.created_at) > Date.parse(a.created_at)) continue;      // arrival cannot precede the share
    if (s.user_email === anonId) continue;                                  // opening your own link is not acquisition
    return {
      ok: true,
      arrival: {
        shareId: id,
        noticeId: shareNotice,
        sharer: s.user_email,
        shareAt: s.created_at,
        arrivalAt: a.created_at,
        kind: typeof s.metadata?.kind === 'string' ? s.metadata.kind : null,
        method: typeof s.metadata?.method === 'string' ? s.metadata.method : null,
      },
    };
  }
  return { ok: true, arrival: null };
}

/** Keys kept from a client first-touch object — the gca_attr touch shape plus the Map's fields. */
const TOUCH_KEYS = [
  'url', 'path', 'referrer', 'captured_at',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'msclkid',
  'entry', 'share_id', 'notice_id', 'anon_id',
] as const;

export function sanitizeTouch(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of TOUCH_KEYS) {
    const v = t[k];
    if (typeof v === 'string' && v) out[k] = v.slice(0, 300);
  }
  // A share id inside a client touch is a claim like any other: shape-checked here, and only
  // ever promoted to signup_attribution.share_id through resolveFirstShareArrival.
  if (out.share_id && !isShareId(out.share_id)) delete out.share_id;
  return Object.keys(out).length ? out : null;
}

export interface ClaimInput {
  anonId: string;
  verifiedEmail: string;
  /** When the account was created. Null = unknown → the claim does not assert acquisition. */
  accountCreatedAt: string | null;
  /** Client gca_attribution first_touch (optional; server history is authoritative for shares). */
  clientFirstTouch?: unknown;
  now?: () => Date;
}

export type ClaimResult =
  | { ok: true; status: 'claimed' | 'already_claimed' | 'existing_account' | 'no_history'; shareId?: string | null }
  | { ok: false; error: string };

/**
 * Associate one anonymous browser's acquisition history with the account that just
 * authenticated in it. Same contract as claimAnonShortlist / claimAnonWatch: the email is the
 * VERIFIED session's, never the request body's; the write is proven, never assumed.
 *
 * Semantics:
 *  · Joined, never rewritten — anonymous user_engagement rows keep their anon id. The link is
 *    signup_attribution.anon_id, so a browser that never signs up stays anonymous.
 *  · Acquisition only — the claim applies when the account was created AFTER this browser's
 *    first recorded visit. An existing user signing in on a browser that happened to arrive
 *    through a share is not a share signup.
 *  · First claim wins — an account whose row already carries an anon_id is never re-attributed
 *    by a later browser, device or share (first touch stays stable).
 */
export async function claimAnonAttribution(db: SupabaseClient, input: ClaimInput): Promise<ClaimResult> {
  const anonId = input.anonId?.trim().toLowerCase();
  const email = input.verifiedEmail?.trim().toLowerCase();
  if (!isAnonId(anonId)) return { ok: false, error: 'invalid anon id' };
  if (!email || !email.includes('@') || isAnonId(email)) return { ok: false, error: 'a verified account email is required' };

  // The browser's first recorded visit — the server's own clock, not the client's.
  const { data: firstRows, error: firstErr } = await db
    .from('user_engagement')
    .select('created_at, metadata')
    .eq('user_email', anonId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (firstErr) return { ok: false, error: firstErr.message };
  const first = (firstRows ?? [])[0] as { created_at: string; metadata: Record<string, unknown> | null } | undefined;
  if (!first) return { ok: true, status: 'no_history' };

  if (!input.accountCreatedAt) return { ok: true, status: 'existing_account' };
  if (Date.parse(input.accountCreatedAt) < Date.parse(first.created_at)) {
    return { ok: true, status: 'existing_account' };
  }

  const { data: existing, error: exErr } = await db
    .from('signup_attribution')
    .select('id, anon_id, created_at')
    .ilike('email', email)
    .order('created_at', { ascending: true })
    .limit(20);
  if (exErr) return { ok: false, error: exErr.message };
  const rows = (existing ?? []) as { id: number; anon_id: string | null; created_at: string }[];
  if (rows.some((r) => r.anon_id)) return { ok: true, status: 'already_claimed' };

  const resolved = await resolveFirstShareArrival(db, anonId, { before: input.accountCreatedAt });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const arrival = resolved.arrival;

  const clientTouch = sanitizeTouch(input.clientFirstTouch);
  const firstTouch: Record<string, string> = clientTouch ?? {
    captured_at: first.created_at,
    entry: typeof first.metadata?.entry === 'string' ? first.metadata.entry : 'direct',
  };
  firstTouch.anon_id = anonId;
  const ftParsed = firstTouch.captured_at ? Date.parse(firstTouch.captured_at) : NaN;
  const firstTouchAt = Number.isFinite(ftParsed) && ftParsed <= Date.parse(first.created_at) + 60_000
    ? new Date(ftParsed).toISOString()
    : first.created_at;                                   // never later than the server saw them

  const fields = {
    anon_id: anonId,
    share_id: arrival?.shareId ?? null,
    entry: arrival ? 'share' : (firstTouch.entry || null),
    first_touch: firstTouch,
    first_touch_at: firstTouchAt,
    claimed_at: (input.now?.() ?? new Date()).toISOString(),
  };

  if (rows.length > 0) {
    // mi-signup (email path) already wrote the account's row — enrich it, never add a second.
    const target = rows[0];
    const { count, error } = await db
      .from('signup_attribution')
      .update(fields, { count: 'exact' })
      .eq('id', target.id)
      .is('anon_id', null);
    if (error) return { ok: false, error: error.message };
    if (count == null) return { ok: false, error: 'update count unknown' };
    if (count === 0) return { ok: true, status: 'already_claimed' };   // a concurrent claim won
    return { ok: true, status: 'claimed', shareId: fields.share_id };
  }

  // OAuth (Google/Microsoft) and any other class that never passed through mi-signup: the row
  // did not exist. This closes the hole where those signups carried no attribution at all.
  const src = arrival ? 'share' : (firstTouch.utm_source || firstTouch.entry || null);
  const { error: insErr } = await db.from('signup_attribution').insert({
    email,
    source: src,
    utm_source: firstTouch.utm_source ?? (arrival ? 'share' : null),
    utm_medium: firstTouch.utm_medium ?? (arrival ? 'share' : null),
    utm_campaign: firstTouch.utm_campaign ?? null,
    utm_content: firstTouch.utm_content ?? null,
    referrer: firstTouch.referrer ?? null,
    ...fields,
  });
  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true, status: 'claimed', shareId: fields.share_id };
}
