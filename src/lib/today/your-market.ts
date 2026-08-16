/**
 * Your Market — the MOMENTUM half of /today (state 2). See `docs/today-page-states.md`.
 *
 * Eric's framing, 2026-08-15: "Top = intelligence. Bottom = momentum." The top half answers
 * "what changed in the market today?"; this answers "what was I doing, and what's next?"
 *
 * Three sections, each from a source measured BEFORE it was designed (2026-08-15):
 *  - Pick up where you left off ← `user_engagement` listing_open events (410 rows, 27 users,
 *    16 of them with 3+ distinct opportunities). Real and accumulating.
 *  - Your work                  ← `user_pipeline` (4,328 rows, 103 users), carrying the
 *    next_action / response_deadline / stage a work queue needs.
 *  - Recommended for you        ← the user's profile NAICS against live active notices.
 *
 * ⚠️ Saved Searches (14 rows, 7 users total) and Saved Opportunities (29 rows) were
 * DELIBERATELY LEFT OUT. Across the entire user base they are effectively empty, so for
 * ~99% of visitors those sections could only ever render a prompt. Per the fallback rule,
 * a section that cannot show anything meaningful should not exist yet — it returns when it
 * has usage.
 */
import { createClient } from '@supabase/supabase-js';

export interface ViewedOpp {
  noticeId: string;
  title: string;
  agency: string;
  /** ISO timestamp of the most recent view — the UI renders this as "2h ago". */
  viewedAt: string;
  href: string;
}

export interface PursuitRow {
  noticeId: string | null;
  title: string;
  agency: string;
  stage: string;
  /** The single most useful line on the row: what happens next. Null when unset. */
  nextAction: string | null;
  /** Days until the response is due. Negative = past due. Null when there is no deadline. */
  daysLeft: number | null;
  href: string;
}

export interface RecommendedOpp {
  noticeId: string;
  title: string;
  agency: string;
  daysLeft: number | null;
  href: string;
}

export interface YourMarket {
  /** New opportunities matching this user's profile since their previous visit. */
  sinceLastVisit: number | null;
  /** ISO timestamp of the visit we measured against — null on a user's first tracked session. */
  lastVisitAt: string | null;
  recentlyViewed: ViewedOpp[];
  pursuits: PursuitRow[];
  recommended: RecommendedOpp[];
  /** True when a source ERRORED (distinct from a genuinely empty section). */
  degraded: boolean;
}

const VIEWED_LIMIT = 4;
const PURSUIT_LIMIT = 4;
const RECOMMENDED_LIMIT = 4;

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * `next_action` is a MIXED column: some rows hold a real human sentence ("Call Maria Swinton…
 * confirm they received capability statement"), others hold a machine enum written by the
 * pursue flow (`draft_response`, `white_glove_help`, `submit_loi` — 9/4/4 rows measured).
 *
 * A bare `draft_response` on the front page is a raw code shown to a user, the same class as
 * printing "NAICS 336413" instead of the industry name. Known enums get a human phrase;
 * anything containing a space is already human and passes through untouched; an unrecognised
 * snake_case token is de-underscored rather than invented over.
 */
const NEXT_ACTION_LABEL: Record<string, string> = {
  draft_response: 'Draft the response',
  submit_loi: 'Submit a letter of interest',
  white_glove_help: 'Request white-glove help',
  request_debrief: 'Request a debrief',
  contact_buyer: 'Contact the buying office',
  find_partner: 'Find a teaming partner',
};

function humanAction(raw: string | null | undefined): string | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/\s/.test(v)) return v;                       // already a sentence
  const mapped = NEXT_ACTION_LABEL[v.toLowerCase()];
  if (mapped) return mapped;
  // Unknown token: make it readable without pretending to know what it means.
  return v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function daysUntil(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

/**
 * The user's most recently opened opportunities, de-duplicated to the LATEST view of each.
 *
 * ⚠️ The event's notice id lives at `metadata.notice_id` — NOT `metadata.nid`, and NOT the
 * top-level `event_source` column. I probed `nid` first and got zero rows, which read as
 * "telemetry was never wired" when in fact it had been firing all along. Confirm the JSON
 * path against a real row before concluding a source is empty.
 *
 * Forecast ids (`fc-…`) are kept: the user really did open that listing, and the map resolves
 * both id shapes. Only rows with NO id are dropped.
 */
async function getRecentlyViewed(
  db: NonNullable<ReturnType<typeof sb>>,
  email: string,
): Promise<{ rows: ViewedOpp[]; degraded: boolean }> {
  const { data, error } = await db
    .from('user_engagement')
    .select('metadata, created_at')
    .eq('user_email', email)
    .eq('metadata->>action', 'listing_open')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return { rows: [], degraded: true };

  const seen = new Set<string>();
  const out: ViewedOpp[] = [];
  for (const row of (data || []) as Array<{ metadata: Record<string, unknown>; created_at: string }>) {
    const noticeId = String(row.metadata?.notice_id || '');
    if (!noticeId || seen.has(noticeId)) continue;
    seen.add(noticeId);
    out.push({
      noticeId,
      title: '',        // filled in by hydrateTitles below
      agency: '',
      viewedAt: row.created_at,
      href: `/opportunity-map?opp=${encodeURIComponent(noticeId)}`,
    });
    if (out.length >= VIEWED_LIMIT) break;
  }
  return { rows: out, degraded: false };
}

/**
 * Resolve titles/agencies for viewed notices in ONE query.
 *
 * The event log stores only the id — a title captured at click time would go stale when a
 * notice is amended, so the row is resolved against the live corpus instead. A notice that
 * no longer resolves (archived, or a forecast id) is DROPPED rather than rendered as a blank
 * row: "Pick up where you left off" pointing at an untitled void is worse than one fewer row.
 */
async function hydrateTitles(
  db: NonNullable<ReturnType<typeof sb>>,
  rows: ViewedOpp[],
): Promise<ViewedOpp[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.noticeId);
  const { data, error } = await db
    .from('sam_opportunities')
    .select('notice_id, title, department')
    .in('notice_id', ids);
  if (error) return [];

  const byId = new Map(
    ((data || []) as Array<{ notice_id: string; title: string | null; department: string | null }>)
      .map((r) => [r.notice_id, r]),
  );
  return rows
    .map((r) => {
      const hit = byId.get(r.noticeId);
      if (!hit?.title) return null;
      return { ...r, title: hit.title, agency: hit.department || '' };
    })
    .filter((r): r is ViewedOpp => r !== null);
}

/**
 * The user's active pursuits as a WORK QUEUE, not a CRM.
 *
 * Ordered by DEADLINE (soonest first), not by when the row was touched — the question this
 * section answers is "what needs me next", and a pursuit closing Friday outranks one edited
 * this morning. Rows with no deadline sort last rather than being dropped.
 * (Memory: pursuits_work_queue_not_crm — rows are WORK; the next action dominates.)
 */
async function getPursuits(
  db: NonNullable<ReturnType<typeof sb>>,
  email: string,
): Promise<{ rows: PursuitRow[]; degraded: boolean }> {
  const { data, error } = await db
    .from('user_pipeline')
    .select('notice_id, title, agency, stage, next_action, response_deadline, is_archived, owner_email, user_email')
    .or(`user_email.eq.${email},owner_email.eq.${email}`)
    .neq('stage', 'archived')
    .limit(40);
  if (error) return { rows: [], degraded: true };

  const rows = ((data || []) as Array<{
    notice_id: string | null; title: string | null; agency: string | null; stage: string | null;
    next_action: string | null; response_deadline: string | null; is_archived: boolean | null;
  }>)
    .filter((r) => !r.is_archived && r.title)
    .map((r) => ({
      noticeId: r.notice_id,
      title: r.title as string,
      agency: r.agency || '',
      stage: r.stage || 'tracking',
      nextAction: humanAction(r.next_action),
      daysLeft: daysUntil(r.response_deadline),
      href: r.notice_id
        ? `/opportunity-map?opp=${encodeURIComponent(r.notice_id)}`
        : '/opportunity-map/pursuits',
    }));

  // ⚠️ MEASURED 2026-08-15 before choosing this order: of 855 active pipeline rows, 704 are
  // PAST DUE and only 100 are upcoming — and just 24 of 106 users have ANY future deadline.
  // So a naive soonest-first sort (the obvious "most urgent first") would open Your Work with
  // four expired pursuits for ~82% of users. That is accurate and useless: it reads as "your
  // product is a graveyard", which is the same emotional failure as "nothing tracked yet".
  //
  // Order: live dated work (soonest first) → undated work → past due (most recent first).
  // Past-due rows still APPEAR — they are real and may need closing out — they just never
  // crowd out work the user can still act on.
  const bucket = (d: number | null) => (d === null ? 1 : d >= 0 ? 0 : 2);
  rows.sort((a, b) => {
    const ba = bucket(a.daysLeft), bb = bucket(b.daysLeft);
    if (ba !== bb) return ba - bb;
    if (ba === 0) return (a.daysLeft as number) - (b.daysLeft as number);  // soonest deadline
    if (ba === 2) return (b.daysLeft as number) - (a.daysLeft as number);  // least stale first
    return 0;
  });
  return { rows: rows.slice(0, PURSUIT_LIMIT), degraded: false };
}

/**
 * Profile-matched open opportunities the user has NOT already seen or tracked.
 *
 * "Recommended" has to mean new-to-them, otherwise it just repeats the two sections above it.
 */
async function getRecommended(
  db: NonNullable<ReturnType<typeof sb>>,
  email: string,
  exclude: Set<string>,
): Promise<{ rows: RecommendedOpp[]; degraded: boolean }> {
  const { data: prof, error: profErr } = await db
    .from('user_notification_settings')
    .select('naics_codes')
    .eq('user_email', email)
    .maybeSingle();
  if (profErr) return { rows: [], degraded: true };

  const codes = (prof?.naics_codes as string[] | null) || [];
  if (codes.length === 0) return { rows: [], degraded: false };   // honest empty, not an error

  // Cap the OR list: a profile carrying the whole 541 family would otherwise build a URL-length
  // sized expression. (Memory: normalizeNAICSForPersist — some profiles hold 200+ codes.)
  const or = codes.slice(0, 12).map((c) => `naics_code.like.${c}%`).join(',');
  const { data, error } = await db
    .from('sam_opportunities')
    .select('notice_id, title, department, response_deadline')
    .eq('active', true)
    .or(or)
    .order('posted_date', { ascending: false })
    .limit(40);
  if (error) return { rows: [], degraded: true };

  const rows = ((data || []) as Array<{
    notice_id: string; title: string | null; department: string | null; response_deadline: string | null;
  }>)
    .filter((r) => r.title && !exclude.has(r.notice_id))
    .slice(0, RECOMMENDED_LIMIT)
    .map((r) => ({
      noticeId: r.notice_id,
      title: r.title as string,
      agency: r.department || '',
      daysLeft: daysUntil(r.response_deadline),
      href: `/opportunity-map?opp=${encodeURIComponent(r.notice_id)}`,
    }));
  return { rows, degraded: false };
}

/** A gap this long between events means the user left and came back. */
const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * When did this user PREVIOUSLY visit, and how many matching opportunities posted since?
 *
 * There is no "sessions" table, so the previous visit is derived from a gap in the event
 * stream: sort this user's events newest-first and walk back until a gap exceeds 30 minutes —
 * that boundary is where the current session began, and the event just before it is the tail
 * of the prior visit. Verified against a real account: 12 sessions across 3 active days.
 *
 * Returns nulls (never zero) when there IS no prior session. A first-time signed-in user has
 * not "had 0 new opportunities since their last visit" — they have no last visit, and the UI
 * must omit the line rather than print a hollow zero.
 */
async function getSinceLastVisit(
  db: NonNullable<ReturnType<typeof sb>>,
  email: string,
): Promise<{ count: number | null; at: string | null; degraded: boolean }> {
  const { data, error } = await db
    .from('user_engagement')
    .select('created_at')
    .eq('user_email', email)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return { count: null, at: null, degraded: true };

  const times = ((data || []) as Array<{ created_at: string }>)
    .map((r) => Date.parse(r.created_at))
    .filter((t) => !Number.isNaN(t));
  if (times.length < 2) return { count: null, at: null, degraded: false };

  let boundary: number | null = null;
  for (let i = 1; i < times.length; i++) {
    if (times[i - 1] - times[i] > SESSION_GAP_MS) { boundary = times[i]; break; }
  }
  if (boundary === null) return { count: null, at: null, degraded: false };   // one session only

  const at = new Date(boundary).toISOString();
  const { count, error: cErr } = await db
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)
    .gte('posted_date', at.slice(0, 10));
  if (cErr || typeof count !== 'number') return { count: null, at, degraded: !!cErr };
  return { count, at, degraded: false };
}

/**
 * Everything the momentum half needs, for one VERIFIED email.
 *
 * The caller must have resolved `email` from a signed token server-side — never from a
 * client-supplied parameter.
 */
export async function getYourMarket(email: string): Promise<YourMarket> {
  const db = sb();
  if (!db) {
    return { sinceLastVisit: null, lastVisitAt: null, recentlyViewed: [], pursuits: [], recommended: [], degraded: true };
  }

  const [viewedRes, pursuitRes, sinceRes] = await Promise.all([
    getRecentlyViewed(db, email),
    getPursuits(db, email),
    getSinceLastVisit(db, email),
  ]);
  const viewed = await hydrateTitles(db, viewedRes.rows);

  // Don't recommend what they just looked at or already track.
  const exclude = new Set<string>([
    ...viewed.map((v) => v.noticeId),
    ...pursuitRes.rows.map((p) => p.noticeId).filter((id): id is string => !!id),
  ]);
  const recRes = await getRecommended(db, email, exclude);

  return {
    sinceLastVisit: sinceRes.count,
    lastVisitAt: sinceRes.at,
    recentlyViewed: viewed,
    pursuits: pursuitRes.rows,
    recommended: recRes.rows,
    degraded: viewedRes.degraded || pursuitRes.degraded || recRes.degraded || sinceRes.degraded,
  };
}
