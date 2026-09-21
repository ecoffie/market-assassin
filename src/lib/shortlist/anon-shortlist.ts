/**
 * Anonymous opportunity shortlist — the record-level twin of the market watch.
 *
 * ── THE MEASURED PROBLEM ───────────────────────────────────────────────────
 * Production, 30 days, Opportunity Map funnel:
 *
 *   cards_shown      8,460 users
 *   map_view         7,307
 *   listing_open     2,021
 *   pursuit_started     53   ← 2.6% of the people who opened a listing
 *
 * 2,021 people opened an opportunity and 53 kept it. The listing already
 * explains WHY (the "Why this opportunity" chips, Should-I-bid, the M-Estimate).
 * What it does not do is let most of them ACT: `savePursuit` calls
 * `requireSignIn('save this to your pursuits')`, and 96% of map users
 * (8,254 of 8,583) are not signed in.
 *
 * So the drop is not a comprehension failure. It is a permission failure.
 *
 * ── THE DESIGN ─────────────────────────────────────────────────────────────
 * Reuse `user_pipeline`. No migration: `user_email` has no FK, and the table
 * already carries `UNIQUE (user_email, notice_id)` — exactly the dedup key a
 * shortlist needs. An anonymous row is owned by `anon:<uuid>` and tagged
 * `source = 'opportunity_map_anon'`, so it is trivially distinguishable and
 * invisible to every signed-in user's pursuits view (which queries by email).
 *
 * This deliberately does NOT reach into the pursuits workflow (stages, win
 * probability, teaming). An anonymous save is a shortlist entry — "keep this
 * one" — and it becomes a real pursuit the moment an identity claims it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `anon:` + a uuid. Kept local to this module rather than imported so this
 * workstream merges independently of the market-watch one.
 */
const ANON_RE = /^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAnonId(v: string | null | undefined): boolean {
  return !!v && ANON_RE.test(v.trim());
}

/** The tag that marks a row as an anonymous shortlist entry. */
export const ANON_SHORTLIST_SOURCE = 'opportunity_map_anon';

export interface ShortlistInput {
  anonId: string;
  noticeId: string;
  title?: string | null;
  agency?: string | null;
  naicsCode?: string | null;
  responseDeadline?: string | null;
}

export interface ShortlistResult {
  ok: boolean;
  saved: boolean;
  /** TRUE when this notice was already on the shortlist — not an error. */
  duplicate: boolean;
  error?: string;
}

export async function addToAnonShortlist(
  db: SupabaseClient,
  input: ShortlistInput,
): Promise<ShortlistResult> {
  const owner = input.anonId?.trim().toLowerCase();
  if (!isAnonId(owner)) return { ok: false, saved: false, duplicate: false, error: 'invalid anon id' };
  const notice = input.noticeId?.trim();
  if (!notice) return { ok: false, saved: false, duplicate: false, error: 'noticeId is required' };

  const { error } = await db.from('user_pipeline').insert({
    user_email: owner,
    notice_id: notice,
    title: input.title ?? null,
    agency: input.agency ?? null,
    naics_code: input.naicsCode ?? null,
    response_deadline: input.responseDeadline ?? null,
    source: ANON_SHORTLIST_SOURCE,
  });

  if (error) {
    // 23505 = the UNIQUE(user_email, notice_id) key. Saving the same notice
    // twice is the user repeating themselves, not a failure — report it as a
    // duplicate so the UI can say "already saved" instead of "couldn't save".
    if (error.code === '23505') return { ok: true, saved: false, duplicate: true };
    return { ok: false, saved: false, duplicate: false, error: error.message };
  }
  return { ok: true, saved: true, duplicate: false };
}

/**
 * Move an anonymous shortlist onto a real account.
 *
 * Rows whose notice the account ALREADY tracks would violate
 * UNIQUE(user_email, notice_id), so they are dropped rather than allowed to
 * fail the whole claim — the account's existing pursuit is the better record
 * and must not be overwritten by a shortlist entry.
 */
export async function claimAnonShortlist(
  db: SupabaseClient,
  anonId: string,
  email: string,
): Promise<{ ok: boolean; claimed: number; alreadyTracked: number; error?: string }> {
  const owner = anonId?.trim().toLowerCase();
  const e = email?.trim().toLowerCase();
  if (!isAnonId(owner)) return { ok: false, claimed: 0, alreadyTracked: 0, error: 'invalid anon id' };
  if (!e || !e.includes('@')) return { ok: false, claimed: 0, alreadyTracked: 0, error: 'invalid email' };

  const { data: mine, error: readErr } = await db
    .from('user_pipeline')
    .select('id,notice_id')
    .eq('user_email', owner)
    .limit(500);
  if (readErr) return { ok: false, claimed: 0, alreadyTracked: 0, error: readErr.message };
  const rows = (mine ?? []) as { id: string; notice_id: string }[];
  if (rows.length === 0) return { ok: true, claimed: 0, alreadyTracked: 0 };

  const { data: existing, error: exErr } = await db
    .from('user_pipeline')
    .select('notice_id')
    .eq('user_email', e)
    .in('notice_id', rows.map((r) => r.notice_id));
  if (exErr) return { ok: false, claimed: 0, alreadyTracked: 0, error: exErr.message };
  const taken = new Set((existing ?? []).map((r) => (r as { notice_id: string }).notice_id));

  const movable = rows.filter((r) => !taken.has(r.notice_id));
  if (movable.length === 0) return { ok: true, claimed: 0, alreadyTracked: rows.length };

  // Counted by the ids we actually asked to move, not a RETURNING payload
  // (INT-005: `UPDATE … .select()` returns at most 1,000 rows).
  const { error: upErr, count } = await db
    .from('user_pipeline')
    .update({ user_email: e }, { count: 'exact' })
    .in('id', movable.map((r) => r.id));
  if (upErr) return { ok: false, claimed: 0, alreadyTracked: 0, error: upErr.message };
  if (count == null) {
    return { ok: false, claimed: 0, alreadyTracked: 0, error: 'claim count returned NULL — unknown, not zero' };
  }
  return { ok: true, claimed: count, alreadyTracked: rows.length - movable.length };
}
