/**
 * Auth for the Content Reaper AI helper routes (generate-graphic, convert-post-to-carousel,
 * generate-quote). Each call costs LLM tokens, so every request must come from a VERIFIED,
 * ENTITLED user, within a daily per-user limit, before the body is parsed or any model is called.
 *
 *   identity    → a verified Mindy session (email-code sign-in; `x-mi-auth-token`), via the
 *                 shared getVerifiedIdentity. A typed or body-supplied email is never identity.
 *   entitlement → the same Content Reaper grant the page's paywall checks (KV `contentgen:{email}`),
 *                 for the VERIFIED email. A KV failure reads as "no access" (fails closed).
 *   usage       → a fixed daily window per user per route.
 *
 * Content Reaper page access stays email-gated (commit 4c3de394). Only these AI calls need
 * sign-in; the page sends people to /app?next=… and they return to the tool.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getVerifiedIdentity } from '@/lib/api-auth';
import { hasContentGeneratorAccess } from '@/lib/access-codes';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export type ContentAiRoute = 'graphic' | 'carousel' | 'quote';

/** Per user per day. A full 30-post batch renders one graphic per post (10 batches/day max). */
export const CONTENT_AI_DAILY_LIMITS: Record<ContentAiRoute, number> = {
  graphic: 300,
  quote: 300,
  carousel: 30,
};

/** LinkedIn caps a post at 3,000 characters; leave headroom for titles and markdown. */
export const CONTENT_AI_MAX_INPUT_CHARS = 10_000;

export const CONTENT_AI_SIGN_IN_PATH = '/app?next=%2Fcontent-generator%2F';

export type ContentAiAuth =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

export async function authorizeContentAiRequest(
  request: NextRequest,
  route: ContentAiRoute,
  headers: Record<string, string> = {},
): Promise<ContentAiAuth> {
  const identity = await getVerifiedIdentity(request, null).catch(() => null);
  if (!identity) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Sign in to Mindy to use AI content tools', auth_required: true, signInUrl: CONTENT_AI_SIGN_IN_PATH },
        { status: 401, headers },
      ),
    };
  }

  if (!(await hasContentGeneratorAccess(identity.email))) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Content Reaper access is required for AI content tools' },
        { status: 403, headers },
      ),
    };
  }

  const limit = await checkRateLimit(`content-ai:${route}:${identity.email}`, CONTENT_AI_DAILY_LIMITS[route], 86_400);
  if (!limit.allowed) {
    const res = rateLimitResponse(limit);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return { ok: false, response: res };
  }

  return { ok: true, email: identity.email };
}

/** 413 for an oversized input, so a caller cannot buy an arbitrarily large prompt. */
export function contentInputTooLarge(text: unknown, headers: Record<string, string> = {}): NextResponse | null {
  if (typeof text === 'string' && text.length > CONTENT_AI_MAX_INPUT_CHARS) {
    return NextResponse.json(
      { success: false, error: `Content is too long (max ${CONTENT_AI_MAX_INPUT_CHARS.toLocaleString()} characters)` },
      { status: 413, headers },
    );
  }
  return null;
}
