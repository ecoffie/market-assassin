/**
 * POST /api/app/connected-apps/start — begin connecting a Google Workspace or Microsoft 365 account.
 * Auth: verifyUserOwnsEmail (x-mi-auth-token / session). Binds the verified user + acting scope into a signed,
 * short-lived OAuth state and returns the provider consent URL; the client navigates to it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveChatActingScope } from '@/lib/chat/chat-acting-scope';
import { clientCreds, connectedAppsEnabledFor, type Capability, type Provider } from '@/lib/connected-apps/config';
import { authorizeUrl, pkcePair, safeReturnTo, signState } from '@/lib/connected-apps/oauth';
import { scopeKeyFor } from '@/lib/connected-apps/store';

const CAPS: readonly Capability[] = ['file', 'draft', 'calendar'];

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!connectedAppsEnabledFor(auth.email)) return NextResponse.json({ error: 'not_enabled' }, { status: 404 });

  const provider = body.provider as Provider;
  if (provider !== 'google' && provider !== 'microsoft') return NextResponse.json({ error: 'provider must be google or microsoft' }, { status: 400 });
  if (!clientCreds(provider)) return NextResponse.json({ error: 'provider_not_configured' }, { status: 503 });

  const scope = await resolveChatActingScope(auth.email!, request);
  const scopeKey = scopeKeyFor(scope);
  if (!scopeKey) return NextResponse.json({ error: 'workspace_unconfirmed' }, { status: 409 });

  // Least privilege: only the capabilities this step needs (identity is always included).
  const caps = (Array.isArray(body.capabilities) ? body.capabilities : ['file']).filter((c): c is Capability => CAPS.includes(c as Capability));
  const { verifier, challenge } = pkcePair();
  const state = signState({ provider, ownerEmail: auth.email!, scopeKey, caps, returnTo: safeReturnTo(body.returnTo) }, verifier);
  return NextResponse.json({ authorize_url: authorizeUrl(provider, state, challenge, caps) });
}
