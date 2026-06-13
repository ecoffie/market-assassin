import { NextRequest, NextResponse } from 'next/server';
import { getCapabilityVector } from '@/lib/alerts/capability-vector';
import { fetchHiddenMatchPool, findHiddenMatches } from '@/lib/alerts/hidden-match';

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
  // No exclusions here — we want to see raw matches for verification.
  const matches = findHiddenMatches(userVec, new Set<string>(), pool, { max: 8 });

  return NextResponse.json({
    success: true,
    email,
    hasVector: true,
    poolSize: pool.length,
    matchCount: matches.length,
    matches: matches.map((m) => ({ title: m.title, agency: m.agency, naics: m.naics, score: m.score, url: m.url })),
  });
}
