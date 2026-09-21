/**
 * GET /api/app/return-brief — "what changed while you were gone?"
 *
 * RETURNING IS THE CONVERSION. This route answers one question for a visitor who has
 * come BACK to the Opportunity Map, using only data Mindy already holds, and it refuses
 * to answer when it cannot.
 *
 * ── WHAT IT WILL SAY ───────────────────────────────────────────────────────────────
 *   · N new opportunities in the market you were looking at   (sam_opportunities.created_at)
 *   · N listings you opened have closed                       (response_deadline arithmetic)
 * and nothing else. `src/lib/return/change-classes.ts` carries the live evidence for
 * every class that was considered and withheld — read it before adding a third number.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────────
 *   · It does not render 0 for a class it could not establish. A visitor with no
 *     recoverable market gets `state:'no_basis'`, and the strip renders nothing at all.
 *     Measured: 59% of returners are in exactly that position today, and telling them
 *     "0 changes" would be a completeness claim we cannot support.
 *   · It does not write. No `user_pipeline` row, no shortlist row, no new identity —
 *     a save is not a pursuit and a page view is not a save.
 *   · It does not call an LLM. Nothing here is narrated; every number is a COUNT.
 *
 * ── IDENTITY ───────────────────────────────────────────────────────────────────────
 * The same `anon:<uuid>` the map's telemetry already uses, or a verified account email.
 * 219 of the 414 returners are anonymous, so an account requirement would silence over
 * half the audience this feature exists for. An email owner must prove a session; a
 * caller supplying an email WITHOUT one is refused rather than silently downgraded to
 * anonymous, which would read a stranger's history into their brief.
 *
 * Everything this returns about an anonymous visitor is derived from that visitor's own
 * telemetry plus PUBLIC opportunity data. No PII crosses the boundary.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { isAnonId } from '@/lib/map-watch/anon-watch';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { deriveVisitWindow, describeGap } from '@/lib/return/last-visit';
import {
  WITHHELD_CLASSES, hasScope, marketLink, scopeLabel, scopeQuery, summarise,
  type ClassResult, type ClosedListing, type MarketScope, type ReturnBrief,
} from '@/lib/return/change-classes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How far back we look for the previous visit. Beyond this the market has moved so far
 *  that "since your last visit" stops being a useful frame and becomes a backlog. */
const HISTORY_WINDOW_DAYS = 45;
/** Cap on the engagement rows we sessionise. A page of history, not a scan. */
const MAX_EVENTS = 400;
/** Listings named in the strip. The counts are exact; only the NAMED list is capped. */
const MAX_NAMED_LISTINGS = 5;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** A verified email, else a well-formed anon id, else null. */
function resolveIdentity(request: NextRequest, email: string | null, anonId: string | null) {
  if (email && email.includes('@')) {
    const session = requireMIAuthSession(request, email);
    if (!session.ok) return { id: null as string | null, kind: 'account' as const, refusal: session.response };
    return { id: email.trim().toLowerCase(), kind: 'account' as const, refusal: null };
  }
  const a = anonId?.trim().toLowerCase() ?? null;
  return { id: isAnonId(a) ? a : null, kind: 'anon' as const, refusal: null };
}

const empty = (reason: string, kind: 'anon' | 'account'): ReturnBrief => ({
  isReturn: false,
  lastVisitAt: null,
  gapLabel: '',
  line: '',
  newInMarket: { state: 'no_basis', why: reason },
  listingClosed: { state: 'no_basis', why: reason },
  withheld: WITHHELD_CLASSES,
  _meta: { grounded: false, identityKind: kind, reason, provenance: [] },
});

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { id, kind, refusal } = resolveIdentity(request, url.searchParams.get('email'), url.searchParams.get('anonId'));
  if (refusal) return refusal;
  if (!id) return NextResponse.json(empty('no_identity', kind));

  const supabase = db();
  const now = Date.now();
  const since = new Date(now - HISTORY_WINDOW_DAYS * 86_400_000).toISOString();

  // ── 1. THE WINDOW ────────────────────────────────────────────────────────────────
  // Map events only: this brief is about the map, and mixing in email_open would make
  // "your last visit" mean "the last newsletter you opened on your phone".
  const { data: events, error: evErr } = await supabase
    .from('user_engagement')
    .select('created_at, metadata')
    .eq('user_email', id)
    .eq('event_source', 'opportunity_map')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_EVENTS);

  // A failed read is UNKNOWN, never "you are a first-time visitor" — that would be a
  // confident claim built on a failure (INT-005 / silent-failure registry).
  if (evErr) {
    console.error('[return-brief] engagement read failed:', evErr.message);
    return NextResponse.json(empty('history_unavailable', kind), { status: 503 });
  }

  const rows = (events ?? []) as Array<{ created_at: string; metadata: Record<string, unknown> | null }>;
  const win = deriveVisitWindow(rows, now);
  if (!win.isReturn || !win.lastVisitAt || !win.returnStartedAt) {
    return NextResponse.json(empty(win.reason, kind));
  }
  const lastVisitAt = win.lastVisitAt;
  const upperBound = new Date(now).toISOString();
  const provenance: string[] = [];

  // ── 2. SCOPE ─────────────────────────────────────────────────────────────────────
  // Most authoritative first: a watch the visitor explicitly created beats a filter we
  // merely observed them using. Both are the VISITOR's own market, never a guess.
  let scope: MarketScope | null = null;
  const { data: watches, error: watchErr } = await supabase
    .from('saved_searches')
    .select('name, filters, created_at')
    .eq('user_email', id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (watchErr) console.error('[return-brief] saved_searches read failed:', watchErr.message);
  const watch = watches?.[0] as { name: string | null; filters: Record<string, unknown> | null } | undefined;
  if (watch?.filters && hasScope(watch.filters)) {
    scope = {
      basis: 'saved_watch',
      filters: watch.filters,
      label: watch.name?.trim() || scopeLabel(watch.filters),
      query: scopeQuery(watch.filters),
    };
  } else {
    // The market they were looking at, taken from the LAST event at or before the last
    // visit that carried filters. `listing_open` and `map_search` ride state along; the
    // impression events (`map_view`, `cards_shown`) deliberately do not, so most rows
    // here carry no scope and are skipped rather than treated as "no filters applied".
    const before = rows
      .filter((r) => r.created_at <= lastVisitAt)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    for (const r of before) {
      const f = (r.metadata?.filters ?? null) as Record<string, unknown> | null;
      if (f && hasScope(f)) {
        scope = { basis: 'last_filter', filters: f, label: scopeLabel(f), query: scopeQuery(f) };
        break;
      }
    }
  }

  // ── 3. CLASS: NEW IN MARKET ──────────────────────────────────────────────────────
  let newInMarket: ClassResult<{ scope: MarketScope; link: string }>;
  if (!scope) {
    newInMarket = {
      state: 'no_basis',
      why: 'no_market_scope: this visitor has never applied a filter or opened a listing we can scope from',
    };
  } else {
    // Counted through the SHARED applyMapFilters — the same function the viewport API and
    // the saved-search alert cron use. That is not tidiness: it is what makes the number
    // and the page it links to agree. A private copy of the filter is how TMR and the FPDS
    // leaderboards drifted until a chart had to be deleted.
    const f = parseMapFilters((k) => {
      const v = scope!.filters[k];
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (v === true) return '1';
      return null;
    });
    let qy = supabase.from('sam_opportunities').select('notice_id', { count: 'exact', head: true });
    qy = applyMapFilters(qy, f);
    // The arrival window. `created_at` is Mindy's own clock — "we learned about it after
    // you left" — which is exactly what "new since your last visit" means, and unlike
    // posted_date it cannot be backdated past the boundary by a late SAM publication.
    //
    // ⚠️ CURRENT SEMANTICS, stated precisely: this counts what the visitor can SEE on the
    // map right now, NOT everything SAM published. `applyMapFilters` defaults to
    // `status:'active'`, which is `active = true AND response_deadline > now()` — and
    // `.gt` on a NULL excludes it, so the 7,551 active rows with no deadline never appear.
    // Measured: of 1,264 rows that arrived in the last 3 days and are still active, 447
    // (35.4%) carry no deadline. Counting them would be the WORSE choice: the CTA next to
    // this number opens the map with the same scope, so a count that included rows the map
    // will not show would send the visitor to a page that contradicts it. Number and
    // destination agree by construction, because both run the same function.
    qy = qy.gt('created_at', lastVisitAt).lte('created_at', upperBound);
    const { count, error } = await qy;
    if (error) {
      console.error('[return-brief] new_in_market count failed:', error.message);
      newInMarket = { state: 'unknown', why: `query_failed: ${error.message}` };
    } else if (count == null) {
      // A null count with no error is the documented "table does not exist" shape. It is
      // UNKNOWN. `count ?? 0` here would fabricate the calmest possible lie.
      newInMarket = { state: 'unknown', why: 'count_null: source could not be established' };
    } else {
      newInMarket = { state: 'measured', count, detail: { scope, link: marketLink(scope) } };
      provenance.push(
        `new_in_market: count of sam_opportunities with created_at in (${lastVisitAt}, ${upperBound}] ` +
        `matching the visitor's ${scope.basis === 'saved_watch' ? 'saved watch' : 'last applied filter'}, ` +
        'via the shared applyMapFilters',
      );
    }
  }

  // ── 4. CLASS: LISTING CLOSED ─────────────────────────────────────────────────────
  // Every notice the visitor opened at or before their last visit. Two sources, both
  // theirs: the listings they merely OPENED (telemetry) and the ones they KEPT
  // (anonymous_shortlist). A kept listing is not a pursuit and is not promoted here.
  const openedIds = new Set<string>();
  for (const r of rows) {
    if (r.created_at > lastVisitAt) continue;
    const nid = r.metadata?.notice_id;
    if (typeof nid === 'string' && nid.trim()) openedIds.add(nid.trim());
  }
  if (kind === 'anon') {
    const { data: kept, error: keptErr } = await supabase
      .from('anonymous_shortlist')
      .select('notice_id')
      .eq('owner_anon_id', id)
      .limit(100);
    if (keptErr) console.error('[return-brief] shortlist read failed:', keptErr.message);
    for (const k of (kept ?? []) as Array<{ notice_id: string }>) if (k.notice_id) openedIds.add(k.notice_id);
  }

  let listingClosed: ClassResult<{ listings: ClosedListing[]; resolved: number; unresolved: number }>;
  if (!openedIds.size) {
    listingClosed = { state: 'no_basis', why: 'no_listings_opened_before_last_visit' };
  } else {
    const ids = [...openedIds].slice(0, 200);
    const { data: listings, error } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, response_deadline')
      .in('notice_id', ids);
    if (error) {
      console.error('[return-brief] listing resolve failed:', error.message);
      listingClosed = { state: 'unknown', why: `query_failed: ${error.message}` };
    } else {
      const resolvedRows = (listings ?? []) as Array<{ notice_id: string; title: string | null; response_deadline: string | null }>;
      const resolved = resolvedRows.length;
      const unresolved = ids.length - resolved;
      if (!resolved) {
        // Measured: 2,558 of 3,973 distinct opened ids no longer resolve in the cache
        // (they are recompete contract ids, or notices aged out of retention). When we
        // can resolve NONE of them the honest answer is "we cannot see those any more",
        // not "none of them closed".
        listingClosed = { state: 'no_basis', why: `unresolvable_listings: 0 of ${ids.length} still in the SAM cache` };
      } else {
        const closed = resolvedRows
          .filter((r) => !!r.response_deadline && r.response_deadline > lastVisitAt && r.response_deadline <= upperBound)
          .map((r) => ({ noticeId: r.notice_id, title: r.title, deadline: r.response_deadline! }))
          .sort((a, b) => (a.deadline < b.deadline ? 1 : -1));
        listingClosed = {
          state: 'measured',
          count: closed.length,
          detail: { listings: closed.slice(0, MAX_NAMED_LISTINGS), resolved, unresolved },
        };
        provenance.push(
          `listing_closed: of ${ids.length} listings this visitor opened before ${lastVisitAt}, ${resolved} still ` +
          `resolve in sam_opportunities; ${closed.length} of those have a response_deadline inside ` +
          `(${lastVisitAt}, ${upperBound}]. ${unresolved} could not be resolved and are excluded, not counted as unchanged.`,
        );
      }
    }
  }

  const brief: ReturnBrief = {
    isReturn: true,
    lastVisitAt,
    gapLabel: describeGap(win.gapMs),
    // Built here, not in the browser — one definition of "is there anything to say".
    line: summarise({ newInMarket, listingClosed }),
    newInMarket,
    listingClosed,
    withheld: WITHHELD_CLASSES,
    _meta: {
      grounded: newInMarket.state === 'measured' || listingClosed.state === 'measured',
      identityKind: kind,
      reason: win.reason,
      provenance,
    },
  };
  return NextResponse.json(brief);
}
