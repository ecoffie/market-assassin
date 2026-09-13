/**
 * Server handler for GET /auth/callback.
 *
 * PKCE: `?code=` + verifier cookie → Supabase token exchange → mint MI session
 * → Set-Cookie `mi_auth` → redirect to postSignupPath (never /app, never tokens).
 *
 * Implicit leftover: no `code` and no cookie → HTML fragment consumer (hash is
 * invisible to this route). After mint it re-enters here with a cookie and `next`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { classifyOAuthFailure } from '@/lib/auth/oauth-failure';
import { logToolError, ToolNames, ErrorTypes } from '@/lib/tool-errors';
import { attachMIAuthCookie } from '@/lib/mindy/mi-auth-cookie';
import { MI_AUTH_COOKIE } from '@/lib/mindy/mi-auth-constants';
import {
  oauthFragmentConsumerHtml,
  PKCE_VERIFIER_COOKIE,
  readPkceVerifier,
} from '@/lib/mindy/oauth-callback';
import { postSignupPath } from '@/lib/mindy/post-signup-destination';
import { createMIAuthSessionToken, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';

export type ExchangePkce = (
  code: string,
  verifier: string,
) => Promise<{ email: string } | { error: string }>;

export function readPkceVerifierFromRequest(request: NextRequest): string | null {
  return readPkceVerifier(request.cookies.get(PKCE_VERIFIER_COOKIE)?.value ?? null);
}

export function readExistingMindyEmail(request: NextRequest): string | null {
  const result = verifyTwoFactorSessionToken(request.cookies.get(MI_AUTH_COOKIE)?.value);
  return result.valid && result.email ? result.email : null;
}

export async function exchangeSupabasePkceCode(
  code: string,
  verifier: string,
): Promise<{ email: string } | { error: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { error: 'supabase_unconfigured' };

  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'exchange_failed' };
  }

  const data = (await res.json().catch(() => null)) as {
    user?: { email?: string };
    error?: string;
    error_description?: string;
  } | null;
  const email = String(data?.user?.email || '').toLowerCase().trim();
  if (!res.ok || !email) {
    return { error: data?.error_description || data?.error || 'exchange_failed' };
  }
  return { email };
}

export async function handleOAuthCallbackRequest(
  request: NextRequest,
  deps: {
    exchange?: ExchangePkce;
    mint?: (email: string) => string;
    existingEmail?: string | null;
  } = {},
): Promise<NextResponse> {
  const exchange = deps.exchange ?? exchangeSupabasePkceCode;
  const mint = deps.mint ?? createMIAuthSessionToken;
  const url = new URL(request.url);

  const oauthError = url.searchParams.get('error');
  const oauthErrorDescription = url.searchParams.get('error_description');
  if (oauthError || oauthErrorDescription) {
    const failure = classifyOAuthFailure({
      provider: url.searchParams.get('provider'),
      error: oauthError,
      errorDescription: oauthErrorDescription,
      errorSubcode: url.searchParams.get('error_subcode'),
    });
    void logToolError({
      tool: ToolNames.AUTH_OAUTH,
      errorType: ErrorTypes.VALIDATION,
      errorMessage: `${failure.reason}: ${failure.rawDescription || failure.rawError || 'no detail'}`,
      requestPath: '/auth/callback',
      requestParams: {
        oauth_failure_kind: failure.kind,
        oauth_resolver: failure.resolver,
        oauth_code: failure.code,
        oauth_provider: failure.provider,
        oauth_raw_error: failure.rawError,
      },
    }).catch(() => { /* never block the redirect */ });

    const dest = new URL('/signin', request.url);
    dest.searchParams.set('oauth_error', failure.kind);
    dest.searchParams.set('provider', failure.provider);
    if (failure.code) dest.searchParams.set('code', failure.code);
    return NextResponse.redirect(dest);
  }

  const destPath = postSignupPath({
    next: url.searchParams.get('next'),
    intent: url.searchParams.get('intent'),
    purchaseNext: url.searchParams.get('purchase_next'),
  });

  const code = url.searchParams.get('code');
  if (code) {
    const verifier = readPkceVerifierFromRequest(request);
    if (!verifier) {
      const fail = new URL('/signin', request.url);
      fail.searchParams.set('oauth_error', 'generic');
      return NextResponse.redirect(fail);
    }
    const exchanged = await exchange(code, verifier);
    if ('error' in exchanged) {
      const fail = new URL('/signin', request.url);
      fail.searchParams.set('oauth_error', 'generic');
      return NextResponse.redirect(fail);
    }
    const token = mint(exchanged.email);
    const res = NextResponse.redirect(new URL(destPath, request.url));
    attachMIAuthCookie(res, token);
    res.cookies.set(PKCE_VERIFIER_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }

  const existingEmail = deps.existingEmail !== undefined
    ? deps.existingEmail
    : readExistingMindyEmail(request);
  if (existingEmail) {
    return NextResponse.redirect(new URL(destPath, request.url));
  }

  return new NextResponse(oauthFragmentConsumerHtml(), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
