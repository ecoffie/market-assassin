/**
 * GET /api/app/watchlist-brief?email=  — the "Morning Brief" for a user's saved searches.
 *
 * Runs each of the caller's OPEN saved searches ONCE server-side and returns grounded
 * per-search aggregates + KPI totals. It REUSES the exact matching engine the saved-searches
 * ?badge=1 block and the alert cron use (parseMapFilters → applyMapFilters on sam_opportunities)
 * so the "new" count here can never drift from the badge, and no number is fabricated:
 *   - matchedCount  = matches returned for the saved filter set (capped at 300; capped:true at the cap)
 *   - newCount      = matches whose notice_id ∉ last_seen_notice_ids, ONLY if the search was baselined
 *                     (seen.size > 0) — identical rule to the ?badge=1 count
 *   - marketValue   = SUM of intel_value_range.median over matches, ONLY when it's a finite >0 number
 *                     (nulls are skipped — a null M-Estimate is UNKNOWN, never treated as $0)
 *   - closingToday  = matches whose response_deadline date === the server's today (Y-M-D compare)
 *   - closingWeek   = matches whose response_deadline is within the next 7 days (today..+7, inclusive)
 *   - story         = grounded opportunity_dna_keys strand tallies over the matched rows:
 *                     { repeat_buyer, sb_friendly, early_stage (sources_sought OR early_cycle),
 *                       closes_soon } — a row's opportunity_dna_keys is a TEXT[] that may be empty
 *                     (that row just contributes nothing).
 *   - changes       = grounded RECENT-CHANGE tallies from pursuit_change_log — the pursuit-changes
 *                     cron diffs live SAM vs a snapshot and writes real change rows. For THIS caller,
 *                     over the search's matched notice_ids, we count unacknowledged rows in the last
 *                     7 days whose change_type ∈ {amendment, deadline, notice_type, cancelled,
 *                     awarded, new_docs}. 'closed' is deliberately EXCLUDED (a closed opp isn't a
 *                     change to act on). changeCount is the total; changeTop is the single most
 *                     important type present. Render-when-real: when changeCount is 0 the UI OMITS
 *                     the line entirely — never a fabricated "0 amendments". (This is NOT built off
 *                     last_modified, which is 100% NULL on active opps — the diff log is the source.)
 *
 * MI-token authed exactly like the saved-searches GET (requireMIAuthSession).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getAppSupabase, normalizeEmail } from '@/lib/app/workspace';
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Missing-table guard: return empty (not 500) so the page still works pre-migration.
function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || (error.message || '').includes('saved_searches'));
}

const MATCH_CAP = 300;

// Local Y-M-D so "closing today" compares against the SERVER's calendar day, not a UTC-shifted one.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// filters is a flat string map (the saved-search `filters` JSON). NAICS/agencies may be comma-joined —
// split to a clean array, the same way parseMapFilters reads the raw string values.
function splitCsv(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
}

const ZERO_TOTALS = { newListings: 0, marketValue: 0, closingToday: 0, closingWeek: 0, searchCount: 0 };

// Grounded "Today's Story" strand object — tallied from opportunity_dna_keys over matched rows.
// early_stage absorbs BOTH sources_sought and early_cycle (a row carrying either counts once).
// No amendment strand — last_modified is 100% NULL on active opps, so it isn't groundable.
type StoryCounts = { repeat_buyer: number; sb_friendly: number; early_stage: number; closes_soon: number };
function emptyStory(): StoryCounts {
  return { repeat_buyer: 0, sb_friendly: 0, early_stage: 0, closes_soon: 0 };
}

// Recent-change strand — grounded from pursuit_change_log (the pursuit-changes cron's real diff log),
// scoped to THIS user's matched notices. 'closed' is EXCLUDED (not an amendment/change to act on).
// Priority order = which type headlines the line when several are present (most actionable first).
const CHANGE_TYPES = ['cancelled', 'awarded', 'amendment', 'deadline', 'notice_type', 'new_docs'] as const;
type ChangeType = (typeof CHANGE_TYPES)[number];
type ChangeInfo = { changeCount: number; changeTop: ChangeType | null; byType: Record<string, number> };
function emptyChanges(): ChangeInfo {
  return { changeCount: 0, changeTop: null, byType: {} };
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const supabase = getAppSupabase();

  const { data: searches, error } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('user_email', normalizeEmail(email))
    .eq('mode', 'open')
    .order('created_at', { ascending: false });

  if (error) {
    if (tableMissing(error)) return NextResponse.json({ success: true, searches: [], totals: { ...ZERO_TOTALS } });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const today = ymd(new Date());
  // The 7-day window END (inclusive) — a deadline strictly after this is NOT "closing this week".
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndYmd = ymd(weekEnd);
  const out: Array<{
    id: string; name: string; naics: string[]; agencies: string[];
    alert_frequency: string; alerts_enabled: boolean;
    newCount: number; matchedCount: number; marketValue: number;
    closingToday: number; closingWeek: number; capped: boolean; story: StoryCounts; changes: ChangeInfo;
  }> = [];
  const totals = { ...ZERO_TOTALS };

  // Sequential — there are typically <20 saved searches per user, and each fetch is capped at 300 rows.
  for (const s of searches || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sf = s as any;
    const rawFilters: Record<string, unknown> =
      sf.filters && typeof sf.filters === 'object' && !Array.isArray(sf.filters) ? sf.filters : {};
    const seen = new Set<string>(Array.isArray(sf.last_seen_notice_ids) ? sf.last_seen_notice_ids : []);

    const f = parseMapFilters((k) => (rawFilters as Record<string, string>)?.[k] ?? null);
    f.postedDays = f.postedDays || 30;

    let q = supabase
      .from('sam_opportunities')
      .select('notice_id, response_deadline, intel_value_range, department, sub_tier, opportunity_dna_keys, notice_type')
      .limit(MATCH_CAP);
    q = applyMapFilters(q, f);
    const { data: matches, error: qErr } = await q.order('posted_date', { ascending: false });
    if (qErr) return NextResponse.json({ success: false, error: qErr.message }, { status: 500 });

    const rows = matches || [];
    const matchedCount = rows.length;
    const capped = matchedCount === MATCH_CAP;

    let newCount = 0;
    let marketValue = 0;
    let closingToday = 0;
    let closingWeek = 0;
    const story = emptyStory();
    const matchedNoticeIds: string[] = [];
    for (const r of rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = r as any;
      const nid = row.notice_id as string | null;
      if (nid) matchedNoticeIds.push(nid);
      // "new" = not previously seen — only when the search was ever baselined (matches the badge rule).
      if (seen.size && nid && !seen.has(nid)) newCount++;
      // marketValue = SUM of grounded M-Estimate medians; a null/absent/≤0 median is skipped (not $0).
      const median = row.intel_value_range && typeof row.intel_value_range.median === 'number'
        ? row.intel_value_range.median : 0;
      if (Number.isFinite(median) && median > 0) marketValue += median;
      // closingToday = deadline's calendar day equals the server's today (Y-M-D compare).
      // closingWeek = deadline's calendar day falls in [today, today+7] inclusive (Y-M-D compare).
      const dl = row.response_deadline as string | null;
      if (dl) {
        const d = new Date(dl);
        if (!Number.isNaN(d.getTime())) {
          const dy = ymd(d);
          if (dy === today) closingToday++;
          if (dy >= today && dy <= weekEndYmd) closingWeek++;
        }
      }
      // Today's Story strands — grounded from opportunity_dna_keys (TEXT[]; may be empty → skip).
      // early_stage counts a row ONCE if it carries sources_sought OR early_cycle (absorb).
      const keys: string[] = Array.isArray(row.opportunity_dna_keys) ? row.opportunity_dna_keys : [];
      if (keys.includes('repeat_buyer')) story.repeat_buyer++;
      if (keys.includes('sb_friendly')) story.sb_friendly++;
      if (keys.includes('sources_sought') || keys.includes('early_cycle')) story.early_stage++;
      if (keys.includes('closes_soon')) story.closes_soon++;
    }

    // Recent CHANGES for this search — grounded from pursuit_change_log (the diff cron's real rows),
    // scoped to THIS caller + THIS search's matched notices, unacknowledged, last 7 days, excluding
    // 'closed'. Render-when-real: an empty result yields changeCount 0 → the UI omits the line.
    const changes = emptyChanges();
    if (matchedNoticeIds.length) {
      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: chg, error: chgErr } = await supabase
        .from('pursuit_change_log')
        .select('change_type')
        .eq('user_email', email)
        .eq('acknowledged', false)
        .gte('detected_at', sinceIso)
        .in('change_type', CHANGE_TYPES as unknown as string[])
        .in('notice_id', matchedNoticeIds);
      if (chgErr) return NextResponse.json({ success: false, error: chgErr.message }, { status: 500 });
      for (const c of chg || []) {
        const ct = (c as { change_type?: string }).change_type;
        if (ct) { changes.byType[ct] = (changes.byType[ct] || 0) + 1; changes.changeCount++; }
      }
      // changeTop = the highest-priority type actually present (drives the single UI line).
      for (const t of CHANGE_TYPES) { if (changes.byType[t]) { changes.changeTop = t; break; } }
    }

    out.push({
      id: String(sf.id),
      name: String(sf.name ?? ''),
      naics: splitCsv(rawFilters.naics),
      agencies: splitCsv(rawFilters.agency ?? rawFilters.agencies),
      alert_frequency: typeof sf.alert_frequency === 'string' ? sf.alert_frequency : 'daily',
      alerts_enabled: sf.alerts_enabled !== false,
      newCount, matchedCount, marketValue, closingToday, closingWeek, capped, story, changes,
    });

    totals.newListings += newCount;
    totals.marketValue += marketValue;
    totals.closingToday += closingToday;
    totals.closingWeek += closingWeek;
  }
  totals.searchCount = out.length;

  return NextResponse.json({ success: true, searches: out, totals });
}
