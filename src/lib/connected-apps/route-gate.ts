/**
 * One gate for every connected-apps route: verified owner of the email, feature flag, dedicated secrets, and a
 * confirmed acting scope (own email or a confirmed client workspace). Returns the scope key or the response.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveChatActingScope } from '@/lib/chat/chat-acting-scope';
import { connectedAppsEnabledFor, connectedAppsSecrets } from './config';
import { scopeKeyFor } from './store';

export type GateResult = { scopeKey: string; email: string } | { error: NextResponse };

export async function connectedAppsGate(request: NextRequest, rawEmail: unknown): Promise<GateResult> {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email) return { error: NextResponse.json({ error: 'email required' }, { status: 400 }) };
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!connectedAppsEnabledFor(auth.email)) return { error: NextResponse.json({ error: 'not_enabled' }, { status: 404 }) };
  if (!connectedAppsSecrets()) return { error: NextResponse.json({ error: 'not_configured' }, { status: 503 }) };
  const scopeKey = scopeKeyFor(await resolveChatActingScope(auth.email!, request));
  if (!scopeKey) return { error: NextResponse.json({ error: 'workspace_unconfirmed' }, { status: 409 }) };
  return { scopeKey, email: auth.email! };
}
