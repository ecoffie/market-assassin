/**
 * GET    /api/app/connected-apps?email=…           — the acting scope's connected accounts (never tokens).
 * DELETE /api/app/connected-apps  {email, id}       — disconnect: revoke when supported, discard tokens.
 * Auth: verifyUserOwnsEmail; scope from the same acting-scope resolver as Vault and chat.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveChatActingScope } from '@/lib/chat/chat-acting-scope';
import { clientCreds, connectedAppsEnabledFor, PROVIDERS } from '@/lib/connected-apps/config';
import { disconnect, listConnections, scopeKeyFor } from '@/lib/connected-apps/store';

async function gate(request: NextRequest, email: string) {
  if (!email) return { error: NextResponse.json({ error: 'email required' }, { status: 400 }) };
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!connectedAppsEnabledFor(auth.email)) return { error: NextResponse.json({ error: 'not_enabled' }, { status: 404 }) };
  const scopeKey = scopeKeyFor(await resolveChatActingScope(auth.email!, request));
  if (!scopeKey) return { error: NextResponse.json({ error: 'workspace_unconfirmed' }, { status: 409 }) };
  return { scopeKey };
}

export async function GET(request: NextRequest) {
  const g = await gate(request, String(request.nextUrl.searchParams.get('email') || '').trim().toLowerCase());
  if ('error' in g) return g.error;
  const connections = await listConnections(g.scopeKey);
  return NextResponse.json({
    connections,
    providers: PROVIDERS.map((p) => ({ provider: p, available: !!clientCreds(p) })),
  });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const g = await gate(request, String(body.email || '').trim().toLowerCase());
  if ('error' in g) return g.error;
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const r = await disconnect(g.scopeKey, id);
  return r === 'not_found' ? NextResponse.json({ error: 'not_found' }, { status: 404 }) : NextResponse.json({ status: 'disconnected' });
}
