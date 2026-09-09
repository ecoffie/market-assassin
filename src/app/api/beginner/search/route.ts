/**
 * Public beginner aha search. Two SAM populations: the user's words vs
 * coverage-derived buying language. No MCP/credits, no dollar market-size.
 *
 * Claim-producing: opportunity counts on /try. Starts in CLAIM_ROUTES_UNVERIFIED.
 */
import { NextRequest, NextResponse } from 'next/server';
import { FOLLOW_UP_PROMPT } from '@/lib/beginner/types';
import {
  searchBeginnerHiddenMarket,
  toHiddenMarketLandingView,
} from '@/lib/beginner/hidden-market';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 60;

const MAX_CHARS = 400;
const RATE_LIMIT = 20;
const RATE_WINDOW = 3600;

function clip(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_CHARS) : '';
}

const UNAVAILABLE_VIEW = {
  outcome: 'unavailable' as const,
  classification: 'unavailable' as const,
  followUpPrompt: null,
  message: "We couldn't check opportunities right now. Try again in a moment.",
  reveal: {
    directMatchCount: null,
    expandedMatchCount: null,
    totalUniqueCount: null,
    directLabel: 'Matches what you described',
    expandedLabel: 'Opportunities Mindy uncovered',
    revealState: 'unavailable' as const,
    explanation: "Mindy couldn't measure the broader market right now.",
  },
  directCards: [],
  uncoveredCards: [],
  ctaVariant: 'more' as const,
  classificationPath: 'unavailable' as const,
};

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const limited = await checkRateLimit(`beginner-try:${ip}`, RATE_LIMIT, RATE_WINDOW);
  if (!limited.allowed) return rateLimitResponse(limited);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const description = clip((body as { description?: unknown })?.description);
  const followUpRaw = clip((body as { followUp?: unknown })?.followUp);
  const followUp = followUpRaw || undefined;

  if (!description) {
    return NextResponse.json({
      ok: true,
      outcome: 'need_followup',
      classification: 'need_followup',
      followUpPrompt: FOLLOW_UP_PROMPT,
      message: FOLLOW_UP_PROMPT,
      reveal: null,
      directCards: [],
      uncoveredCards: [],
      ctaVariant: 'more',
      classificationPath: 'need_followup',
    });
  }

  try {
    const result = await searchBeginnerHiddenMarket({
      description,
      followUp,
      eligibility: { established: false },
    });
    return NextResponse.json({ ok: true, ...toHiddenMarketLandingView(result) });
  } catch {
    return NextResponse.json({ ok: true, ...UNAVAILABLE_VIEW });
  }
}
