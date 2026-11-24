/**
 * GET    /api/app/connected-apps?email=…           — the acting scope's connected accounts (never tokens).
 * DELETE /api/app/connected-apps  {email, id}       — disconnect: revoke when supported, discard tokens.
 * Auth: verifyUserOwnsEmail; scope from the same acting-scope resolver as Vault and chat.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clientCreds, PROVIDERS } from '@/lib/connected-apps/config';
import { disconnect, listConnections } from '@/lib/connected-apps/store';
import { connectedAppsGate as gate } from '@/lib/connected-apps/route-gate';

export async function GET(request: NextRequest) {
  const g = await gate(request, request.nextUrl.searchParams.get('email'));
  if ('error' in g) return g.error;
  const connections = await listConnections(g.scopeKey);
  return NextResponse.json({
    connections,
    providers: PROVIDERS.map((p) => ({ provider: p, available: !!clientCreds(p) })),
  });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const g = await gate(request, body.email);
  if ('error' in g) return g.error;
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const r = await disconnect(g.scopeKey, id);
  return r === 'not_found' ? NextResponse.json({ error: 'not_found' }, { status: 404 }) : NextResponse.json({ status: 'disconnected' });
}
