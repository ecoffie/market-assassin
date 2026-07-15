/**
 * GET /api/app/solicitation-incumbent?q=140L6226Q0013
 *
 * Resolve an open SAM solicitation (sol # or notice UUID) and return the
 * likely prior award (incumbent + $). Powers Global Lookup fallback when a
 * PIID-shaped string is actually an RFQ number, and Chat via the MCP tool.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveSolicitationIncumbent } from '@/lib/usaspending/solicitation-incumbent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ||
    request.nextUrl.searchParams.get('solicitation') ||
    request.nextUrl.searchParams.get('solicitation_number') ||
    request.nextUrl.searchParams.get('notice_id') ||
    '').trim();

  if (!q || q.length < 5) {
    return NextResponse.json(
      { success: false, error: 'q (solicitation number or notice id) required' },
      { status: 400 },
    );
  }

  try {
    const result = await resolveSolicitationIncumbent(q);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[solicitation-incumbent]', err);
    return NextResponse.json(
      { success: false, error: 'Lookup failed' },
      { status: 500 },
    );
  }
}
