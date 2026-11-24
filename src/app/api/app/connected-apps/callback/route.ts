/**
 * GET /api/app/connected-apps/callback — the provider redirect. No Mindy header arrives here, so identity and
 * workspace come ONLY from the signed state bound at /start. Exchanges the code server-side, records the
 * provider's own identity for the grant, and returns to the conversation. Errors are sanitized codes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectedAppsEnabledFor } from '@/lib/connected-apps/config';
import { exchangeCode, fetchIdentity, OAuthError, verifyState } from '@/lib/connected-apps/oauth';
import { saveConnection } from '@/lib/connected-apps/store';

function back(request: NextRequest, path: string, params: Record<string, string>): NextResponse {
  const u = new URL(path, request.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const verified = verifyState(q.get('state') || '');
  if (!verified) return back(request, '/app', { connect: 'error', reason: 'invalid_state' });
  const { payload, verifier } = verified;
  if (!connectedAppsEnabledFor(payload.ownerEmail)) return back(request, payload.returnTo, { connect: 'error', reason: 'not_enabled' });
  // The customer cancelled or the tenant refused (e.g. admin consent required): say so, change nothing.
  if (q.get('error')) return back(request, payload.returnTo, { connect: 'error', reason: String(q.get('error')).slice(0, 40), provider: payload.provider });
  const code = q.get('code');
  if (!code) return back(request, payload.returnTo, { connect: 'error', reason: 'missing_code', provider: payload.provider });
  try {
    const tokens = await exchangeCode(payload.provider, code, verifier);
    const who = await fetchIdentity(payload.provider, tokens.accessToken);
    const saved = await saveConnection({ scopeKey: payload.scopeKey, ownerEmail: payload.ownerEmail, provider: payload.provider, accountId: who.accountId, email: who.email, name: who.name, tokens });
    return back(request, payload.returnTo, { connect: 'ok', provider: payload.provider, connection: saved.id });
  } catch (err) {
    const reason = err instanceof OAuthError ? err.code : 'connect_failed';
    console.error('[connected-apps] callback failed:', reason);
    return back(request, payload.returnTo, { connect: 'error', reason: reason.slice(0, 40), provider: payload.provider });
  }
}
