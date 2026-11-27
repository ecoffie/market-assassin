/**
 * POST /api/app/connected-apps/picker-token  {email, connection_id}
 *
 * The Google Picker runs in the customer's browser and needs a short-lived access token for the connection
 * (Google's documented pattern). Returns ONLY the access token (never the refresh token), for a Google
 * connection in the acting scope, with no-store caching, plus the public Picker developer key and app id.
 * Microsoft is refused: OneDrive uses Mindy's server-side chooser (/browse), so no Microsoft token reaches
 * the browser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectedAppsGate } from '@/lib/connected-apps/route-gate';
import { accessTokenFor, restrictedAccessTokenFor } from '@/lib/connected-apps/store';
import { lacksCapability, SCOPES } from '@/lib/connected-apps/config';

/** What a browser-side Picker token may carry: identity and drive.file. Never mail. */
const PICKER_SCOPES = [...SCOPES.google.identity, ...SCOPES.google.file];
/** Google returns the identity scopes under their long names. */
const PICKER_SCOPE_ALIASES = ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
/** A scope that must never reach the browser: any mail (or full-mailbox) scope. */
const isMailScope = (sc: string) => /gmail|mail\.google\.com|(^|\/)mail\./i.test(sc);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const g = await connectedAppsGate(request, body.email, 'picker_token');
  if ('error' in g) return g.error;
  const connectionId = String(body.connection_id || '');
  if (!connectionId) return NextResponse.json({ error: 'connection_id required' }, { status: 400 });
  let tok: Awaited<ReturnType<typeof restrictedAccessTokenFor>> = await accessTokenFor(g.scopeKey, g.email, connectionId);
  if (!tok.ok) return NextResponse.json({ error: tok.reason }, { status: tok.reason === 'not_found' ? 404 : tok.reason === 'refresh_failed' ? 502 : 409 });
  if (tok.provider !== 'google') return NextResponse.json({ error: 'not_supported' }, { status: 400 });
  // Without the file permission the provider answers 403 (for Google, a raw Google error page inside the picker).
  // Say what to do instead: reconnect and allow file access.
  if (lacksCapability(tok.provider, tok.connection.granted_scopes, 'file')) return NextResponse.json({ error: 'file_permission_needed' }, { status: 403 });
  // This token goes to the browser. A connection that also allows email drafts holds a stored token carrying
  // gmail.compose (include_granted_scopes), so mint a fresh one limited to the file scopes instead; refuse if the
  // provider will not limit it.
  if (tok.connection.granted_scopes.some(isMailScope)) {
    tok = await restrictedAccessTokenFor(g.scopeKey, g.email, connectionId, PICKER_SCOPES, { acceptAlso: PICKER_SCOPE_ALIASES });
    if (!tok.ok) return NextResponse.json({ error: tok.reason === 'scope_not_restricted' ? 'picker_scope_unavailable' : tok.reason }, { status: tok.reason === 'not_found' ? 404 : tok.reason === 'reauth_needed' ? 409 : 502 });
  }
  const google = { developer_key: process.env.NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_PICKER_KEY || null, app_id: process.env.NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID || null };
  if (!google.developer_key || !google.app_id) return NextResponse.json({ error: 'picker_not_configured' }, { status: 503 });
  return NextResponse.json(
    { provider: tok.provider, access_token: tok.token, connection_id: connectionId, connected_account: tok.connection.connected_email, ...google },
    { headers: { 'cache-control': 'no-store' } },
  );
}
