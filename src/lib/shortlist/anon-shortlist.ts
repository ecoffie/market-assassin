/**
 * Anonymous opportunity shortlist.
 *
 * ── THE MEASURED PROBLEM ───────────────────────────────────────────────────
 * Opportunity Map funnel, production, 30 days (distinct users):
 *   cards_shown 8,460 → map_view 7,307 → listing_open 2,021 → pursuit_started 53
 *
 * 2,021 people opened a listing and 53 kept it (2.6%). The listing already
 * explains WHY. `savePursuit` called `requireSignIn`, and 96% of map users
 * (8,254 of 8,583) are not signed in — a PERMISSION failure, not a
 * comprehension one.
 *
 * ── WHY ITS OWN TABLE ──────────────────────────────────────────────────────
 * The first draft stored these in `user_pipeline`. An audit of all 63 consumers
 * found SIX that read it globally with no user_email filter — including
 * `cron/pursuit-changes`, which emails `owner_email || user_email`. An
 * `anon:<uuid>` row would have entered that scan. A shortlist is not a pursuit,
 * so it lives in `anonymous_shortlist` and cannot be mistaken for one.
 *
 * ── WHY THE CLIENT SENDS ONLY A NOTICE ID ──────────────────────────────────
 * The browser must not be able to invent opportunity metadata that later becomes
 * a real pursuit. It sends `noticeId` and nothing else; title/agency/NAICS/
 * deadline are resolved from `sam_opportunities`. The table enforces this with a
 * FOREIGN KEY (a fabricated id fails 23503) and a CHECK that the owner is an
 * `anon:` id (an email owner fails 23514) — both verified against the real
 * database.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const ANON_RE = /^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAnonId(v: string | null | undefined): boolean {
  return !!v && ANON_RE.test(v.trim());
}

/** Most listings one anonymous identity may hold. */
export const MAX_ANON_SHORTLIST = 50;

export interface ShortlistResult {
  ok: boolean;
  saved: boolean;
  /** Already on the shortlist — the user repeating themselves, not a failure. */
  duplicate: boolean;
  error?: string;
}

/**
 * Save a listing. The notice must EXIST — checked explicitly for a clear error,
 * and enforced again by the table's foreign key.
 */
export async function addToAnonShortlist(
  db: SupabaseClient,
  anonId: string,
  noticeId: string,
): Promise<ShortlistResult> {
  const owner = anonId?.trim().toLowerCase();
  if (!isAnonId(owner)) return { ok: false, saved: false, duplicate: false, error: 'invalid anon id' };
  const notice = noticeId?.trim();
  if (!notice || notice.length > 128) {
    return { ok: false, saved: false, duplicate: false, error: 'noticeId is required' };
  }

  // Canonical existence check. A missing notice is a client error, not a 500.
  const { data: real, error: lookupErr } = await db
    .from('sam_opportunities')
    // unranged-ok: single row by primary key.
    .select('notice_id')
    .eq('notice_id', notice)
    .maybeSingle();
  if (lookupErr) return { ok: false, saved: false, duplicate: false, error: lookupErr.message };
  if (!real) return { ok: false, saved: false, duplicate: false, error: 'unknown noticeId' };

  const { error } = await db
    .from('anonymous_shortlist')
    .insert({ owner_anon_id: owner, notice_id: notice });

  if (error) {
    // 23505 = UNIQUE(owner_anon_id, notice_id).
    if (error.code === '23505') return { ok: true, saved: false, duplicate: true };
    return { ok: false, saved: false, duplicate: false, error: error.message };
  }
  return { ok: true, saved: true, duplicate: false };
}

/** How many listings this anonymous identity holds. NULL means UNKNOWN. */
export async function countAnonShortlist(
  db: SupabaseClient,
  anonId: string,
): Promise<number | null> {
  const { count, error } = await db
    .from('anonymous_shortlist')
    .select('id', { count: 'exact', head: true })
    .eq('owner_anon_id', anonId.trim().toLowerCase())
    .is('claimed_at', null);
  if (error || count == null) return null;
  return count;
}

/** The notice ids this anonymous identity holds — powers the "✓ Saved" restore. */
export async function listAnonShortlist(
  db: SupabaseClient,
  anonId: string,
): Promise<string[] | null> {
  const { data, error } = await db
    .from('anonymous_shortlist')
    .select('notice_id')
    .eq('owner_anon_id', anonId.trim().toLowerCase())
    .is('claimed_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_ANON_SHORTLIST);
  if (error) return null;
  return (data ?? []).map((r) => (r as { notice_id: string }).notice_id);
}

/**
 * The notice ids a VERIFIED ACCOUNT has saved.
 *
 * A save that was claimed is STILL A SAVE. Reading it back is what makes
 * "✓ Saved" survive signing in — without this, a claim would look to the user
 * like their saves vanished at the moment they created an account, which is the
 * opposite of the behaviour this feature exists to produce.
 */
export async function listAccountShortlist(
  db: SupabaseClient,
  verifiedEmail: string,
): Promise<string[] | null> {
  const email = verifiedEmail?.trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const { data, error } = await db
    .from('anonymous_shortlist')
    .select('notice_id')
    .eq('claimed_by', email)
    .not('claimed_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_ANON_SHORTLIST);
  if (error) return null;
  // One account can carry saves from several browsers, so dedupe on read.
  return Array.from(new Set((data ?? []).map((r) => (r as { notice_id: string }).notice_id)));
}

export interface ClaimResult {
  ok: boolean;
  /** Saved listings transferred to the verified account. STILL saves. */
  attached: number;
  /** Rows that could not be transferred this time. Left for retry. */
  failed: number;
  error?: string;
}

/** The verified account a claim attaches saves to. */
export interface ClaimContext {
  /** From a validated MI session. NEVER from a request body. */
  verifiedEmail: string;
}

/**
 * Attach an anonymous shortlist to a VERIFIED account.
 *
 * ⚠️ `ctx.verifiedEmail` MUST come from a validated MI session. An earlier
 * version accepted an arbitrary email from the request body, which let one
 * client write into another user's space.
 *
 * ── A SAVE IS NOT A PURSUIT ────────────────────────────────────────────────
 * RETURNING IS THE CONVERSION. A saved listing belongs to the DISCOVERY loop;
 * a pursuit belongs to the EXECUTION loop. Signing in is not a statement of
 * intent to bid, so claiming a shortlist transfers the SAVES and nothing more.
 *
 * This function therefore creates NO pursuits. It does not read or write
 * `user_pipeline` at all. A `user_pipeline` row is created only by an explicit
 * Start Pursuit, through `createCanonicalPursuit` — still the one pursuit
 * creation contract, unchanged and used by `/api/pipeline`.
 *
 * The previous version promoted every claimed listing into a pursuit
 * automatically, which manufactured execution intent the visitor never
 * expressed and would have made the feature measurable only by
 * `pursuit_started` — the wrong metric for a discovery-loop feature.
 *
 * ── WHAT "ATTACHED" MEANS ──────────────────────────────────────────────────
 * The row keeps its `owner_anon_id` (the table's CHECK requires an `anon:`
 * shape) and records the account in `claimed_by`. `listAccountShortlist` reads
 * it back, so the save survives sign-in and still renders "✓ Saved".
 */
export async function claimAnonShortlist(
  db: SupabaseClient,
  anonId: string,
  ctx: ClaimContext,
): Promise<ClaimResult> {
  const owner = anonId?.trim().toLowerCase();
  const email = ctx.verifiedEmail?.trim().toLowerCase();
  if (!isAnonId(owner)) return { ok: false, attached: 0, failed: 0, error: 'invalid anon id' };
  if (!email || !email.includes('@') || isAnonId(email)) {
    return { ok: false, attached: 0, failed: 0, error: 'a verified account email is required' };
  }

  const { data: rows, error: readErr } = await db
    .from('anonymous_shortlist')
    .select('id,notice_id')
    .eq('owner_anon_id', owner)
    .is('claimed_at', null)
    .limit(MAX_ANON_SHORTLIST);
  if (readErr) return { ok: false, attached: 0, failed: 0, error: readErr.message };
  const shortlist = (rows ?? []) as { id: string; notice_id: string }[];
  if (shortlist.length === 0) return { ok: true, attached: 0, failed: 0 };

  let attached = 0;
  let failed = 0;

  for (const row of shortlist) {
    // ⚠️ The write is PROVEN, not assumed. An earlier version logged the error
    // and counted the row as transferred anyway, so "the row is still
    // unclaimed" and "we reported success" were simultaneously true. Scoped to
    // this id, owned by THIS anon identity, and still unclaimed; counted
    // exactly. Error, NULL count and zero-affected are never read as success.
    const { count, error } = await db
      .from('anonymous_shortlist')
      .update(
        { claimed_at: new Date().toISOString(), claimed_by: email },
        { count: 'exact' },
      )
      .eq('id', row.id)
      .eq('owner_anon_id', owner)
      .is('claimed_at', null);

    if (error) {
      failed += 1;
      console.error(`[anon-shortlist] attach failed for ${row.notice_id}: ${error.message}`);
      continue;
    }
    // Bug Prevention Rule #11: NULL is UNKNOWN, never zero — and never success.
    if (count == null) {
      failed += 1;
      console.error(`[anon-shortlist] attach count returned NULL for ${row.notice_id} — unknown, not zero`);
      continue;
    }
    if (count === 1) { attached += 1; continue; }
    if (count === 0) {
      // Either a concurrent claim already transferred it, or the row is not
      // where we think it is. Different facts — read back and decide on
      // evidence rather than assuming the benign one.
      const { data, error: readBackErr } = await db
        .from('anonymous_shortlist')
        // unranged-ok: single row by primary key.
        .select('id,claimed_at')
        .eq('id', row.id)
        .maybeSingle();
      if (readBackErr) {
        failed += 1;
        console.error(`[anon-shortlist] 0 rows attached; read-back failed for ${row.notice_id}: ${readBackErr.message}`);
        continue;
      }
      if (data && (data as { claimed_at: string | null }).claimed_at) {
        attached += 1;  // provably transferred concurrently
        continue;
      }
      failed += 1;
      console.error(`[anon-shortlist] 0 rows attached and ${row.notice_id} is still unclaimed`);
      continue;
    }
    failed += 1;
    console.error(`[anon-shortlist] expected to attach exactly 1 row for ${row.notice_id}, affected ${count}`);
  }

  return { ok: true, attached, failed };
}
