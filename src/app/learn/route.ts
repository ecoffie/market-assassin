/**
 * GET /learn — Mindy Learn: the public GovCon Action Plan (Learn PR B).
 *
 * Server-rendered in the shared public shell (same header/footer as /today, /bid, /gov). Static: no
 * auth, no DB, no tier read, no progress. Content and rules: src/lib/learn/.
 */
import { NextResponse } from 'next/server';
import { learnIndexHtml } from '@/lib/learn/render';

export const dynamic = 'force-static';

const HTML = learnIndexHtml();

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
