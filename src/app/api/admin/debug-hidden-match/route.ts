import { NextRequest, NextResponse } from 'next/server';
import { getCapabilityVector } from '@/lib/alerts/capability-vector';
import { fetchHiddenMatchPool, findHiddenMatches } from '@/lib/alerts/hidden-match';
import { cosineSimilarity } from '@/lib/market/embeddings';

/**
 * GET /api/admin/debug-hidden-match?password=...&email=...
 * Runs the hidden-match matcher for one user and returns the results + pool stats —
 * so we can SEE real matches before any rollout. Temporary verification tool.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const email = (request.nextUrl.searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  const userVec = await getCapabilityVector(email);
  if (!userVec) {
    return NextResponse.json({ success: true, email, hasVector: false, note: 'no capability vector (ineligible or not embedded)' });
  }

  const pool = await fetchHiddenMatchPool();
  const matches = findHiddenMatches(userVec, new Set<string>(), pool, { max: 8 });

  // Raw score distribution (no threshold) — to SEE where scores actually land and
  // whether 0.55 is the right floor.
  const scored = pool
    .map((c) => ({ title: c.title, agency: c.department, naics: c.naics, score: Math.round(cosineSimilarity(userVec, c.vec) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 10);
  const all = scored.map((s) => s.score);
  const stats = {
    max: all[0] ?? 0,
    p90: all[Math.floor(all.length * 0.1)] ?? 0,
    median: all[Math.floor(all.length * 0.5)] ?? 0,
    above_0_55: all.filter((s) => s >= 0.55).length,
    above_0_50: all.filter((s) => s >= 0.50).length,
    above_0_45: all.filter((s) => s >= 0.45).length,
  };

  return NextResponse.json({
    success: true,
    email,
    hasVector: true,
    poolSize: pool.length,
    matchCount: matches.length,
    matches: matches.map((m) => ({ title: m.title, agency: m.agency, naics: m.naics, score: m.score })),
    scoreStats: stats,
    top10Raw: top,
  });
}
