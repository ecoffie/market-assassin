/**
 * /api/sba-goaling/bulk
 *
 * Bulk version of /api/sba-goaling for the agency table use case.
 * Takes an array of agency names and returns a map of
 *   { normalized_name: { small_business_share, total, matched_dept } }
 * for every name that found a match. Names without a match are
 * absent from the response (caller treats missing as "no data").
 *
 * Why bulk: the AgencyTable renders 96 rows. Calling the per-agency
 * endpoint 96 times would be wasteful — 96 separate Supabase queries
 * + 96 round trips. This endpoint runs ONE Supabase query (all
 * Goaling rows for the FY) and does the fuzzy match client-side,
 * which is fast given the dataset is ~200 rows total.
 *
 * POST body:
 *   { agencies: string[], fy?: number }
 *
 * Response:
 *   {
 *     success: true,
 *     fiscal_year: 2023,
 *     matches: {
 *       "Department of Defense": {
 *         matched_dept: "DEPT OF DEFENSE",
 *         small_business_share: 0.243,
 *         total: 365290000000
 *       },
 *       "Department of Transportation": { ... },
 *       // Agencies without a match are omitted entirely
 *     },
 *     coverage: { requested: 96, matched: 24 }
 *   }
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
 * Normalize an agency name for fuzzy matching. Same logic as the
 * single-agency endpoint — kept in sync intentionally rather than
 * deduped into a shared module so it's easy to inline-tune per
 * endpoint if matching ever needs to diverge.
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

export async function POST(request: NextRequest) {
  let body: { agencies?: string[]; fy?: number } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const agencies = Array.isArray(body.agencies) ? body.agencies.filter(Boolean) : [];
  const fiscalYear = typeof body.fy === 'number' ? body.fy : DEFAULT_FY;

  if (agencies.length === 0) {
    return NextResponse.json({ error: 'agencies[] required' }, { status: 400 });
  }

  // Fetch ALL goaling rows for the FY. Tiny payload (~200 rows).
  const supabase = getSupabase();
  const { data: allRows, error } = await supabase
    .from('sba_goaling')
    .select('*')
    .eq('fiscal_year', fiscalYear);

  if (error) {
    console.warn('[sba-goaling/bulk] supabase error:', error);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }

  const rows = (allRows || []) as GoalingRow[];

  // Build a per-department aggregate first: total + non-SB dollars,
  // so we can compute small_business_share = 1 - (nonSB / total).
  // The CSV repeats `total` on every row for the same department,
  // so we just track which department we've seen.
  const deptStats = new Map<string, { total: number; nonSb: number; normalized: string }>();
  for (const r of rows) {
    const dept = r.funding_department;
    if (!deptStats.has(dept)) {
      deptStats.set(dept, {
        total: r.total,
        nonSb: 0,
        normalized: normalizeAgency(dept),
      });
    }
    if (r.category === 'Not a Small Business') {
      const stats = deptStats.get(dept)!;
      stats.nonSb = r.dollars;
    }
  }

  // For each requested agency, find the best department match.
  const matches: Record<string, {
    matched_dept: string;
    small_business_share: number;
    total: number;
  }> = {};

  for (const requested of agencies) {
    const wanted = normalizeAgency(requested);
    if (!wanted) continue;
    if (matches[requested]) continue; // Already matched (dupe in input)

    let bestMatch: string | null = null;
    for (const [dept, stats] of deptStats.entries()) {
      // Match if normalized strings share substring either direction.
      if (
        stats.normalized === wanted ||
        stats.normalized.includes(wanted) ||
        wanted.includes(stats.normalized)
      ) {
        bestMatch = dept;
        break;
      }
    }

    if (bestMatch) {
      const stats = deptStats.get(bestMatch)!;
      const sbShare = stats.total > 0 ? 1 - (stats.nonSb / stats.total) : 0;
      matches[requested] = {
        matched_dept: bestMatch,
        small_business_share: sbShare,
        total: stats.total,
      };
    }
  }

  return NextResponse.json({
    success: true,
    fiscal_year: fiscalYear,
    matches,
    coverage: {
      requested: agencies.length,
      matched: Object.keys(matches).length,
    },
  });
}
