/**
 * GET /api/app/chat/capabilities?email=… → { success, screenshots }
 * Tells the Ask Mindy client which optional inputs THIS verified user's turns will actually read, so it never offers
 * a paste the server would ignore. screenshots = research mode is on for the user (ASK_MINDY_RESEARCH_MODE +
 * allowlist), the only engine that reads images. Any failure answers screenshots: false.
 */
import type { NextRequest } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { researchModeEnabledFor } from '@/lib/ask-mindy/research-mode';

export const dynamic = 'force-dynamic';

const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest) {
  const email = String(new URL(request.url).searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return json({ success: false, error: 'email required', screenshots: false }, 400);
  try {
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) return json({ success: false, error: 'unauthorized', screenshots: false }, 401);
    return json({ success: true, screenshots: researchModeEnabledFor(auth.email ?? email) });
  } catch {
    return json({ success: false, screenshots: false }, 500);
  }
}
