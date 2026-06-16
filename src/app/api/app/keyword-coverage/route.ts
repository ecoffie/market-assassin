import { NextRequest, NextResponse } from 'next/server';
import { keywordCoverage } from '@/lib/market/keyword-coverage';

/**
 * GET /api/app/keyword-coverage?keyword=demolition
 *
 * Lightweight coverage summary for a single keyword — powers the dashboard
 * "Your targeting" card's market context. Returns the total market, the ~90%
 * coverage code count, and the top PSC buckets ("what was actually bought").
 *
 * Every number reconciles with a USASpending keyword search on the same term —
 * that's the point: the user can fact-check it. Read-only, no auth (the numbers
 * are public USASpending aggregates; no user data is returned).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword')?.trim();
  if (!keyword) {
    return NextResponse.json({ error: 'keyword required' }, { status: 400 });
  }

  const cov = await keywordCoverage(keyword).catch(() => null);
  if (!cov) {
    return NextResponse.json({ coverage: null });
  }

  return NextResponse.json({
    coverage: {
      keyword: cov.keyword,            // the term actually searched (may broaden, e.g. "demolition services" -> "demolition")
      totalMarket: cov.totalMarket,    // $ across the whole market for this keyword
      naicsCount: cov.naicsCount,      // distinct NAICS that bought it
      coverageCount: cov.coverageCodes.length, // codes covering ~90%
      coveragePct: cov.coveragePct,    // what those codes capture (~0.9)
      // "What was bought" — the sub-markets a single keyword spans (building demo
      // vs ordnance-facility work, etc.). Top 5 PSCs with dollars.
      topPsc: cov.topPscList,
    },
  });
}
