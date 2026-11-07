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
  /**
   * Attached saves now present in the account's Saved list
   * (`user_saved_opportunities`) — newly copied or already there. A copy
   * failure does NOT undo the claim (the transfer is proven separately); it is
   * reported in `copyFailed` instead of being hidden.
   */
  copied: number;
  /** Attached saves that could not be copied into the Saved list this time. */
  copyFailed: number;
  error?: string;
}

/** The columns the Saved-list copy reads from the canonical corpus. */
const SAVED_COPY_SELECT =
  'notice_id, solicitation_number, title, department, naics_code, set_aside_description, response_deadline, posted_date';

interface SamCopyRow {
  notice_id: string;
  solicitation_number: string | null;
  title: string | null;
  department: string | null;
  naics_code: string | null;
  set_aside_description: string | null;
  response_deadline: string | null;
  posted_date: string | null;
}

/**
 * Copy attached saves into the account's Saved list (`user_saved_opportunities`).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 * A claim used to set `claimed_by` and nothing else, so a claimed save showed
 * up NOWHERE except the "✓ Saved" badge on the map: not on the Saved page, not
 * in the app. The visitor's work was stranded at the moment they signed up.
 *
 * ── THE SHAPE ──────────────────────────────────────────────────────────────
 * The same row `/api/opportunities/save` writes for a SAM opportunity (the map
 * heart): notice id + a snapshot of title/agency/NAICS/set-aside/deadline.
 * The snapshot is read from `sam_opportunities` — never from the browser — and
 * is only a fallback: the Saved list hydrates live values on read. If the
 * lookup fails the row is still written with the notice id alone, which the
 * read side hydrates the same way.
 *
 * ── IDEMPOTENT, AND NEVER CLOBBERS ─────────────────────────────────────────
 * `ignoreDuplicates` on the (user_email, notice_id) unique key: a notice the
 * account already saved is left exactly as it is (its status, notes and source
 * are the user's), and a repeated claim adds nothing.
 *
 * Still NOT a pursuit: this writes the Saved list, never `user_pipeline`.
 */
async function copyClaimedToSavedList(
  db: SupabaseClient,
  email: string,
  noticeIds: string[],
): Promise<{ copied: number; copyFailed: number }> {
  const ids = Array.from(new Set(noticeIds.filter(Boolean)));
  if (ids.length === 0) return { copied: 0, copyFailed: 0 };

  const byId = new Map<string, SamCopyRow>();
  const { data: opps, error: lookupErr } = await db
    .from('sam_opportunities')
    .select(SAVED_COPY_SELECT)
    .in('notice_id', ids)
    .limit(MAX_ANON_SHORTLIST);
  if (lookupErr) {
    // Non-fatal: the Saved list hydrates from sam_opportunities on read.
    console.error(`[anon-shortlist] saved-list snapshot lookup failed: ${lookupErr.message}`);
  } else {
    for (const o of (opps ?? []) as SamCopyRow[]) byId.set(o.notice_id, o);
  }

  const rows = ids.map((noticeId) => {
    const o = byId.get(noticeId);
    const opportunityData = o
      ? {
          noticeId,
          solicitationNumber: o.solicitation_number,
          title: o.title,
          department: o.department,
          naicsCode: o.naics_code,
          responseDeadline: o.response_deadline,
          setAside: o.set_aside_description,
          claimedFrom: 'anonymous_shortlist',
        }
      : { noticeId, claimedFrom: 'anonymous_shortlist' };
    return {
      user_email: email,
      notice_id: noticeId,
      solicitation_number: o?.solicitation_number ?? null,
      opportunity_data: opportunityData,
      title: o?.title ?? null,
      agency: o?.department ?? null,
      naics_code: o?.naics_code ?? null,
      set_aside: o?.set_aside_description ?? null,
      response_deadline: o?.response_deadline ?? null,
      posted_date: o?.posted_date ?? null,
      source: 'opportunity_map',
      pursuit_brief_requested: false,
      status: 'watching',
    };
  });

  const { error: copyErr } = await db
    .from('user_saved_opportunities')
    .upsert(rows, { onConflict: 'user_email,notice_id', ignoreDuplicates: true });
  if (copyErr) {
    console.error(`[anon-shortlist] copy into Saved list failed: ${copyErr.message}`);
    return { copied: 0, copyFailed: ids.length };
  }
  // No error: every id is now in the Saved list (inserted, or already there).
  return { copied: ids.length, copyFailed: 0 };
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
 *
 * Each proven transfer is ALSO copied into the account's Saved list
 * (`user_saved_opportunities`, see `copyClaimedToSavedList`) so the save is
 * visible on the Saved page and in the app, not only as a badge on the map.
 */
export async function claimAnonShortlist(
  db: SupabaseClient,
  anonId: string,
  ctx: ClaimContext,
): Promise<ClaimResult> {
  const owner = anonId?.trim().toLowerCase();
  const email = ctx.verifiedEmail?.trim().toLowerCase();
  const none = { copied: 0, copyFailed: 0 };
  if (!isAnonId(owner)) return { ok: false, attached: 0, failed: 0, ...none, error: 'invalid anon id' };
  if (!email || !email.includes('@') || isAnonId(email)) {
    return { ok: false, attached: 0, failed: 0, ...none, error: 'a verified account email is required' };
  }

  const { data: rows, error: readErr } = await db
    .from('anonymous_shortlist')
    .select('id,notice_id')
    .eq('owner_anon_id', owner)
    .is('claimed_at', null)
    .limit(MAX_ANON_SHORTLIST);
  if (readErr) return { ok: false, attached: 0, failed: 0, ...none, error: readErr.message };
  const shortlist = (rows ?? []) as { id: string; notice_id: string }[];
  if (shortlist.length === 0) return { ok: true, attached: 0, failed: 0, ...none };

  let attached = 0;
  let failed = 0;
  // Notices whose transfer to THIS account is proven — the only ones copied
  // into the account's Saved list.
  const toCopy: string[] = [];

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
    if (count === 1) { attached += 1; toCopy.push(row.notice_id); continue; }
    if (count === 0) {
      // Either a concurrent claim already transferred it, or the row is not
      // where we think it is. Different facts — read back and decide on
      // evidence rather than assuming the benign one.
      const { data, error: readBackErr } = await db
        .from('anonymous_shortlist')
        // unranged-ok: single row by primary key.
        .select('id,claimed_at,claimed_by')
        .eq('id', row.id)
        .maybeSingle();
      if (readBackErr) {
        failed += 1;
        console.error(`[anon-shortlist] 0 rows attached; read-back failed for ${row.notice_id}: ${readBackErr.message}`);
        continue;
      }
      const back = data as { claimed_at: string | null; claimed_by?: string | null } | null;
      if (back && back.claimed_at) {
        attached += 1;  // provably transferred concurrently
        // Copy only when the concurrent claim was for THIS account; a save
        // another account claimed is not this user's to file.
        if ((back.claimed_by || '').toLowerCase() === email) toCopy.push(row.notice_id);
        continue;
      }
      failed += 1;
      console.error(`[anon-shortlist] 0 rows attached and ${row.notice_id} is still unclaimed`);
      continue;
    }
    failed += 1;
    console.error(`[anon-shortlist] expected to attach exactly 1 row for ${row.notice_id}, affected ${count}`);
  }

  const copy = await copyClaimedToSavedList(db, email, toCopy);
  if (copy.copyFailed > 0 && toCopy.length > 0) {
    // The copy failed, but the rows are already marked claimed, and the next claim only reads
    // UNCLAIMED rows: the saves would stay stranded for good. Hand them back (only the ones THIS
    // call claimed for THIS account) so the next sign-in claims and copies them again. Re-copying
    // every claimed row on each claim instead would resurrect saves the user later removed.
    const claimedIds = shortlist.filter((r) => toCopy.includes(r.notice_id)).map((r) => r.id);
    const { error: undoErr } = await db
      .from('anonymous_shortlist')
      .update({ claimed_at: null, claimed_by: null })
      .in('id', claimedIds)
      .eq('owner_anon_id', owner)
      .eq('claimed_by', email);
    if (undoErr) {
      console.error(`[anon-shortlist] could not release ${claimedIds.length} claim(s) for retry: ${undoErr.message}`);
      return { ok: true, attached, failed, ...copy };
    }
    // Released: report them as not transferred this time (left for retry), not as attached.
    return { ok: true, attached: Math.max(0, attached - claimedIds.length), failed: failed + claimedIds.length, ...copy };
  }
  return { ok: true, attached, failed, ...copy };
}
