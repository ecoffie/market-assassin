import { NextRequest, NextResponse } from 'next/server';
import { keywordCoverage } from '@/lib/market/keyword-coverage';

/**
 * GET /api/app/keyword-coverage?keyword=demolition&have=562910,236220
 *
 * Coverage summary for a single keyword — powers the "Your targeting" card. Returns
 * the total market, the ~90% coverage set, the top PSC buckets ("what was actually
 * bought"), AND — when `have` (the user's current NAICS) is passed — a GAP analysis:
 * which of the high-value coverage codes the user already tracks vs. is MISSING, plus
 * the % of the market their current codes actually capture.
 *
 * "Full coverage" = holding the smallest set of codes that captures ~90% of the
 * keyword's spend (NOT all 68 codes with any spend — that's noise). Missing codes are
 * the ones in that ~90% set the user doesn't have, ranked by dollars, so they can
 * confirm full coverage and add the gaps.
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

  // The user's current NAICS codes (optional) — used to compute the gap.
  const have = new Set(
    (request.nextUrl.searchParams.get('have') || '')
      .split(',').map((c) => c.trim()).filter(Boolean),
  );

  const cov = await keywordCoverage(keyword).catch(() => null);
  if (!cov) {
    return NextResponse.json({ coverage: null });
  }

  // GAP analysis against the ~90%-coverage set ("full coverage" = these codes).
  // For each, mark have/missing and carry the $ + market share so the UI can rank.
  const byCode = new Map(cov.allNaics.map((n) => [n.code, n]));
  const coverageDetail = cov.coverageCodes.map((code) => {
    const n = byCode.get(code);
    return {
      code,
      name: n?.name || code,
      amount: n?.amount || 0,
      pct: n?.pct || 0,        // share of the FULL market this one code is
      have: have.size > 0 ? have.has(code) : true, // if no `have`, treat all as held
    };
  });
  const missing = coverageDetail.filter((c) => !c.have);
  // What % of the full market the user's CURRENT codes actually capture.
  const heldPct = have.size > 0
    ? coverageDetail.filter((c) => c.have).reduce((s, c) => s + c.pct, 0)
    : cov.coveragePct;

  return NextResponse.json({
    coverage: {
      keyword: cov.keyword,            // the term actually searched (may broaden, e.g. "demolition services" -> "demolition")
      totalMarket: cov.totalMarket,    // $ across the whole market for this keyword
      naicsCount: cov.naicsCount,      // distinct NAICS that bought it
      coverageCount: cov.coverageCodes.length, // codes that together cover ~90%
      coveragePct: cov.coveragePct,    // what the FULL coverage set captures (~0.9)
      heldPct,                         // what the USER'S current codes capture
      coverageCodes: coverageDetail,   // the ~90% set, each marked have/missing + $
      missing,                         // coverage codes the user is NOT tracking, ranked $
      // "What was bought" — the sub-markets a single keyword spans (building demo
      // vs ordnance-facility work, etc.). Top 5 PSCs with dollars.
      topPsc: cov.topPscList,
    },
  });
}
