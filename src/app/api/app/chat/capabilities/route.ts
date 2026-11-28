/**
 * GET /api/app/chat/capabilities?email=… → { success, screenshots, actions, connected_files }
 * Tells the Ask Mindy client which optional inputs THIS verified user's turns will actually read, so it never offers
 * a paste the server would ignore. screenshots = research mode is on for the user (ASK_MINDY_RESEARCH_MODE +
 * allowlist), the only engine that reads images. actions = Ask Mindy may propose app actions to this user
 * (ASK_MINDY_APP_ACTIONS + allowlist, src/lib/chat/app-actions/propose.ts); the client runs none unless it is true.
 * connected_files = Google Drive / OneDrive picks are read for this user (CONNECTED_APPS + allowlist); the Map drawer
 * then lists the connected accounts. Any failure answers false for all.
 */
import type { NextRequest } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { researchModeEnabledFor } from '@/lib/ask-mindy/research-mode';
import { appActionsEnabledFor } from '@/lib/chat/app-actions/propose';
import { connectedAppsEnabledFor } from '@/lib/connected-apps/config';

export const dynamic = 'force-dynamic';

const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest) {
  const email = String(new URL(request.url).searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return json({ success: false, error: 'email required', screenshots: false, actions: false, connected_files: false }, 400);
  try {
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) return json({ success: false, error: 'unauthorized', screenshots: false, actions: false, connected_files: false }, 401);
    const who = auth.email ?? email;
    return json({ success: true, screenshots: researchModeEnabledFor(who), actions: appActionsEnabledFor(who), connected_files: connectedAppsEnabledFor(who) });
  } catch {
    return json({ success: false, screenshots: false, actions: false, connected_files: false }, 500);
  }
}
