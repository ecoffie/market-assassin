/**
 * /api/sba-goaling
 *
 * Returns the SBA Small Business Goaling Report breakdown for a
 * federal agency. Used by the AgencyDrawer "Small Business Mix"
 * section.
 *
 * GET ?agency=<name>[&fy=2023]
 *
 * Matches loosely: the user might pass "Department of Defense" but
 * the SBA dataset stores it as "DEFENSE, DEPARTMENT OF" (their CSV
 * uses inverted-name format with a comma). We normalize both sides
 * to bare lowercase words and do a substring match.
 *
 * Response:
 *   {
 *     success: true,
 *     fiscal_year: 2023,
 *     funding_department: "DEFENSE, DEPARTMENT OF",
 *     total: 200000000000,
 *     categories: [
 *       { category, dollars, pct }, ...
 *     ],
 *     small_business_share: 0.24,  // sum of non-"Not a Small Business"
 *   }
 *
 * Or { success: false, error } if no match found.
 *
 * Cached forever at the edge (data is a fiscal-year snapshot; the
 * import script overwrites when a new FY publishes).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_FY = 2023;

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

interface GoalingRow {
  fiscal_year: number;
  funding_department: string;
  category: string;
  dollars: number;
  total: number;
  pct: number;
}

/**
 * Normalize an agency name for fuzzy matching.
 * "Department of Defense" → "defense"
 * "DEFENSE, DEPARTMENT OF" → "defense"
 * "DEPT OF THE ARMY" → "army"
 *
 * Strips: leading/trailing whitespace, "department of", "dept of",
 * "the ", commas. Lowercases everything. The remaining bare tokens
 * are joined with spaces.
 *
 * Not a perfect canonicalizer — agencies like "HHS" vs "Health and
 * Human Services" won't match. But for the 8-row drawer view this
 * is good enough.
 */
function normalizeAgency(name: string): string {
  return name
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\bdepartment of\b/g, '')
    .replace(/\bdept(\.|of)?\b/g, '')
    .replace(/\bthe\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const agency = url.searchParams.get('agency')?.trim();
  const fyParam = url.searchParams.get('fy');
  const fiscalYear = fyParam ? Number(fyParam) : DEFAULT_FY;

  if (!agency) {
    return NextResponse.json({ error: 'agency is required' }, { status: 400 });
  }
  if (Number.isNaN(fiscalYear)) {
    return NextResponse.json({ error: 'fy must be a number' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Pull ALL rows for the FY and do client-side fuzzy match. There
  // are ~200 rows total per FY (25 agencies × 8 categories) so the
  // payload is tiny and fuzzy matching beats Postgres LIKE for the
  // "Department of X" vs "X, DEPARTMENT OF" name flip.
  const { data: allRows, error } = await supabase
    .from('sba_goaling')
    .select('*')
    .eq('fiscal_year', fiscalYear);

  if (error) {
    console.warn('[sba-goaling] supabase error:', error);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }

  if (!allRows || allRows.length === 0) {
    return NextResponse.json({
      success: false,
      error: `No SBA Goaling data loaded for FY${fiscalYear}. Run scripts/import-sba-goaling.js`,
    }, { status: 404 });
  }

  // Find the best agency match. Strategy: normalize both sides,
  // look for one where normalized strings share substring in either
  // direction. Returns the first matching department.
  const wanted = normalizeAgency(agency);
  let matchedDept: string | null = null;
  const rows = allRows as GoalingRow[];

  for (const r of rows) {
    const candidate = normalizeAgency(r.funding_department);
    if (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate)) {
      matchedDept = r.funding_department;
      break;
    }
  }

  if (!matchedDept) {
    return NextResponse.json({
      success: false,
      error: `No SBA Goaling data for agency "${agency}" in FY${fiscalYear}`,
      tried_normalized: wanted,
    }, { status: 404 });
  }

  const deptRows = rows.filter((r) => r.funding_department === matchedDept);

  // The 8 rows for this agency. Sort by dollars desc so the UI gets
  // the breakdown in rank order (Not a Small Business is typically
  // largest, followed by Other Small Business, then the
  // socioeconomic categories).
  const categories = deptRows
    .map((r) => ({
      category: r.category,
      dollars: r.dollars,
      pct: r.pct,
    }))
    .sort((a, b) => b.dollars - a.dollars);

  const total = deptRows[0]?.total || 0;

  // Small-business share = everything EXCEPT "Not a Small Business".
  // The user-facing "X% of agency spend goes to small businesses"
  // is the headline number for the drawer section.
  const nonSmallBiz = deptRows.find((r) => r.category === 'Not a Small Business');
  const smallBusinessShare = nonSmallBiz && total > 0
    ? 1 - (nonSmallBiz.dollars / total)
    : 0;

  return NextResponse.json({
    success: true,
    fiscal_year: fiscalYear,
    funding_department: matchedDept,
    total,
    categories,
    small_business_share: smallBusinessShare,
  });
}
