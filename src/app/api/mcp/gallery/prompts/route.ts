/**
 * GET /api/mcp/gallery/prompts — the prompts behind the "Mindy in your AI" gallery.
 * Signed-in only (server-verified session, never a claimed email). Signed out → 401, and the
 * gallery shows "Sign in to see the prompt" instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { GALLERY_PROMPTS } from '@/lib/mcp/gallery-prompts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) {
    return NextResponse.json({ signedIn: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ signedIn: true, prompts: GALLERY_PROMPTS }, { headers: { 'Cache-Control': 'private, no-store' } });
}
