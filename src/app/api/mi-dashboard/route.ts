/**
 * MI Dashboard API
 *
 * GET /api/mi-dashboard
 *
 * Fetches SAM.gov opportunities from local cache for MI Dashboard
 * with filtering, search, and aggregation capabilities.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { samHtmlToText, looksLikeHtml } from '@/lib/sam/description-text';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { saveSnapshot, readSnapshot, freshMeta, degradedMeta } from '@/lib/resilience/last-good';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { buildSearchOr, rankSearchResults, queryWords } from '@/lib/mi-dashboard/search';

// Lazy initialization to avoid build-time errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Notice type display names and colors (supports both code and text)
const NOTICE_TYPE_INFO: Record<string, { label: string; color: string; bgColor: string }> = {
  // Code-based
  'p': { label: 'Pre-Solicitation', color: '#f97316', bgColor: '#fff7ed' },
  'r': { label: 'Sources Sought', color: '#8b5cf6', bgColor: '#faf5ff' },
  'o': { label: 'Solicitation', color: '#22c55e', bgColor: '#f0fdf4' },
  'k': { label: 'Combined', color: '#0ea5e9', bgColor: '#f0f9ff' },
  's': { label: 'Special Notice', color: '#64748b', bgColor: '#f8fafc' },
  'i': { label: 'Intent to Bundle', color: '#ec4899', bgColor: '#fdf2f8' },
  'a': { label: 'Award Notice', color: '#10b981', bgColor: '#ecfdf5' },
  // Text-based (from SAM.gov)
  'Solicitation': { label: 'Solicitation', color: '#22c55e', bgColor: '#f0fdf4' },
  'Combined Synopsis/Solicitation': { label: 'Combined', color: '#0ea5e9', bgColor: '#f0f9ff' },
  'Presolicitation': { label: 'Pre-Solicitation', color: '#f97316', bgColor: '#fff7ed' },
  'Sources Sought': { label: 'Sources Sought', color: '#8b5cf6', bgColor: '#faf5ff' },
  'Special Notice': { label: 'Special Notice', color: '#64748b', bgColor: '#f8fafc' },
  'Intent to Bundle': { label: 'Intent to Bundle', color: '#ec4899', bgColor: '#fdf2f8' },
  'Award Notice': { label: 'Award Notice', color: '#10b981', bgColor: '#ecfdf5' },
  'Justification': { label: 'Justification', color: '#f59e0b', bgColor: '#fffbeb' },
};

// SAM attachment + POC shapes are loose — SAM returns slightly
// different fields per notice, so we keep them as JSONB and let the
// UI normalize at render time.
type SamAttachment = Record<string, unknown>;
type SamPointOfContact = Record<string, unknown>;
type SamOfficeAddress = Record<string, unknown> | null;
type SamFairOpportunity = Record<string, unknown> | null;

interface RawOpportunity {
  id: string;
  notice_id: string;
  solicitation_number: string | null;
  title: string;
  description: string | null;
  description_url?: string | null;
  department: string | null;
  attachments?: SamAttachment[] | null;
  points_of_contact?: SamPointOfContact[] | null;
  office_address?: SamOfficeAddress;
  fair_opportunity?: SamFairOpportunity;
  additional_info_link?: string | null;
  additional_info_text?: string | null;
  sub_tier: string | null;
  office: string | null;
  agency_hierarchy: string | null;
  naics_code: string | null;
  psc_code: string | null;
  notice_type: string | null;
  notice_type_code: string | null;
  has_sow_doc?: boolean | null;     // #66 SOW/PWS catalog
  sow_doc_type?: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  archive_date: string | null;
  pop_city: string | null;
  pop_state: string | null;
  pop_zip: string | null;
  ui_link: string | null;
  raw_data?: Record<string, unknown> | null;
}

interface DashboardOpportunity {
  id: string;
  notice_id: string;
  solicitation_number: string | null;
  title: string;
  description: string | null;
  // Present when SAM stored the description as a separate API URL
  // instead of inline text. UI can fetch the text on demand via
  // /api/sam-description?noticeId=... and cache it back.
  description_url: string | null;
  synopsis_available?: boolean;
  department: string;
  attachments: SamAttachment[];
  points_of_contact: SamPointOfContact[];
  office_address: SamOfficeAddress;
  fair_opportunity: SamFairOpportunity;
  additional_info_link: string | null;
  additional_info_text: string | null;
  sub_tier: string | null;
  office: string | null;
  agency_hierarchy: string | null;
  naics_code: string | null;
  psc_code: string | null;
  notice_type: string | null;
  notice_type_code: string | null;
  has_sow_doc?: boolean | null;     // #66 SOW/PWS catalog
  sow_doc_type?: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  archive_date: string | null;
  pop_city: string | null;
  pop_state: string | null;
  pop_zip: string | null;
  ui_link: string | null;
  days_until_deadline: number | null;
  urgency_level: 'critical' | 'urgent' | 'normal' | 'upcoming';
}

function getUrgencyLevel(deadline: string | null): 'critical' | 'urgent' | 'normal' | 'upcoming' {
  if (!deadline) return 'upcoming';
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const daysUntil = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil <= 3) return 'critical';
  if (daysUntil <= 7) return 'urgent';
  if (daysUntil <= 14) return 'normal';
  return 'upcoming';
}

// buildSearchOr moved to the SHARED lib (@/lib/mi-dashboard/search) so this route, the OPPORTUNITY MAP
// endpoint, and the saved-search cron all use ONE implementation — including the term-of-art expansion.
// The earlier fix mistakenly lived only in a DUPLICATE copy here, so the map's Open search never got it
// (Eric 2026-07-28: "make sure the map has all the changes too"). Now consolidated — imported below.

// Keyword branches are ILIKEs carried in the PostgREST or() URL. 40+ keywords per
// user is normal; sending them all risks a 414 and adds little over NAICS+PSC.
const MAX_PROFILE_KEYWORDS = 12;

// PostgREST metacharacters that would break out of an or() branch.
const sanitizeOrValue = (v: string) => v.replace(/[%,()"\\]/g, '').trim();

/**
 * Catch-all PSC codes — the "other/miscellaneous" buckets. They carry no industry
 * signal, so widening on them drags in unrelated work.
 *
 * Measured on this profile (12 NAICS / 24 PSC, active+biddable, 2026-08-04):
 *   R499 "Other Professional Services"  75 opps across 33 distinct NAICS
 *   R425 "Engineering & Technical"      60 opps across 18
 *   R408 "Program Management/Support"   26 opps across 16
 * versus a specific code:
 *   AC13 "IT & Telecom R&D"             20 opps across  3
 *
 * Without this, an IT/cyber firm's feed picked up "Chaplaincy Services",
 * "MAINTENANCE WORKER FOR USFWS VIEQUES NWR" and a Guatemalan solar install —
 * all real R499 matches, none of them his market.
 *
 * These are not dropped: they still match when the NAICS also fits (they're OR'd
 * into the same scope via the NAICS branch). They're just not a widening key on
 * their own.
 */
const CATCH_ALL_PSC = new Set(['R499', 'R425', 'R408', 'R699', 'R799', 'D399']);

/**
 * Build the ONE combined or() filter for a user's passive profile scope.
 *
 * Returns a single PostgREST or() string covering NAICS ∪ PSC ∪ keywords, or null
 * when the profile has nothing to match on.
 *
 * CRITICAL: this must be ONE or() call. PostgREST ANDs successive .or() calls, so
 * emitting NAICS and PSC as separate .or()s means "matches a NAICS *AND* matches a
 * PSC" — strictly narrower than NAICS alone, the opposite of the intent. The same
 * trap already bit the profile-NAICS vs. search interaction (see comment below).
 */
function buildProfileScopeOr(
  naicsCodes: string[],
  pscCodes: string[],
  keywords: string[],
): string | null {
  const conditions: string[] = [];

  for (const code of naicsCodes) {
    const trimmed = sanitizeOrValue(String(code));
    if (!trimmed) continue;
    // Short codes are a family prefix (e.g. "541"); full codes match exactly.
    if (trimmed.length <= 4) conditions.push(`naics_code.like.${trimmed}%`);
    else conditions.push(`naics_code.eq.${trimmed}`);
  }

  for (const psc of pscCodes) {
    const trimmed = sanitizeOrValue(String(psc)).toUpperCase();
    if (!trimmed) continue;
    // Skip the "other/miscellaneous" buckets — they span every industry, so as a
    // standalone widening key they add noise, not reach. See CATCH_ALL_PSC.
    if (CATCH_ALL_PSC.has(trimmed)) continue;
    // PSC is hierarchical too: "R4" covers R408/R423/R425, "R425" is exact.
    if (trimmed.length <= 2) conditions.push(`psc_code.like.${trimmed}%`);
    else conditions.push(`psc_code.eq.${trimmed}`);
  }

  for (const kw of keywords) {
    const trimmed = sanitizeOrValue(kw);
    if (trimmed.length < 3) continue;
    // Title only — matching description here would drag in every passing mention
    // and swamp the code-based signal.
    conditions.push(`title.ilike.%${trimmed}%`);
  }

  return conditions.length > 0 ? conditions.join(',') : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Filters
  const search = searchParams.get('search') || '';
  const noticeType = searchParams.get('noticeType') || '';
  const agency = searchParams.get('agency') || '';
  const urgency = searchParams.get('urgency') || '';
  const setAside = searchParams.get('setAside') || '';
  let naics = searchParams.get('naics') || '';
  const state = searchParams.get('state') || '';
  // status: 'active' (default — biddable now), 'inactive' (the archive — expired/
  // closed, for recompete intel + mining old SOW/PWS), or 'all'. Mirrors SAM.gov's
  // active/inactive toggle. The 59k inactive notices are already cached; this just
  // unlocks searching them.
  const status = (searchParams.get('status') || 'active').toLowerCase();
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const mode = searchParams.get('mode') || 'list'; // list | stats | export
  const email = searchParams.get('email')?.toLowerCase().trim() || '';
  // Sort by deadline: 'soonest' (default — closing first, the bid-now view) or
  // 'furthest' (latest deadline first — plan-ahead / triage the long-lead pursuits).
  const sort = (searchParams.get('sort') || 'soonest').toLowerCase();

  // Last-good snapshot key for THIS view. Include EVERY input that changes the
  // result — crucially `email`, because a coach viewing a client scopes the feed
  // to that client's profile; a shared key would leak one user's view to another.
  const snapshotKey = `mi-dashboard:${new URLSearchParams({
    search, noticeType, agency, urgency, setAside, naics, state, status,
    page: String(page), limit: String(limit), mode, email,
  }).toString()}`;

  try {
    const supabase = getSupabase();

    // If email provided, load user's profile for filtering.
    // MUST match what /api/cron/daily-alerts matches on — NAICS *and* PSC *and*
    // keywords. Reading only naics_codes made Today's Intel a strict subset of the
    // alert email: an opp the alert found via a PSC code or a keyword had no way to
    // appear here, so users clicked through from an alert and saw nothing.
    // (marketresearch@xcelligen.com, 2026-08-04: 12 NAICS / 24 PSC / 40 keywords →
    // 76 opps since Jul 28 matched PSC-but-not-NAICS, 53 still biddable, all invisible.)
    let userNaicsCodes: string[] = [];
    let userStates: string[] = [];
    let userPscCodes: string[] = [];
    let userKeywords: string[] = [];
    if (email) {
      // Coach Mode: when a coach has switched to a client, scope the dashboard to
      // the CLIENT's profile, not the coach's (mirrors /api/app/opportunities,
      // commit f33d1df4). Without this the Market Dashboard always read the coach's
      // NAICS/states → a coach saw their own drones feed while viewing a
      // construction client (Eric, Jun 25).
      const { workspaceId: activeWsId, asClient } = await resolveActiveWorkspace(email, request);
      const profileEmail = asClient ? clientNotificationEmail(activeWsId) : email;
      const { data: profile, error: profileErr } = await supabase
        .from('user_notification_settings')
        .select('naics_codes, location_states, psc_codes, keywords')
        .eq('user_email', profileEmail)
        .maybeSingle();
      if (profileErr) console.error('[mi-dashboard] profile query error:', profileErr.message);

      if (profile?.naics_codes?.length > 0 && !naics) {
        userNaicsCodes = profile.naics_codes;
      }
      if (profile?.location_states?.length > 0 && !state) {
        userStates = profile.location_states;
      }
      // PSC + keywords widen the SAME profile scope as NAICS. An explicit ?naics=
      // filter is a deliberate narrowing, so it suppresses these too — otherwise
      // "show me 541512" would quietly return PSC/keyword matches as well.
      if (!naics) {
        userPscCodes = (profile?.psc_codes || []).filter(Boolean).map(String);
        // Cap keywords: each becomes an ILIKE branch in one PostgREST or() and the
        // whole filter rides in the URL. Users carry 40+; the long tail is noise
        // relative to NAICS/PSC, and an over-long URL 414s the whole dashboard.
        userKeywords = (profile?.keywords || [])
          .filter(Boolean)
          .map((k: unknown) => String(k).trim())
          .filter((k: string) => k.length >= 3)
          .slice(0, MAX_PROFILE_KEYWORDS);
      }
    }

    // Build base query. Status gates active vs the archive:
    //  - active   (default): biddable now — active flag + deadline in the future
    //  - inactive: the archive — closed/expired (recompete intel, old SOW/PWS mining)
    //  - all      : everything we have
    let query = supabase
      .from('sam_opportunities')
      .select('*', { count: 'exact' });
    if (status === 'inactive') {
      // Closed: explicitly inactive OR the deadline has passed.
      query = query.or(`active.eq.false,response_deadline.lt.${new Date().toISOString()}`);
    } else if (status === 'all') {
      // No active/deadline gate — full corpus.
    } else {
      // Default 'active' — biddable now.
      query = query.eq('active', true).gt('response_deadline', new Date().toISOString());
    }

    // Apply filters
    if (search) {
      // Word-boundary for code-like terms ("M7" ≠ "M776"); ILIKE for phrases.
      query = query.or(buildSearchOr(search));
    }
    // "Has SOW/PWS" (#66) — only opps with a real scope document (the serious,
    // evaluable ones). Backfilled by /api/cron/sow-catalog.
    if (searchParams.get('hasSow') === 'true') {
      query = query.eq('has_sow_doc', true);
    }
    if (noticeType) {
      query = query.eq('notice_type', noticeType);
    }
    if (agency) {
      // Match the top-tier department OR the sub-tier (service branch). `department` holds only the
      // top level ("DEPT OF DEFENSE"), so a search for "Navy"/"Army"/"Air Force" matched 0 rows —
      // those branches live in `sub_tier` (verified 2026-07-28: sub_tier ILIKE '%navy%' = 3,852 active
      // opps, department = 0). The Agency filter's "e.g. Navy" placeholder now actually works.
      const a = agency.replace(/[%,()]/g, ''); // strip PostgREST-or metachars
      query = query.or(`department.ilike.%${a}%,sub_tier.ilike.%${a}%`);
    }
    if (setAside) {
      query = query.eq('set_aside_code', setAside);
    }
    if (naics) {
      query = query.or(`naics_code.eq.${naics},naics_code.like.${naics.substring(0, 3)}%`);
    }
    // KEY FIX: when the user is actively SEARCHING (a keyword/term), DON'T trap them
    // inside their profile NAICS. PostgREST ANDs multiple .or() calls, so the
    // profile-NAICS .or() would AND with the search .or() → every cross-NAICS body
    // match (the whole point of body search — "M7" in an ordnance notice when you're
    // a services shop) got filtered out. A search is an intentional act to find
    // something specific, often OUTSIDE your usual codes. So: profile NAICS + states
    // scope the DEFAULT view; an explicit search escapes them and hits the full
    // corpus. (An explicit ?naics= / ?state= URL filter still applies — that's a
    // deliberate filter, not the passive profile.)
    const isActiveSearch = Boolean(search && search.trim());

    // Apply the user's profile scope (NAICS ∪ PSC ∪ keywords) — ONLY when not
    // actively searching. One combined or(): see buildProfileScopeOr.
    const profileScopeOr = buildProfileScopeOr(userNaicsCodes, userPscCodes, userKeywords);
    if (profileScopeOr && !isActiveSearch) {
      query = query.or(profileScopeOr);
    }
    // Location matching tests BOTH place-of-performance (pop_state, ~36% filled)
    // AND the buying office (office_address->>state, ~100% filled) — SAM often
    // omits place-of-performance, so office state widens coverage (~51% for FL).
    const explicitState = state ? normalizeStateCode(state) : null;
    if (explicitState) {
      // Explicit state filter from the URL always applies (deliberate).
      query = query.or(`pop_state.eq.${explicitState},office_address->>state.eq.${explicitState}`);
    } else if (userStates.length > 0 && !isActiveSearch) {
      // Profile-states scope the default view, but an active search escapes them too.
      const stateConditions: string[] = [];
      for (const s of userStates) {
        const st = normalizeStateCode(String(s));
        if (st) stateConditions.push(`pop_state.eq.${st}`, `office_address->>state.eq.${st}`);
      }
      if (stateConditions.length > 0) query = query.or(stateConditions.join(','));
    }

    // Stats mode - return aggregations (respects user profile filters)
    if (mode === 'stats') {
      const now = new Date().toISOString();
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Helper to build base query with user profile filters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildBaseStatsQuery = () => {
        let q = supabase
          .from('sam_opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .gt('response_deadline', now);

        // Same profile scope as the list query, or the stat tiles disagree with
        // the rows underneath them.
        if (profileScopeOr) {
          q = q.or(profileScopeOr);
        }

        // Apply state filter
        if (userStates.length > 0) {
          const stateConditions = userStates.map(s => `pop_state.eq.${s.toUpperCase()}`);
          q = q.or(stateConditions.join(','));
        }

        return q;
      };

      // Known notice types to count
      const noticeTypes = [
        'Solicitation',
        'Combined Synopsis/Solicitation',
        'Sources Sought',
        'Special Notice',
        'Presolicitation',
        'Sale of Surplus Property',
        'Intent to Bundle',
        'Award Notice',
        'Justification',
      ];

      // Build notice type count queries with profile filters
      const noticeTypeCountPromises = noticeTypes.map(type => {
        let q = supabase
          .from('sam_opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .gt('response_deadline', now)
          .eq('notice_type', type);

        if (profileScopeOr) {
          q = q.or(profileScopeOr);
        }

        // Apply state filter
        if (userStates.length > 0) {
          const stateConditions = userStates.map(s => `pop_state.eq.${s.toUpperCase()}`);
          q = q.or(stateConditions.join(','));
        }

        return q.then(({ count }: { count: number | null }) => ({ type, count: count || 0 }));
      });

      // Build urgent count query with profile filters
      const buildUrgentQuery = () => {
        let q = supabase
          .from('sam_opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .lt('response_deadline', sevenDaysFromNow)
          .gt('response_deadline', now);

        if (profileScopeOr) {
          q = q.or(profileScopeOr);
        }

        if (userStates.length > 0) {
          const stateConditions = userStates.map(s => `pop_state.eq.${s.toUpperCase()}`);
          q = q.or(stateConditions.join(','));
        }

        return q;
      };

      // Build agency sample query with profile filters
      const buildAgencySampleQuery = () => {
        let q = supabase
          .from('sam_opportunities')
          .select('department')
          .eq('active', true)
          .gt('response_deadline', now);

        if (profileScopeOr) {
          q = q.or(profileScopeOr);
        }

        if (userStates.length > 0) {
          const stateConditions = userStates.map(s => `pop_state.eq.${s.toUpperCase()}`);
          q = q.or(stateConditions.join(','));
        }

        return q.order('response_deadline', { ascending: true }).limit(1000);
      };

      const [
        { count: totalActiveCount },
        { count: urgentTotalCount },
        noticeTypeCounts,
        { data: topAgencySample }
      ] = await Promise.all([
        // Total active count (with profile filters)
        buildBaseStatsQuery(),
        // Urgent count (with profile filters)
        buildUrgentQuery(),
        // All notice type counts (with profile filters)
        Promise.all(noticeTypeCountPromises),
        // Top agencies sample (with profile filters)
        buildAgencySampleQuery()
      ]);

      // Count agencies from sample (will be representative for top agencies)
      const agencyCounts: Record<string, number> = {};
      (topAgencySample || []).forEach((row: { department: string | null }) => {
        const dept = row.department || 'Unknown';
        agencyCounts[dept] = (agencyCounts[dept] || 0) + 1;
      });

      // For accurate top agency counts, do individual counts for top 10 from sample
      const topAgenciesFromSample = Object.entries(agencyCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([dept]) => dept);

      // Get accurate counts for top agencies (with profile filters)
      const topAgencyCountPromises = topAgenciesFromSample.map(dept => {
        let q = supabase
          .from('sam_opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .gt('response_deadline', now)
          .eq('department', dept);

        if (profileScopeOr) {
          q = q.or(profileScopeOr);
        }

        if (userStates.length > 0) {
          const stateConditions = userStates.map(s => `pop_state.eq.${s.toUpperCase()}`);
          q = q.or(stateConditions.join(','));
        }

        return q.then(({ count }: { count: number | null }) => ({ department: dept, count: count || 0 }));
      });
      const topAgencies = await Promise.all(topAgencyCountPromises);
      topAgencies.sort((a, b) => b.count - a.count);

      return NextResponse.json({
        success: true,
        stats: {
          totalActive: totalActiveCount || 0,
          urgentCount: urgentTotalCount || 0,
          byNoticeType: noticeTypeCounts
            .filter(t => t.count > 0)
            .sort((a, b) => b.count - a.count)
            .map(t => ({
              code: t.type,
              label: NOTICE_TYPE_INFO[t.type]?.label || t.type,
              count: t.count,
              color: NOTICE_TYPE_INFO[t.type]?.color || '#64748b',
            })),
          topAgencies,
          bySetAside: [], // TODO: Add if needed
        },
      });
    }

    // Apply urgency filter if specified
    if (urgency === 'critical') {
      const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('response_deadline', threeDaysFromNow);
    } else if (urgency === 'urgent') {
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('response_deadline', sevenDaysFromNow);
    }

    // Order by deadline. Default 'soonest' = closing first (bid-now). 'furthest' =
    // latest deadline first (plan-ahead). nullsFirst:false keeps no-deadline rows at
    // the BOTTOM in both directions (Postgres DESC would otherwise float NULLs to top).
    query = query.order('response_deadline', {
      ascending: sort !== 'furthest',
      nullsFirst: false,
    });

    // DEDUP-BEFORE-PAGINATE (the Recompete vehicle-rollup pattern). SAM publishes
    // the same solicitation as many notices (amendments, re-posts) — measured 9.9%
    // of the active cache: 857 solicitations with >1 active row, 946 excess rows.
    // The OLD dedup ran AFTER .range() so it only collapsed dupes that happened to
    // share a page, and `count` still counted duplicates → "22 of 373" (page
    // deduped, total not). Fix: pull the filtered set as LIGHT rows (id + the
    // survivor-tiebreak columns), collapse by solicitation_number to ONE canonical
    // row, THEN paginate the deduped list and hydrate only that page to full rows.
    const SCAN_CAP = 6000; // guards a runaway no-filter scan; well above any real filtered set
    const lightCols = 'id,notice_id,solicitation_number,title,department,sub_tier,response_deadline,posted_date,has_sow_doc,description';
    // ⚠️ PostgREST hard-caps a single response at 1000 rows, so `.range(0, 5999)` silently
    // returned only the FIRST 1000 matches — in an ARBITRARY order (no `.order()` was applied).
    // That quietly broke multi-word relevance ranking: a real query like Andre's "cyber cloud
    // compliance network server" matches ~2,517 active notices, but rankSearchResults only ever
    // saw an arbitrary 1000 of them, so the genuine 4-5-term cyber/cloud opps were usually NOT
    // in the fetched slice and could never rank to page 1 (prod showed valves/septic-tanks on
    // top). Ranking can only order what it's given — so we must give it the WHOLE matching set.
    // Fix: page through the filtered set 1000 at a time up to SCAN_CAP, with a DETERMINISTIC
    // order (posted_date desc, id desc as a stable tiebreak) so pagination doesn't skip/repeat
    // rows and the freshest matches lead when the set exceeds the cap. (Eric, live 2026-08-02.)
    const PAGE = 1000;
    const lightRows: Array<Record<string, unknown>> = [];
    let lightErr: unknown = null;
    for (let off = 0; off < SCAN_CAP; off += PAGE) {
      const { data: chunk, error: chunkErr } = await query
        .select(lightCols)
        .order('posted_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(off, off + PAGE - 1);
      if (chunkErr) { lightErr = chunkErr; break; }
      if (!chunk || chunk.length === 0) break;
      lightRows.push(...(chunk as Array<Record<string, unknown>>));
      if (chunk.length < PAGE) break; // last page
    }
    if (lightErr) {
      throw lightErr;
    }

    type LightRow = {
      id: number | string;
      notice_id: string;
      solicitation_number: string | null;
      title: string | null;
      department: string | null;
      sub_tier: string | null;
      response_deadline: string | null;
      posted_date: string | null;
      has_sow_doc: boolean | null;
      description: string | null;
    };

    // Collapse duplicates. Key by solicitation_number when present; fall back to a
    // normalized title+department key for the ~1% of rows with a NULL sol# (still
    // catches title-identical re-posts). Winner = richest + most current:
    //   1) has a real scope doc (has_sow_doc) — the evaluable row
    //   2) latest response_deadline — the current amendment window
    //   3) latest posted_date — freshest posting
    //   4) longest description — most body text
    const dupeKey = (r: LightRow): string => {
      const sol = String(r.solicitation_number || '').trim();
      if (sol) return `sol:${sol.toLowerCase()}`;
      const t = String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const d = String(r.department || r.sub_tier || '').toLowerCase().trim();
      return `td:${t}|${d}`;
    };
    const rowBeats = (a: LightRow, b: LightRow): boolean => {
      const aSow = a.has_sow_doc ? 1 : 0;
      const bSow = b.has_sow_doc ? 1 : 0;
      if (aSow !== bSow) return aSow > bSow;
      const aDl = a.response_deadline || '';
      const bDl = b.response_deadline || '';
      if (aDl !== bDl) return aDl > bDl;               // latest deadline wins
      const aPost = a.posted_date || '';
      const bPost = b.posted_date || '';
      if (aPost !== bPost) return aPost > bPost;        // freshest posting
      return (a.description?.length || 0) > (b.description?.length || 0);
    };
    const canonicalByKey = new Map<string, LightRow>();
    for (const r of (lightRows || []) as LightRow[]) {
      const key = dupeKey(r);
      const prev = canonicalByKey.get(key);
      if (!prev || rowBeats(r, prev)) canonicalByKey.set(key, r);
    }
    // Preserve the server-side deadline ordering: iterate lightRows (already sorted)
    // and emit each key once, in first-seen order, using its canonical row.
    let orderedCanonical: LightRow[] = [];
    const emitted = new Set<string>();
    for (const r of (lightRows || []) as LightRow[]) {
      const key = dupeKey(r);
      if (emitted.has(key)) continue;
      emitted.add(key);
      orderedCanonical.push(canonicalByKey.get(key)!);
    }

    // RELEVANCE RANK a multi-word search across the WHOLE deduped set BEFORE paginating —
    // so the notices matching the most query terms (esp. in the title) rise to page 1, and
    // the single-weak-term body matches (a valve notice mentioning "server") sink. This is
    // the industry standard (Google / Postgres FTS / Elasticsearch: OR the terms, then rank).
    // rankSearchResults is a no-op for a single-word search, keeping the fetch/freshness order.
    if (search && queryWords(search).length > 1) {
      orderedCanonical = rankSearchResults(orderedCanonical, search);
    }

    const dedupedTotal = orderedCanonical.length;
    // Paginate the DEDUPED list, then hydrate just this page's ids to full rows.
    const offset = (page - 1) * limit;
    const pageSlice = orderedCanonical.slice(offset, offset + limit);
    const pageIds = pageSlice.map((r) => r.id);

    let opportunities: RawOpportunity[] = [];
    if (pageIds.length > 0) {
      const { data: fullRows, error: hydrateErr } = await supabase
        .from('sam_opportunities')
        // truncation-ok: .in(pageIds) hydration of ONE already-paginated page slice — bounded by the
        // page size, never a scan of the 178,436-row table.
        .select('*')
        .in('id', pageIds);
      if (hydrateErr) {
        throw hydrateErr;
      }
      // Re-order the hydrated rows to match the paginated (deadline-sorted) slice.
      const byId = new Map((fullRows || []).map((r: RawOpportunity) => [String(r.id), r]));
      opportunities = pageSlice.map((r) => byId.get(String(r.id))).filter(Boolean) as RawOpportunity[];
    }
    // Deduped count drives pagination — NOT the raw DB count (which included dupes).
    const count = dedupedTotal;

    // Transform to dashboard format
    const dashboardOpps: DashboardOpportunity[] = ((opportunities || []) as RawOpportunity[]).map((opp: RawOpportunity) => {
      const deadline = opp.response_deadline;
      const daysUntil = deadline
        ? Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      // SAM.gov stores most descriptions as a separate URL pointer
      // (api.sam.gov/.../noticedesc?noticeid=...). When that's the
      // case we surface it as description_url so the UI can offer a
      // "Load full description" button that lazy-fetches the real
      // text. When description is real inline text, we pass it
      // through. description_url from the column (if separately
      // populated) is honored too.
      const rawDescription = typeof opp.description === 'string' ? opp.description.trim() : null;
      const rawData = opp.raw_data;
      const rawDataDesc = typeof rawData?.description === 'string' ? rawData.description.trim() : null;
      const descriptionIsUrl = !!rawDescription && /^https?:\/\//i.test(rawDescription);
      const rawDataDescIsUrl = !!rawDataDesc && /^https?:\/\//i.test(rawDataDesc);
      // Some rows were cached before the HTML→text helper landed and
      // still hold raw SAM markup (<p>, <li>, &nbsp;, etc.). Clean
      // on read so the UI never sees raw tags, regardless of when
      // the row was synced.
      const cleanedDescription = rawDescription && !descriptionIsUrl && looksLikeHtml(rawDescription)
        ? samHtmlToText(rawDescription)
        : rawDescription && !descriptionIsUrl
        ? rawDescription
        : null;
      const description = cleanedDescription;
      const description_url = descriptionIsUrl
        ? rawDescription
        : rawDataDescIsUrl
        ? rawDataDesc
        : (typeof opp.description_url === 'string' ? opp.description_url : null);
      const synopsis_available = !!(description || description_url || opp.notice_id);

      return {
        id: opp.id,
        notice_id: opp.notice_id,
        solicitation_number: opp.solicitation_number,
        title: opp.title,
        description,
        description_url,
        synopsis_available,
        department: opp.department || 'Unknown Agency',
        sub_tier: opp.sub_tier,
        office: opp.office,
        agency_hierarchy: opp.agency_hierarchy,
        naics_code: opp.naics_code,
        psc_code: opp.psc_code,
        notice_type: opp.notice_type,
        notice_type_code: opp.notice_type_code,
        has_sow_doc: opp.has_sow_doc,        // #66 SOW/PWS catalog
        sow_doc_type: opp.sow_doc_type,
        set_aside_code: opp.set_aside_code,
        set_aside_description: opp.set_aside_description,
        posted_date: opp.posted_date,
        response_deadline: opp.response_deadline,
        archive_date: opp.archive_date,
        pop_city: opp.pop_city,
        pop_state: opp.pop_state,
        pop_zip: opp.pop_zip,
        ui_link: opp.ui_link,
        attachments: Array.isArray(opp.attachments) ? opp.attachments : [],
        points_of_contact: Array.isArray(opp.points_of_contact) ? opp.points_of_contact : [],
        office_address: opp.office_address ?? null,
        fair_opportunity: opp.fair_opportunity ?? null,
        additional_info_link: typeof opp.additional_info_link === 'string' ? opp.additional_info_link : null,
        additional_info_text: typeof opp.additional_info_text === 'string' ? opp.additional_info_text : null,
        days_until_deadline: daysUntil,
        urgency_level: getUrgencyLevel(deadline),
      };
    });

    // Dedup already happened upstream (by solicitation_number, BEFORE pagination),
    // so this page's rows are already unique — no post-pagination filtering needed.
    const payload = {
      success: true,
      opportunities: dashboardOpps,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
      noticeTypeInfo: NOTICE_TYPE_INFO,
    };

    // Store this successful list response as the last-good snapshot so a future
    // outage serves it (see catch). Fire-and-forget — never block the response.
    saveSnapshot(snapshotKey, payload).catch(() => {});

    return NextResponse.json({ ...payload, ...freshMeta() });

  } catch (err) {
    console.error('[mi-dashboard] Error:', err);

    // GRACEFUL DEGRADATION: on a DB outage, serve this view's last SUCCESSFUL
    // response (from KV, which survives a Supabase outage) with an honest
    // "as of {time}" banner instead of a 500 + empty panel. Only fall through to
    // the error when we have NO snapshot yet for this view.
    const raw = err instanceof Error ? err.message : '';
    const isUpstreamTimeout = /522|timed out|connection|fetch failed|ECONNRESET|EAI_AGAIN|network/i.test(raw) || raw.trim().startsWith('<');
    if (isUpstreamTimeout) {
      const snap = await readSnapshot<Record<string, unknown>>(snapshotKey);
      if (snap) {
        return NextResponse.json(
          { ...snap.data, ...degradedMeta(snap.savedAt) },
          { status: 200, headers: { 'x-mindy-degraded': '1' } }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: isUpstreamTimeout ? 'The opportunities database is temporarily unavailable. Please try again.' : (err instanceof Error ? err.message : 'Unknown error'),
        retryable: isUpstreamTimeout,
      },
      { status: isUpstreamTimeout ? 503 : 500 }
    );
  }
}
