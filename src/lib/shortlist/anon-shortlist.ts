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

export interface ClaimResult {
  ok: boolean;
  promoted: number;
  alreadyTracked: number;
  /** Rows whose canonical metadata could not be read — retryable, not silent. */
  failed?: number;
  error?: string;
}

/**
 * Promote an anonymous shortlist into a VERIFIED account's pursuits.
 *
 * ⚠️ `verifiedEmail` MUST come from a validated MI session. The first version
 * accepted an arbitrary email from the request body, which let one client insert
 * rows into another user's pursuit space.
 *
 * Order matters: a row is marked claimed ONLY after its pursuit write succeeds,
 * so a failure leaves the shortlist intact and the user can retry. An
 * opportunity the account ALREADY pursues is left completely alone — the
 * account's own pursuit is the better record and is never overwritten.
 */
export async function claimAnonShortlist(
  db: SupabaseClient,
  anonId: string,
  verifiedEmail: string,
): Promise<ClaimResult> {
  const owner = anonId?.trim().toLowerCase();
  const email = verifiedEmail?.trim().toLowerCase();
  if (!isAnonId(owner)) return { ok: false, promoted: 0, alreadyTracked: 0, error: 'invalid anon id' };
  if (!email || !email.includes('@') || isAnonId(email)) {
    return { ok: false, promoted: 0, alreadyTracked: 0, error: 'a verified account email is required' };
  }

  const { data: rows, error: readErr } = await db
    .from('anonymous_shortlist')
    .select('id,notice_id')
    .eq('owner_anon_id', owner)
    .is('claimed_at', null)
    .limit(MAX_ANON_SHORTLIST);
  if (readErr) return { ok: false, promoted: 0, alreadyTracked: 0, error: readErr.message };
  const shortlist = (rows ?? []) as { id: string; notice_id: string }[];
  if (shortlist.length === 0) return { ok: true, promoted: 0, alreadyTracked: 0 };

  const { data: existing, error: exErr } = await db
    .from('user_pipeline')
    .select('notice_id')
    .eq('user_email', email)
    .in('notice_id', shortlist.map((r) => r.notice_id));
  if (exErr) return { ok: false, promoted: 0, alreadyTracked: 0, error: exErr.message };
  const tracked = new Set((existing ?? []).map((r) => (r as { notice_id: string }).notice_id));

  let promoted = 0;
  let failed = 0;
  for (const row of shortlist) {
    if (tracked.has(row.notice_id)) continue;

    // Metadata comes from the CANONICAL record, never from anything a browser
    // sent. The shortlist stores no title/agency at all.
    const { data: opp, error: oppErr } = await db
      .from('sam_opportunities')
      // unranged-ok: single row by primary key.
      .select('notice_id,title,department,naics_code,response_deadline')
      .eq('notice_id', row.notice_id)
      .maybeSingle();
    // A FAILED read is not "no such opportunity". Swallowing it would silently
    // drop a promotion the user asked for and report success. Surface it and
    // leave the shortlist row unclaimed so the next attempt can retry.
    if (oppErr) {
      failed += 1;
      console.error(`[anon-shortlist] metadata read failed for ${row.notice_id}: ${oppErr.message}`);
      continue;
    }
    if (!opp) continue;
    const o = opp as Record<string, unknown>;

    const { error: insErr } = await db.from('user_pipeline').insert({
      user_email: email,
      notice_id: row.notice_id,
      title: (o.title as string) ?? null,
      agency: (o.department as string) ?? null,
      naics_code: (o.naics_code as string) ?? null,
      response_deadline: (o.response_deadline as string) ?? null,
      source: 'opportunity_map_claimed',
    });
    // A duplicate here means the account gained the pursuit between our read and
    // this write — still "already tracked", never an error.
    if (insErr && insErr.code !== '23505') continue;

    // Mark claimed ONLY after the pursuit exists.
    await db
      .from('anonymous_shortlist')
      .update({ claimed_at: new Date().toISOString(), claimed_by: email })
      .eq('id', row.id);
    if (!insErr) promoted += 1;
  }

  return { ok: true, promoted, alreadyTracked: shortlist.length - promoted - failed, failed };
}
