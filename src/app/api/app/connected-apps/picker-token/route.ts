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
import { accessTokenFor } from '@/lib/connected-apps/store';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const g = await connectedAppsGate(request, body.email);
  if ('error' in g) return g.error;
  const connectionId = String(body.connection_id || '');
  if (!connectionId) return NextResponse.json({ error: 'connection_id required' }, { status: 400 });
  const tok = await accessTokenFor(g.scopeKey, connectionId);
  if (!tok.ok) return NextResponse.json({ error: tok.reason }, { status: tok.reason === 'not_found' ? 404 : tok.reason === 'refresh_failed' ? 502 : 409 });
  if (tok.provider !== 'google') return NextResponse.json({ error: 'not_supported' }, { status: 400 });
  const google = { developer_key: process.env.NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_PICKER_KEY || null, app_id: process.env.NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID || null };
  if (!google.developer_key || !google.app_id) return NextResponse.json({ error: 'picker_not_configured' }, { status: 503 });
  return NextResponse.json(
    { provider: tok.provider, access_token: tok.token, connection_id: connectionId, connected_account: tok.connection.connected_email, ...google },
    { headers: { 'cache-control': 'no-store' } },
  );
}
