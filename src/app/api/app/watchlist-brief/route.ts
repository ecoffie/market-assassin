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

const ZERO_TOTALS = { newListings: 0, marketValue: 0, closingToday: 0, searchCount: 0 };

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
  const out: Array<{
    id: string; name: string; naics: string[]; agencies: string[];
    alert_frequency: string; alerts_enabled: boolean;
    newCount: number; matchedCount: number; marketValue: number; closingToday: number; capped: boolean;
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
      .select('notice_id, response_deadline, intel_value_range, department, sub_tier')
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
    for (const r of rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = r as any;
      const nid = row.notice_id as string | null;
      // "new" = not previously seen — only when the search was ever baselined (matches the badge rule).
      if (seen.size && nid && !seen.has(nid)) newCount++;
      // marketValue = SUM of grounded M-Estimate medians; a null/absent/≤0 median is skipped (not $0).
      const median = row.intel_value_range && typeof row.intel_value_range.median === 'number'
        ? row.intel_value_range.median : 0;
      if (Number.isFinite(median) && median > 0) marketValue += median;
      // closingToday = deadline's calendar day equals the server's today (Y-M-D compare).
      const dl = row.response_deadline as string | null;
      if (dl) { const d = new Date(dl); if (!Number.isNaN(d.getTime()) && ymd(d) === today) closingToday++; }
    }

    out.push({
      id: String(sf.id),
      name: String(sf.name ?? ''),
      naics: splitCsv(rawFilters.naics),
      agencies: splitCsv(rawFilters.agency ?? rawFilters.agencies),
      alert_frequency: typeof sf.alert_frequency === 'string' ? sf.alert_frequency : 'daily',
      alerts_enabled: sf.alerts_enabled !== false,
      newCount, matchedCount, marketValue, closingToday, capped,
    });

    totals.newListings += newCount;
    totals.marketValue += marketValue;
    totals.closingToday += closingToday;
  }
  totals.searchCount = out.length;

  return NextResponse.json({ success: true, searches: out, totals });
}
