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
import { createCanonicalPursuit } from '@/lib/pipeline/create-pursuit';

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
  /** Shortlist rows that became a NEW canonical pursuit. */
  promoted: number;
  /** Rows the account already pursued — resolved, never overwritten. */
  alreadyTracked: number;
  /** Rows that could not be promoted this time. Left unclaimed for retry. */
  failed: number;
  /**
   * Background document fetches for the pursuits just created. The ROUTE must
   * schedule these with `after()`, and must declare maxDuration = 300 — a
   * fire-and-forget call here would be killed by Vercel teardown mid-PDF-parse.
   */
  postWrite: Array<() => Promise<void>>;
  error?: string;
}

/** The verified account and resolved workspace a claim writes into. */
export interface ClaimContext {
  /** From a validated MI session. NEVER from a request body. */
  verifiedEmail: string;
  /** From resolveActiveWorkspace — the CLIENT's workspace in coach mode. */
  workspaceId: string;
  asClient: boolean;
  clientOwnerEmail: string;
}

/** Truthful provenance for a pursuit that began as an anonymous map listing. */
export const CLAIMED_SOURCE = 'opportunity_map_claimed';

/**
 * Promote an anonymous shortlist into a VERIFIED account's pursuits.
 *
 * ⚠️ `ctx.verifiedEmail` MUST come from a validated MI session. The first
 * version accepted an arbitrary email from the request body, which let one
 * client insert rows into another user's pursuit space.
 *
 * ── ONE PURSUIT IMPLEMENTATION ─────────────────────────────────────────────
 * This does NOT insert into `user_pipeline`. It calls `createCanonicalPursuit`,
 * the same writer `/api/pipeline` POST uses, so a claimed listing becomes a
 * pursuit with the same workspace, owner attribution, canonical SAM UUID,
 * deadline, next action, discovery time, family truth, activity record and
 * document fetch. A direct insert here would have created a second-class
 * pursuit that looks identical in the table and behaves differently everywhere.
 *
 * ── THE THREE OUTCOMES, AND WHY EACH RESOLVES THE WAY IT DOES ──────────────
 * · ALREADY TRACKED → the account's own pursuit is the better record and is
 *   left completely untouched. The shortlist row is still marked claimed,
 *   because its value HAS transferred — the pursuit exists. Leaving it open was
 *   a real bug: the row stayed unclaimed forever and was reconsidered on every
 *   Map load.
 * · CREATED → marked claimed only AFTER the pursuit write is confirmed.
 * · FAILED (metadata read error, or a pursuit write that errored) → left
 *   UNCLAIMED and counted. A failed read is UNKNOWN, never "no such
 *   opportunity" and never a silent skip.
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * The invariant is: the pursuit exists BEFORE the shortlist row is marked. If
 * the pursuit write succeeds but the marking fails, the next attempt finds the
 * pursuit (as already-tracked, or as a 23505 duplicate) and resolves the row
 * then — without creating a second pursuit and without rolling back a real one.
 */
export async function claimAnonShortlist(
  db: SupabaseClient,
  anonId: string,
  ctx: ClaimContext,
): Promise<ClaimResult> {
  const empty = { promoted: 0, alreadyTracked: 0, failed: 0, postWrite: [] as Array<() => Promise<void>> };
  const owner = anonId?.trim().toLowerCase();
  const email = ctx.verifiedEmail?.trim().toLowerCase();
  if (!isAnonId(owner)) return { ok: false, ...empty, error: 'invalid anon id' };
  if (!email || !email.includes('@') || isAnonId(email)) {
    return { ok: false, ...empty, error: 'a verified account email is required' };
  }

  const { data: rows, error: readErr } = await db
    .from('anonymous_shortlist')
    .select('id,notice_id')
    .eq('owner_anon_id', owner)
    .is('claimed_at', null)
    .limit(MAX_ANON_SHORTLIST);
  if (readErr) return { ok: false, ...empty, error: readErr.message };
  const shortlist = (rows ?? []) as { id: string; notice_id: string }[];
  if (shortlist.length === 0) return { ok: true, ...empty };

  // Which of these the account ALREADY pursues. Keyed on user_email + notice_id
  // because that is exactly the UNIQUE constraint on user_pipeline.
  const { data: existing, error: exErr } = await db
    .from('user_pipeline')
    .select('notice_id')
    .eq('user_email', email)
    .in('notice_id', shortlist.map((r) => r.notice_id));
  if (exErr) return { ok: false, ...empty, error: exErr.message };
  const tracked = new Set((existing ?? []).map((r) => (r as { notice_id: string }).notice_id));

  const writeCtx = {
    db,
    callerEmail: email,
    workspaceId: ctx.workspaceId,
    asClient: ctx.asClient,
    clientOwnerEmail: ctx.clientOwnerEmail,
  };

  let promoted = 0;
  let alreadyTracked = 0;
  let failed = 0;
  const postWrite: Array<() => Promise<void>> = [];

  /**
   * Resolve ONE shortlist row, and PROVE it.
   *
   * ⚠️ The first version logged the error and let the caller count the row as
   * promoted anyway, so this state was reachable: the pursuit exists, the
   * shortlist row is still unclaimed, and the API reports `promoted: 1,
   * failed: 0`. That contradicts the partial-failure contract — and an UPDATE
   * matching ZERO rows with no database error was treated as success too.
   *
   * So the mutation is counted exactly and scoped defensively: this id, owned
   * by THIS anon identity, and still unclaimed. Exactly one row must transition
   * — unless we can positively prove it was resolved concurrently. UNKNOWN, an
   * error, and zero-affected are never silently treated as resolved.
   */
  const markClaimed = async (row: { id: string }): Promise<{ ok: boolean; reason?: string }> => {
    const { count, error } = await db
      .from('anonymous_shortlist')
      .update(
        { claimed_at: new Date().toISOString(), claimed_by: email },
        { count: 'exact' },
      )
      .eq('id', row.id)
      .eq('owner_anon_id', owner)
      .is('claimed_at', null);

    if (error) return { ok: false, reason: error.message };
    // Bug Prevention Rule #11: a NULL count is UNKNOWN, never zero — and here
    // "unknown" must not be read as "resolved".
    if (count == null) return { ok: false, reason: 'claim count returned NULL — unknown, not zero' };
    if (count === 1) return { ok: true };
    if (count === 0) {
      // Either a concurrent claim already resolved it, or the row is not where
      // we think it is. Those are different facts, so read back and decide on
      // evidence rather than assuming the benign one.
      const { data, error: readErr } = await db
        .from('anonymous_shortlist')
        // unranged-ok: single row by primary key.
        .select('id,claimed_at')
        .eq('id', row.id)
        .maybeSingle();
      if (readErr) return { ok: false, reason: `0 rows updated; read-back failed: ${readErr.message}` };
      if (data && (data as { claimed_at: string | null }).claimed_at) {
        return { ok: true };  // provably resolved concurrently
      }
      return { ok: false, reason: '0 rows updated and the row is still unclaimed' };
    }
    return { ok: false, reason: `expected to resolve exactly 1 row, affected ${count}` };
  };

  for (const row of shortlist) {
    // ALREADY TRACKED — resolve the shortlist row, modify nothing else.
    if (tracked.has(row.notice_id)) {
      const marked = await markClaimed(row);
      if (!marked.ok) {
        // The pursuit exists but the shortlist row did NOT resolve. Counting it
        // as alreadyTracked would report a resolution that did not happen.
        failed += 1;
        console.error(`[anon-shortlist] claim marking failed for ${row.notice_id}: ${marked.reason}`);
        continue;
      }
      alreadyTracked += 1;
      continue;
    }

    // Metadata comes from the CANONICAL record, never from anything a browser
    // sent. The shortlist stores no title/agency at all.
    const { data: opp, error: oppErr } = await db
      .from('sam_opportunities')
      // unranged-ok: single row by primary key.
      .select('notice_id,title,department,naics_code,set_aside,response_deadline,notice_type')
      .eq('notice_id', row.notice_id)
      .maybeSingle();
    // A FAILED read is not "no such opportunity". Swallowing it would silently
    // drop a promotion the user asked for and report success. Surface it and
    // leave the row unclaimed so the next attempt can retry.
    if (oppErr) {
      failed += 1;
      console.error(`[anon-shortlist] metadata read failed for ${row.notice_id}: ${oppErr.message}`);
      continue;
    }
    if (!opp) {
      // The FK makes this near-impossible, but a notice deleted between save and
      // claim is a genuine absence, not an error.
      failed += 1;
      console.warn(`[anon-shortlist] no canonical opportunity for ${row.notice_id}`);
      continue;
    }
    const o = opp as Record<string, unknown>;

    const result = await createCanonicalPursuit(
      writeCtx,
      {
        notice_id: row.notice_id,
        title: (o.title as string) ?? row.notice_id,
        agency: (o.department as string) ?? undefined,
        naics_code: (o.naics_code as string) ?? undefined,
        set_aside: (o.set_aside as string) ?? undefined,
        response_deadline: (o.response_deadline as string) ?? undefined,
        source: CLAIMED_SOURCE,
      },
      {
        clientNoticeType: (o.notice_type as string) ?? null,
        // The person who viewed this listing was ANONYMOUS at the time. That
        // anon identity is the one carrying the first-view event, so it is
        // included alongside the account and the EARLIEST real observation
        // wins. Neither is invented — see createCanonicalPursuit.
        discoveryIdentities: [owner, email],
      },
    );

    if (result.kind === 'error') {
      // Leave the row UNCLAIMED. Retry stays safe.
      failed += 1;
      console.error(`[anon-shortlist] pursuit write failed for ${row.notice_id}: ${result.error.message}`);
      continue;
    }
    if (result.kind === 'duplicate') {
      // The account gained this pursuit between our read and this write. Still
      // "already tracked" — the value transferred, so resolve the row.
      const marked = await markClaimed(row);
      if (!marked.ok) {
        failed += 1;
        console.error(`[anon-shortlist] claim marking failed for ${row.notice_id}: ${marked.reason}`);
        continue;
      }
      alreadyTracked += 1;
      continue;
    }

    // The pursuit now EXISTS. Whatever happens next, it stays — its documents
    // are still fetched and it is never rolled back.
    if (result.postWrite) postWrite.push(result.postWrite);

    // Mark claimed ONLY after the pursuit exists, and only count this attempt
    // as promoted if the row actually transitioned. If it did not, the claim is
    // unresolved: the next retry finds the real pursuit as already-tracked and
    // resolves the shortlist then, without creating a second pursuit.
    const marked = await markClaimed(row);
    if (!marked.ok) {
      failed += 1;
      console.error(`[anon-shortlist] pursuit created but claim marking failed for ${row.notice_id}: ${marked.reason}`);
      continue;
    }
    promoted += 1;
  }

  return { ok: true, promoted, alreadyTracked, failed, postWrite };
}
