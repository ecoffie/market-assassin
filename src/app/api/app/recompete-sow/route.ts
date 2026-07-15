/**
 * GET /api/app/recompete-sow?piid=&naics=&agency=&description=
 *
 * Semantic match: expiring contract description → likely recovered SOW/PWS from the
 * sam_opportunities corpus. The match engine lives in `src/lib/market/recompete-match.ts`
 * (shared with the MCP tool `match_recompete_sow`); this route is the HTTP shell.
 */
import { NextRequest, NextResponse } from 'next/server';
import { matchRecompeteSow } from '@/lib/market/recompete-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const piid = sp.get('piid') || '';
  const naics = sp.get('naics') || '';
  const agency = sp.get('agency') || '';
  const description = sp.get('description') || sp.get('title') || '';

  if (!description.trim()) {
    return NextResponse.json({ success: false, error: 'description or title required' }, { status: 400 });
  }

  const result = await matchRecompeteSow({ description, naics, agency, piid });
  console.log('[recompete-sow]', JSON.stringify(result.telemetry));

  if (!result.ok) {
    console.error('[recompete-sow] error', piid, result.error);
    return NextResponse.json({ success: false, error: result.error, telemetry: result.telemetry }, { status: 500 });
  }

  const { ok: _ok, error: _error, ...payload } = result;
  return NextResponse.json({ success: true, ...payload });
}
