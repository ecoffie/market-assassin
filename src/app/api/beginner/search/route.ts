/**
 * Public beginner aha search. Wraps searchBeginnerOpportunities — no new
 * market math, no MCP/credits, no expert workflow.
 *
 * Claim-producing: opportunity counts on /try. Starts in CLAIM_ROUTES_UNVERIFIED.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchBeginnerOpportunities } from '@/lib/beginner/search';
import { LANDING_SEARCH_LIMIT, toBeginnerLandingView } from '@/lib/beginner/landing';
import { FOLLOW_UP_PROMPT } from '@/lib/beginner/types';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 60;

const MAX_CHARS = 400;
const RATE_LIMIT = 20;
const RATE_WINDOW = 3600;

function clip(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_CHARS) : '';
}

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
      ...toBeginnerLandingView({
        resolution: {
          original: '',
          followUpUsed: null,
          state: 'need_followup',
          searchKeyword: null,
          contextLabel: null,
          keywords: { status: 'known', items: [] },
          naicsCodes: { status: 'known', items: [] },
          primaryNaics: null,
          psc: null,
          coverageKeyword: null,
          confidence: 'none',
          followUpPrompt: FOLLOW_UP_PROMPT,
          provenance: {},
        },
        outcome: { kind: 'need_followup', message: FOLLOW_UP_PROMPT },
      }),
    });
  }

  try {
    const result = await searchBeginnerOpportunities({
      description,
      followUp,
      limit: LANDING_SEARCH_LIMIT,
      eligibility: { established: false },
    });
    return NextResponse.json({ ok: true, ...toBeginnerLandingView(result) });
  } catch {
    return NextResponse.json({
      ok: true,
      outcome: 'unavailable',
      classification: 'unavailable',
      followUpPrompt: null,
      message: "We couldn't check opportunities right now. Try again in a moment.",
      reveal: [],
      cards: [],
      foundCount: null,
    });
  }
}
