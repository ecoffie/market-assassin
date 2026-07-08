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

/**
 * Build the PostgREST .or() clause for a search term across title/description/dept.
 *
 * WORD-BOUNDARY for code-like terms: "M7" should match the TOKEN "M7" (and "M-7",
 * "M 7"), NOT "M776"/"M700". A bare ILIKE %m7% substring-matches those longer codes
 * → noise. So for short, code-like tokens (digits present, no spaces, <=8 chars) we
 * use a case-insensitive regex with word boundaries (Postgres \m … \M) that also
 * tolerates an optional separator between the letter run and the digit run
 * (M7 ≈ M-7 ≈ M 7). Normal phrases ("contractor shall", "solar") keep plain ILIKE —
 * substring is the right behavior there and regex-escaping free text is risky.
 */
function buildSearchOr(search: string): string {
  const term = search.trim();
  // Search corpus, richest last: title + SAM description body + the extracted
  // SOW/PWS scope text (sow_text, a column on sam_opportunities) + department.
  // sow_text is the deepest layer — the actual requirements doc — so a term like
  // "M7" buried in a Statement of Work surfaces even when neither title nor the
  // short SAM description mentions it. Same row, so it's a plain column add.
  const cols = ['title', 'description', 'sow_text', 'department'];

  // Code-like? e.g. M7, M-7, 1005, 53-1234, AN/PVS-7. Has a digit, no whitespace,
  // short, and not a plain word.
  const isCodeLike = /\d/.test(term) && !/\s/.test(term) && term.length <= 8;

  if (isCodeLike) {
    // Escape regex metachars, then allow an optional [-/ ._]? where the original had
    // a separator OR at the letter→digit / digit→letter seam, so M7 matches M-7 etc.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexible = escaped
      .replace(/[-/_. ]+/g, '[-/_. ]?')                 // existing separators → optional
      .replace(/([A-Za-z])(?=\d)/g, '$1[-/_. ]?')        // letter→digit seam
      .replace(/(\d)(?=[A-Za-z])/g, '$1[-/_. ]?');       // digit→letter seam
    // \m … \M = word boundaries. imatch = case-insensitive regex (PostgREST).
    const pattern = `\\m${flexible}\\M`;
    return cols.map((c) => `${c}.imatch.${pattern}`).join(',');
  }

  // Normal phrase → substring ILIKE.
  return cols.map((c) => `${c}.ilike.%${term}%`).join(',');
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

    // If email provided, load user's profile for filtering (NAICS + location_states)
    let userNaicsCodes: string[] = [];
    let userStates: string[] = [];
    if (email) {
      // Coach Mode: when a coach has switched to a client, scope the dashboard to
      // the CLIENT's profile, not the coach's (mirrors /api/app/opportunities,
      // commit f33d1df4). Without this the Market Dashboard always read the coach's
      // NAICS/states → a coach saw their own drones feed while viewing a
      // construction client (Eric, Jun 25).
      const { workspaceId: activeWsId, asClient } = await resolveActiveWorkspace(email, request);
      const profileEmail = asClient ? clientNotificationEmail(activeWsId) : email;
      const { data: profile } = await supabase
        .from('user_notification_settings')
        .select('naics_codes, location_states')
        .eq('user_email', profileEmail)
        .maybeSingle();

      if (profile?.naics_codes?.length > 0 && !naics) {
        userNaicsCodes = profile.naics_codes;
      }
      if (profile?.location_states?.length > 0 && !state) {
        userStates = profile.location_states;
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
      query = query.ilike('department', `%${agency}%`);
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

    // Apply user's profile NAICS codes — ONLY when not actively searching.
    if (userNaicsCodes.length > 0 && !isActiveSearch) {
      // OR across the user's codes: prefix match for short codes, exact for full.
      const conditions: string[] = [];
      for (const code of userNaicsCodes) {
        const trimmed = String(code).trim();
        if (trimmed.length <= 4) {
          conditions.push(`naics_code.like.${trimmed}%`);
        } else {
          conditions.push(`naics_code.eq.${trimmed}`);
        }
      }
      if (conditions.length > 0) {
        query = query.or(conditions.join(','));
      }
    }
    if (state) {
      // Explicit state filter from the URL always applies (deliberate).
      query = query.eq('pop_state', state.toUpperCase());
    } else if (userStates.length > 0 && !isActiveSearch) {
      // Profile-states scope the default view, but an active search escapes them too.
      const stateConditions = userStates.map(s => `pop_state.eq.${s.toUpperCase()}`);
      query = query.or(stateConditions.join(','));
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

        // Apply NAICS filter
        if (userNaicsCodes.length > 0) {
          const conditions: string[] = [];
          for (const code of userNaicsCodes) {
            const trimmed = String(code).trim();
            if (trimmed.length <= 4) {
              conditions.push(`naics_code.like.${trimmed}%`);
            } else {
              conditions.push(`naics_code.eq.${trimmed}`);
            }
          }
          if (conditions.length > 0) {
            q = q.or(conditions.join(','));
          }
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

        // Apply NAICS filter
        if (userNaicsCodes.length > 0) {
          const conditions: string[] = [];
          for (const code of userNaicsCodes) {
            const trimmed = String(code).trim();
            if (trimmed.length <= 4) {
              conditions.push(`naics_code.like.${trimmed}%`);
            } else {
              conditions.push(`naics_code.eq.${trimmed}`);
            }
          }
          if (conditions.length > 0) {
            q = q.or(conditions.join(','));
          }
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

        if (userNaicsCodes.length > 0) {
          const conditions: string[] = [];
          for (const code of userNaicsCodes) {
            const trimmed = String(code).trim();
            if (trimmed.length <= 4) {
              conditions.push(`naics_code.like.${trimmed}%`);
            } else {
              conditions.push(`naics_code.eq.${trimmed}`);
            }
          }
          if (conditions.length > 0) {
            q = q.or(conditions.join(','));
          }
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

        if (userNaicsCodes.length > 0) {
          const conditions: string[] = [];
          for (const code of userNaicsCodes) {
            const trimmed = String(code).trim();
            if (trimmed.length <= 4) {
              conditions.push(`naics_code.like.${trimmed}%`);
            } else {
              conditions.push(`naics_code.eq.${trimmed}`);
            }
          }
          if (conditions.length > 0) {
            q = q.or(conditions.join(','));
          }
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

        if (userNaicsCodes.length > 0) {
          const conditions: string[] = [];
          for (const code of userNaicsCodes) {
            const trimmed = String(code).trim();
            if (trimmed.length <= 4) {
              conditions.push(`naics_code.like.${trimmed}%`);
            } else {
              conditions.push(`naics_code.eq.${trimmed}`);
            }
          }
          if (conditions.length > 0) {
            q = q.or(conditions.join(','));
          }
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
    const { data: lightRows, error: lightErr } = await query
      .select(lightCols)
      .range(0, SCAN_CAP - 1);
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
    const orderedCanonical: LightRow[] = [];
    const emitted = new Set<string>();
    for (const r of (lightRows || []) as LightRow[]) {
      const key = dupeKey(r);
      if (emitted.has(key)) continue;
      emitted.add(key);
      orderedCanonical.push(canonicalByKey.get(key)!);
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
