/**
 * POST /api/app/connected-apps/start — begin connecting a Google Workspace or Microsoft 365 account.
 * Auth: verifyUserOwnsEmail (x-mi-auth-token / session). Binds the verified user + acting scope into a signed,
 * short-lived OAuth state and returns the provider consent URL; the client navigates to it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveChatActingScope } from '@/lib/chat/chat-acting-scope';
import { ACCESS_DISCLOSURE, clientCreds, connectedAppsEnabledFor, connectedAppsSecrets, type Capability, type Provider } from '@/lib/connected-apps/config';
import { authorizeUrl, BINDING_COOKIE, BINDING_COOKIE_PATH, newBrowserBinding, pkcePair, safeReturnTo, signState, STATE_TTL_SEC } from '@/lib/connected-apps/oauth';
import { scopeKeyFor } from '@/lib/connected-apps/store';
import { checkRateLimit } from '@/lib/rate-limit';

const START_LIMIT_PER_HOUR = 20;

// This slice requests only file access. Draft and calendar are added with the tools that use them.
const CAPS: readonly Capability[] = ['file'];

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!connectedAppsEnabledFor(auth.email)) return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  // Per-user limit: consent starts are rare; a burst is a script or a loop.
  const rl = await checkRateLimit(`connected-apps:start:${auth.email!.toLowerCase()}`, START_LIMIT_PER_HOUR, 3600);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))) } });

  const provider = body.provider as Provider;
  if (provider !== 'google' && provider !== 'microsoft') return NextResponse.json({ error: 'provider must be google or microsoft' }, { status: 400 });
  if (!clientCreds(provider)) return NextResponse.json({ error: 'provider_not_configured' }, { status: 503 });
  // Dedicated signing + encryption secrets are required; refuse rather than fall back to a shared secret.
  if (!connectedAppsSecrets()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const scope = await resolveChatActingScope(auth.email!, request);
  const scopeKey = scopeKeyFor(scope);
  if (!scopeKey) return NextResponse.json({ error: 'workspace_unconfirmed' }, { status: 409 });

  // Least privilege: only the capabilities this step needs (identity is always included).
  const caps = (Array.isArray(body.capabilities) ? body.capabilities : ['file']).filter((c): c is Capability => CAPS.includes(c as Capability));
  if (!caps.length) return NextResponse.json({ error: 'unsupported_capability' }, { status: 400 });
  const { verifier, challenge } = pkcePair();
  // Tie the flow to THIS browser: the callback refuses unless the same browser returns this cookie.
  const binding = newBrowserBinding();
  const state = signState({ provider, ownerEmail: auth.email!, scopeKey, caps, returnTo: safeReturnTo(body.returnTo) }, verifier, binding.hash);
  const res = NextResponse.json({
    authorize_url: authorizeUrl(provider, state, challenge, caps),
    // Shown before the customer leaves for consent: what the provider grant allows, in plain words.
    access_note: caps.map((c) => ACCESS_DISCLOSURE[provider][c as Exclude<Capability, 'identity'>]).join(' '),
  });
  // SameSite=Lax: sent on the provider's top-level GET redirect back to the callback, never on cross-site subrequests.
  res.cookies.set(BINDING_COOKIE, binding.cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: BINDING_COOKIE_PATH, maxAge: STATE_TTL_SEC });
  return res;
}
