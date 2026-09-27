/**
 * R0 — auth-method OBSERVABILITY (behaviour-neutral).
 *
 * Source of truth: tasks/mindy-entitlement-audit-2026-09-26.md §12 E1/E6, §14 R0.
 *
 * Before R1 removes the two weak authorization methods from verifyUserOwnsEmail
 * (Method 3: a plaintext `ma_access_email` cookie; Method 4: any claimed staff
 * email with no proof) we need to know WHO legitimately relies on them. Nothing
 * recorded that. This module records it — and does nothing else.
 *
 * Contract (each clause is pinned by auth-observability.unit.test.ts):
 *   1. It NEVER changes an auth decision or a response. Callers hand it a result
 *      that was already computed; it only reads.
 *   2. It NEVER throws and NEVER awaits the database in the request path. The
 *      write is scheduled with next/server `after()` (runs once the response is
 *      sent); outside a request scope it falls back to a detached promise.
 *   3. Volume is bounded by construction: one DAILY AGGREGATE row per
 *      (day, probe, route, method, verified_identity_present, claimed_matches_identity),
 *      incremented atomically by an RPC. Per-email rows exist only for the weak
 *      methods (cookie, staff_claim), unauthenticated Pro-gate calls and the
 *      federal-contacts usage class — deduped per (day, probe, route, method, email)
 *      and capped per day inside the RPC.
 *   4. Kill switch: AUTH_OBSERVE=off disables every write.
 */
import { after, type NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { verifyTwoFactorSessionToken } from '@/lib/two-factor-session';

// ─── vocabulary ────────────────────────────────────────────────────────────

/** Which verifyUserOwnsEmail method produced the result. */
export type AuthMethod =
  | 'supabase'
  | 'signed_link'
  | 'mi_session'
  | 'cookie'
  | 'staff_claim'
  | 'none';

/** What wrote the observation. */
export type ObservationProbe =
  | 'verify_user_owns_email'   // every verifyUserOwnsEmail call
  | 'pro_gate'                 // a Pro route that reads tier off a claimed email
  | 'federal_contacts_usage';  // E6: listing vs roster/bulk usage class

/** 'yes' | 'no' | 'n/a' — text, because NULL can't sit in a primary key. */
export type Tri = 'yes' | 'no' | 'n/a';

export interface AuthObservation {
  probe: ObservationProbe;
  route: string;
  /** AuthMethod for identity probes; the usage class for federal_contacts_usage. */
  method: string;
  verifiedIdentityPresent: Tri;
  claimedMatchesIdentity: Tri;
  /** Recorded ONLY when shouldRecordEmail() says so. */
  email: string | null;
}

export const WEAK_METHODS: ReadonlySet<string> = new Set(['cookie', 'staff_claim']);
const STRONG_METHODS: ReadonlySet<string> = new Set(['supabase', 'signed_link', 'mi_session']);

// ─── pure helpers (unit-tested) ────────────────────────────────────────────

const ID_SEGMENT = /^(?:[0-9]+|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|.*[@.%].*|[A-Za-z0-9_-]{24,})$/i;

/**
 * A pathname with record-id segments collapsed to `:id`, so a dynamic route
 * (`/api/app/chat-sessions/<uuid>`) is ONE aggregate key, not one per record.
 * Capped at 120 chars.
 */
export function normalizeRoute(pathname: string | null | undefined): string {
  if (!pathname) return 'unknown';
  const clean = pathname.split('?')[0];
  const out = clean
    .split('/')
    .map((seg) => (seg && ID_SEGMENT.test(seg) ? ':id' : seg))
    .join('/');
  return out.slice(0, 120) || '/';
}

/**
 * Classify a verifyUserOwnsEmail result into the method that produced it.
 * Reads the already-computed result; never re-decides.
 *
 * - `method:'token'`                    → signed_link
 * - `method:'session'` with an `aal` key → supabase (only verifyUserSession sets it)
 * - `method:'session'` without           → mi_session (the 2FA/MI HMAC header)
 * - `method:'cookie'` and the cookie equals the claimed email → cookie (Method 3)
 * - `method:'cookie'` otherwise           → staff_claim (Method 4 — no cookie, just a staff address)
 */
export function classifyVerifyResult(
  result: { authenticated: boolean; method?: string } & Record<string, unknown>,
  cookieEmail: string | null | undefined,
  normalizedClaim: string | null | undefined,
): AuthMethod {
  if (!result.authenticated) return 'none';
  if (result.method === 'token') return 'signed_link';
  if (result.method === 'session') return 'aal' in result ? 'supabase' : 'mi_session';
  if (result.method === 'cookie') {
    const c = cookieEmail?.toLowerCase();
    return c && normalizedClaim && c === normalizedClaim ? 'cookie' : 'staff_claim';
  }
  return 'none';
}

/** The aggregate row for one verifyUserOwnsEmail call. */
export function buildVerifyObservation(
  route: string,
  method: AuthMethod,
  result: { authenticated: boolean; error?: string },
  normalizedClaim: string | null,
): AuthObservation {
  const strong = STRONG_METHODS.has(method);
  // A Supabase session for a DIFFERENT email is a verified identity that did not match.
  const mismatch = !result.authenticated && result.error === 'Email mismatch with session';
  const verified: Tri = strong || mismatch ? 'yes' : 'no';
  const matches: Tri = strong ? 'yes' : mismatch ? 'no' : 'n/a';
  return {
    probe: 'verify_user_owns_email',
    route,
    method,
    verifiedIdentityPresent: verified,
    claimedMatchesIdentity: matches,
    email: shouldRecordEmail('verify_user_owns_email', method, verified) ? normalizedClaim : null,
  };
}

/**
 * The only place that decides whether a claimed email is stored.
 * - weak authorization (cookie, staff_claim): yes — the point is to find who depends on it
 * - an unauthenticated Pro-gate call carrying a claimed email: yes
 * - federal-contacts usage (already MI-session verified): yes — E6 wants per-user class
 * - everything else (strong-auth verifyUserOwnsEmail calls, failures): no
 */
export function shouldRecordEmail(probe: ObservationProbe, method: string, verified: Tri): boolean {
  if (probe === 'verify_user_owns_email') return WEAK_METHODS.has(method);
  if (probe === 'pro_gate') return verified === 'no';
  if (probe === 'federal_contacts_usage') return true;
  return false;
}

/**
 * E6 usage class for /api/app/federal-contacts, from its query string alone.
 *   facet          — dropdown facets (agencies / offices / subagencies)
 *   roster_index   — office-roster index for an agency (list of offices with rosters)
 *   roster_office  — office-roster for one named office (the full people list)
 *   listing        — a single-opportunity/office lookup (dodaac, or limit ≤ 10)
 *   browse         — a normal page (limit ≤ 50, first page)
 *   bulk           — limit > 50, or paging past the first page
 */
export function classifyFederalContactsUsage(sp: URLSearchParams): string {
  const facets = sp.get('facets');
  if (facets === 'office-roster') return sp.get('office') ? 'roster_office' : 'roster_index';
  if (facets) return 'facet';
  const limit = Math.min(Number(sp.get('limit')) || 50, 200);
  const offset = Number(sp.get('offset')) || 0;
  if (limit > 50 || offset > 0) return 'bulk';
  if (sp.get('dodaac') || limit <= 10) return 'listing';
  return 'browse';
}

/** UTC calendar day, YYYY-MM-DD. */
export function observationDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ─── sink (fire-and-forget) ────────────────────────────────────────────────

function observeEnabled(): boolean {
  const v = (process.env.AUTH_OBSERVE || '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false');
}

let _warned = false;
function warnOnce(msg: string, err?: unknown) {
  if (_warned) return;
  _warned = true;
  try {
    console.warn(`[auth-observe] ${msg}`, err instanceof Error ? err.message : err ?? '');
  } catch { /* never throw */ }
}

/** Test seam: replaces the RPC writer. */
type Writer = (o: AuthObservation, day: string) => Promise<void>;
let _writer: Writer | null = null;
export function __setObservationWriterForTests(w: Writer | null) { _writer = w; _warned = false; }

async function defaultWriter(o: AuthObservation, day: string): Promise<void> {
  const { getWriteClient } = await import('@/lib/supabase/server-clients');
  const sb = getWriteClient();
  const { error } = await sb.rpc('record_auth_observation', {
    p_day: day,
    p_probe: o.probe,
    p_route: o.route,
    p_method: o.method,
    p_verified: o.verifiedIdentityPresent,
    p_matches: o.claimedMatchesIdentity,
    p_email: o.email,
  });
  if (error) throw new Error(error.message);
}

/** Run `work` after the response; never throws, never blocks. */
function schedule(work: () => Promise<void>): void {
  const safe = async () => {
    try { await work(); } catch (e) { warnOnce('write failed (ignored)', e); }
  };
  try {
    after(safe);
  } catch {
    // Outside a request scope (scripts, tests): detached, still never throws.
    try { queueMicrotask(() => { void safe(); }); } catch { /* ignore */ }
  }
}

/** Record one observation. Synchronous, void, never throws. */
export function recordAuthObservation(o: AuthObservation): void {
  try {
    if (!observeEnabled()) return;
    const day = observationDay();
    const w = _writer ?? defaultWriter;
    schedule(() => w(o, day));
  } catch (e) {
    warnOnce('schedule failed (ignored)', e);
  }
}

/** Called by verifyUserOwnsEmail with its already-computed result. Never throws. */
export function observeVerifyResult(
  request: NextRequest,
  claimedEmail: string | null | undefined,
  result: { authenticated: boolean; method?: string; error?: string } & Record<string, unknown>,
): void {
  try {
    const normalized = claimedEmail?.toLowerCase() || null;
    const cookieEmail = request.cookies?.get?.('ma_access_email')?.value ?? null;
    const method = classifyVerifyResult(result, cookieEmail, normalized);
    const route = normalizeRoute(request.nextUrl?.pathname);
    recordAuthObservation(buildVerifyObservation(route, method, result, normalized));
  } catch (e) {
    warnOnce('observeVerifyResult failed (ignored)', e);
  }
}

// ─── Pro-gate identity probe ───────────────────────────────────────────────

interface IdentityInputs {
  miToken: string | null;
  bearer: string | null;
  linkToken: string | null;
  linkTs: string | null;
  cookieEmail: string | null;
}

/**
 * Resolve which verified identity (if any) a request carries, WITHOUT a claimed
 * email to lean on. Runs inside after(), never in the request path.
 */
export async function resolveVerifiedIdentity(
  inputs: IdentityInputs,
  claimed: string | null,
  deps: {
    verifyMi?: (t: string) => { valid: boolean; email?: string };
    supabaseEmail?: (jwt: string) => Promise<string | null>;
  } = {},
): Promise<{ method: AuthMethod; email: string | null }> {
  const verifyMi =
    deps.verifyMi ?? ((t: string) => verifyTwoFactorSessionToken(t) as { valid: boolean; email?: string });
  for (const t of [inputs.miToken, inputs.bearer]) {
    if (!t) continue;
    const r = verifyMi(t);
    if (r.valid && r.email) return { method: 'mi_session', email: r.email.toLowerCase() };
  }
  if (inputs.bearer) {
    const get = deps.supabaseEmail ?? defaultSupabaseEmail;
    const e = await get(inputs.bearer).catch(() => null);
    if (e) return { method: 'supabase', email: e.toLowerCase() };
  }
  if (claimed && inputs.linkToken && inputs.linkTs && verifySignedLink(claimed, inputs.linkToken, inputs.linkTs)) {
    return { method: 'signed_link', email: claimed };
  }
  if (claimed && inputs.cookieEmail && inputs.cookieEmail.toLowerCase() === claimed) {
    return { method: 'cookie', email: null };
  }
  return { method: 'none', email: null };
}

function verifySignedLink(email: string, token: string, ts: string): boolean {
  const secret = process.env.EMAIL_ACTION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) return false;
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.floor(Date.now() / 1000) - tsNum > 7 * 24 * 60 * 60) return false;
  const expected = createHmac('sha256', secret).update(`${email}:${ts}`).digest('hex').substring(0, 32);
  return expected === token;
}

async function defaultSupabaseEmail(jwt: string): Promise<string | null> {
  const { getWriteClient } = await import('@/lib/supabase/server-clients');
  const { data, error } = await getWriteClient().auth.getUser(jwt);
  if (error) return null;
  return data?.user?.email ?? null;
}

/** Build the pro_gate observation from a resolved identity. Pure. */
export function buildProGateObservation(
  route: string,
  claimed: string | null,
  identity: { method: AuthMethod; email: string | null },
): AuthObservation {
  const verified: Tri = STRONG_METHODS.has(identity.method) ? 'yes' : 'no';
  const matches: Tri = !claimed ? 'n/a' : verified === 'yes' ? (identity.email === claimed ? 'yes' : 'no') : 'n/a';
  return {
    probe: 'pro_gate',
    route,
    method: identity.method,
    verifiedIdentityPresent: verified,
    claimedMatchesIdentity: matches,
    email: claimed && shouldRecordEmail('pro_gate', identity.method, verified) ? claimed : null,
  };
}

/**
 * Pro-gate probe: record whether a request that reads tier off a claimed email
 * carried ANY verified identity, and whether the claim matched it. The header
 * reads are synchronous and cheap; the verification (incl. a Supabase getUser
 * round-trip for a Bearer JWT) happens after the response. Never throws.
 */
export function observeProGateIdentity(request: NextRequest, claimedEmail: string | null | undefined): void {
  try {
    if (!observeEnabled()) return;
    const claimed = (claimedEmail || '').trim().toLowerCase() || null;
    const auth = request.headers.get('authorization');
    const inputs: IdentityInputs = {
      miToken: request.headers.get('x-mi-auth-token') || request.headers.get('x-mi-2fa-token'),
      bearer: auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null,
      linkToken: request.nextUrl?.searchParams.get('token') ?? null,
      linkTs: request.nextUrl?.searchParams.get('ts') ?? null,
      cookieEmail: request.cookies?.get?.('ma_access_email')?.value ?? null,
    };
    const route = normalizeRoute(request.nextUrl?.pathname);
    const day = observationDay();
    const w = _writer ?? defaultWriter;
    schedule(async () => {
      const identity = await resolveVerifiedIdentity(inputs, claimed);
      await w(buildProGateObservation(route, claimed, identity), day);
    });
  } catch (e) {
    warnOnce('observeProGateIdentity failed (ignored)', e);
  }
}

/** E6: record the federal-contacts usage class for an already-verified user. Never throws. */
export function observeFederalContactsUsage(request: NextRequest, verifiedEmail: string | null | undefined): void {
  try {
    const cls = classifyFederalContactsUsage(request.nextUrl.searchParams);
    recordAuthObservation({
      probe: 'federal_contacts_usage',
      route: normalizeRoute(request.nextUrl.pathname),
      method: cls,
      verifiedIdentityPresent: 'yes',
      claimedMatchesIdentity: 'yes',
      email: (verifiedEmail || '').toLowerCase() || null,
    });
  } catch (e) {
    warnOnce('observeFederalContactsUsage failed (ignored)', e);
  }
}
