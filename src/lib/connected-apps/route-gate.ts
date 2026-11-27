/**
 * One gate for every connected-apps route: verified owner of the email, feature flag, dedicated secrets, and a
 * confirmed acting scope (own email or a confirmed client workspace). Returns the scope key or the response.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveChatActingScope } from '@/lib/chat/chat-acting-scope';
import { connectedAppsEnabledFor, connectedAppsSecrets } from './config';
import { scopeKeyFor } from './store';
import { checkRateLimit } from '@/lib/rate-limit';

/** Per-user limits on the file routes (calls per 10 minutes). Generous for a person clicking; stops a loop or a script. */
export const ROUTE_LIMITS = { browse: 120, selections: 60, picker_token: 60 } as const;
export type RateLimitedRoute = keyof typeof ROUTE_LIMITS;

export type GateResult = { scopeKey: string; email: string } | { error: NextResponse };

export async function connectedAppsGate(request: NextRequest, rawEmail: unknown, limit?: RateLimitedRoute): Promise<GateResult> {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email) return { error: NextResponse.json({ error: 'email required' }, { status: 400 }) };
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!connectedAppsEnabledFor(auth.email)) return { error: NextResponse.json({ error: 'not_enabled' }, { status: 404 }) };
  if (limit) {
    const rl = await checkRateLimit(`connected-apps:${limit}:${auth.email!.toLowerCase()}`, ROUTE_LIMITS[limit], 600);
    if (!rl.allowed) return { error: NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))) } }) };
  }
  if (!connectedAppsSecrets()) return { error: NextResponse.json({ error: 'not_configured' }, { status: 503 }) };
  const scopeKey = scopeKeyFor(await resolveChatActingScope(auth.email!, request));
  if (!scopeKey) return { error: NextResponse.json({ error: 'workspace_unconfirmed' }, { status: 409 }) };
  return { scopeKey, email: auth.email! };
}
