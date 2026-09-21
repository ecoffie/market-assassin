import { NextRequest, NextResponse } from 'next/server';
import { postSignupPath } from '@/lib/mindy/post-signup-destination';
import { classifyOAuthFailure } from '@/lib/auth/oauth-failure';
import { logToolError, ToolNames, ErrorTypes } from '@/lib/tool-errors';

/**
 * Preserve OAuth callback URLs while letting the browser Supabase client
 * exchange the code and persist the session.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);

  // ── ENTERPRISE OAUTH FAILURE DETECTION ──────────────────────────────────────────────
  // Entra/Google append ?error=&error_description= to THIS redirect URI on a denial. The
  // route previously ignored them entirely and forwarded the user to /welcome as though
  // sign-in had SUCCEEDED — so an org-policy refusal was indistinguishable from a normal
  // arrival, and the user saw a signed-out app with no explanation.
  //
  // A tenant-policy denial is NOT a generic login failure: the org must act, and the user
  // needs to know to ask their admin. It routes to a dedicated state carrying the reason.
  const oauthError = requestUrl.searchParams.get('error');
  const oauthErrorDescription = requestUrl.searchParams.get('error_description');

  if (oauthError || oauthErrorDescription) {
    const failure = classifyOAuthFailure({
      provider: requestUrl.searchParams.get('provider'),
      error: oauthError,
      errorDescription: oauthErrorDescription,
      errorSubcode: requestUrl.searchParams.get('error_subcode'),
    });

    // Structured, aggregatable failure reason. Non-blocking: a logging outage must never
    // stop us rendering the explanation the user needs.
    void logToolError({
      tool: ToolNames.AUTH_OAUTH,
      errorType: ErrorTypes.VALIDATION,
      errorMessage: `${failure.reason}: ${failure.rawDescription || failure.rawError || 'no detail'}`,
      requestPath: '/app/auth/callback',
      requestParams: {
        oauth_failure_kind: failure.kind,
        oauth_resolver: failure.resolver,
        oauth_code: failure.code,
        oauth_provider: failure.provider,
        oauth_raw_error: failure.rawError,
      },
    }).catch(() => { /* never block the redirect */ });

    const dest = new URL('/app/sign-in-help', request.url);
    dest.searchParams.set('reason', failure.kind);
    dest.searchParams.set('provider', failure.provider);
    if (failure.code) dest.searchParams.set('code', failure.code);
    return NextResponse.redirect(dest);
  }
  // ⚠️ THIS LINE IS THE REPORTED BUG (2026-08-25). It read:
  //     searchParams.get('next') || '/app/onboarding'
  // so a generic referral — which carries no intent — landed every new account in the
  // legacy profile builder we are retiring. The fallback WAS the legacy surface.
  //
  // One shared resolver now owns the decision for every entry path: a safe Maps `next`
  // wins, explicit MCP/purchase intent routes accordingly, and anything unknown goes to
  // /welcome. It also rejects a `next` that points BACK at /app or /briefings, so a stale
  // link cannot reintroduce the old experience.
  const next = postSignupPath({
    next: requestUrl.searchParams.get('next'),
    intent: requestUrl.searchParams.get('intent'),
    purchaseNext: requestUrl.searchParams.get('purchase_next'),
  });
  const redirectUrl = new URL(next, request.url);

  requestUrl.searchParams.forEach((value, key) => {
    if (key !== 'next') {
      redirectUrl.searchParams.set(key, value);
    }
  });

  return NextResponse.redirect(redirectUrl);
}
