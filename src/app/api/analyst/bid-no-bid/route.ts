/**
 * AI Analyst — bid/no-bid recommendation per opportunity.
 *
 * PRD-ai-bd-department.md Agent #2 (the "Analyst"). Given a SAM.gov
 * notice ID + the authenticated user, returns a structured AI
 * recommendation (PURSUE / WATCH / SKIP) with reasoning. Pro-tier
 * gated. Cached per (notice_id, user_email) in
 * analyst_bid_no_bid_cache so repeat opens are instant.
 *
 * POST /api/analyst/bid-no-bid
 *   Body: { noticeId: string, email?: string, force?: boolean }
 *
 * Response shape:
 *   {
 *     success: true,
 *     cached: boolean,           // hit the DB cache vs fresh LLM
 *     analysis: {
 *       recommendation: 'pursue' | 'watch' | 'skip',
 *       score: number,           // 0-100
 *       why_pursue: string[],
 *       concerns: string[],
 *       competitors_likely: string[],
 *       effort_estimate: string,
 *       next_step: string,
 *     },
 *     generated_at: string,
 *     model: string,
 *   }
 *
 * Pro-gated: free tier gets 402 with a teaser shape so the UI can
 * render an "Upgrade to see the Analyst" card without revealing
 * the analysis. Internal staff bypass via INTERNAL_TEAM_EMAILS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, recordToolSuccess, ToolNames, classifyError, AIProviders } from '@/lib/tool-errors';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

interface AnalystOutput {
  recommendation: 'pursue' | 'watch' | 'skip';
  score: number;
  why_pursue: string[];
  concerns: string[];
  competitors_likely: string[];
  effort_estimate: string;
  next_step: string;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPrompt(opp: any, profile: any): string {
  const naicsList = (profile?.naics_codes || []).slice(0, 8).join(', ') || 'not set';
  const setAsides = (profile?.set_aside_preferences || []).join(', ') || 'not set';
  const agencies = (profile?.target_agencies || profile?.agencies || []).slice(0, 5).join(', ') || 'not set';
  const businessType = profile?.business_type || 'not set';

  const description = typeof opp.description === 'string' && opp.description.length > 0
    ? opp.description.slice(0, 6000)
    : '(no description text on file)';

  // Tight, structured prompt. We want JSON back; the system message
  // enforces no-prose, and the user message gives every signal the
  // Analyst should weigh per the PRD §150 "Bid/No-Bid Analysis" spec.
  return `You are the "Analyst" agent in a federal contracting BD team. Your job: tell this small business contractor whether to bid on this opportunity.

USER'S COMPANY PROFILE:
- Business type / certifications: ${businessType}
- Set-aside preferences: ${setAsides}
- NAICS codes pursued: ${naicsList}
- Target agencies: ${agencies}

OPPORTUNITY:
- Title: ${opp.title || '(untitled)'}
- Notice type: ${opp.notice_type || '(unknown)'}
- Agency: ${opp.department || '(unknown)'}${opp.sub_tier ? ` › ${opp.sub_tier}` : ''}${opp.office ? ` › ${opp.office}` : ''}
- NAICS: ${opp.naics_code || '(none)'}
- PSC: ${opp.psc_code || '(none)'}
- Set-aside: ${opp.set_aside_description || opp.set_aside || 'unrestricted'}
- Posted: ${opp.posted_date || '(unknown)'}
- Response deadline: ${opp.response_deadline || '(unknown)'}
- Place of performance: ${[opp.pop_city, opp.pop_state, opp.pop_country].filter(Boolean).join(', ') || '(unknown)'}
- Solicitation #: ${opp.solicitation_number || '(none)'}
- Attachments available: ${Array.isArray(opp.attachments) && opp.attachments.length > 0 ? `yes (${opp.attachments.length})` : 'no'}

DESCRIPTION (truncated to 6K chars):
${description}

Return ONLY valid JSON matching exactly this shape — no markdown, no commentary, no code fences:

{
  "recommendation": "pursue" | "watch" | "skip",
  "score": <integer 0-100>,
  "why_pursue": [<short reasons this is a good fit, max 5, each under 100 chars>],
  "concerns": [<risks or unknowns the user should verify, max 4, each under 100 chars>],
  "competitors_likely": [<likely incumbents or strong primes, max 3, each under 60 chars; use "(unknown without further research)" if you cannot infer>],
  "effort_estimate": "<one short sentence covering proposal effort + team needs>",
  "next_step": "<one short imperative sentence the user should do next>"
}

RULES:
- "pursue" = strong fit (score 70+), user should commit resources
- "watch" = monitor (score 40-69), needs verification or partner
- "skip" = poor fit (score 0-39), wrong cert / wrong size / wrong domain
- If the opp's set-aside excludes the user's business type, recommend "skip" with the mismatch as the first concern
- If NAICS doesn't match user's NAICS codes, drop score by at least 30
- If deadline is within 7 days, mention urgency in concerns
- Be concrete. Avoid filler like "consider the opportunity carefully"`;
}

function parseAnalystJson(text: string): AnalystOutput | null {
  // Use the shared safeParseJSON helper which handles code fences,
  // wrapper prose, control chars, newlines-in-strings, and 2-pass
  // sanitization. Returns null fallback if all attempts fail.
  const parsed = safeParseJSON<unknown>(text, {
    fallback: null,
    source: 'analyst.bidNoBid',
  });
  if (parsed && validateShape(parsed)) return parsed;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateShape(obj: any): obj is AnalystOutput {
  if (!obj || typeof obj !== 'object') return false;
  if (!['pursue', 'watch', 'skip'].includes(obj.recommendation)) return false;
  if (typeof obj.score !== 'number') return false;
  if (!Array.isArray(obj.why_pursue)) return false;
  if (!Array.isArray(obj.concerns)) return false;
  if (!Array.isArray(obj.competitors_likely)) return false;
  if (typeof obj.effort_estimate !== 'string') return false;
  if (typeof obj.next_step !== 'string') return false;
  return true;
}

export async function POST(request: NextRequest) {
  let body: { noticeId?: string; email?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const noticeId = typeof body.noticeId === 'string' ? body.noticeId.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const force = body.force === true;

  if (!noticeId) return NextResponse.json({ success: false, error: 'noticeId required' }, { status: 400 });
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  // Auth gate: must be a real session for this email.
  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  // Tier gate: only Pro and staff get the Analyst. Free tier gets a
  // teaser (no LLM call, no DB write). UI uses this to render an
  // "Upgrade to unlock Mindy Analyst" block.
  const access = await verifyMIAccess(email);
  const isPro = access.tier === 'pro' || access.isStaff === true;
  if (!isPro) {
    return NextResponse.json(
      {
        success: false,
        teaser: true,
        error: 'Mindy Analyst is a Mindy Pro feature',
        upgrade_url: '/market-intelligence',
      },
      { status: 402 }
    );
  }

  const supabase = getSupabase();

  // Cache hit (unless force=true).
  if (!force) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cached } = await (supabase
      .from('analyst_bid_no_bid_cache')
      .select('*') as any)
      .eq('notice_id', noticeId)
      .eq('user_email', email)
      .maybeSingle();

    if (cached?.recommendation) {
      return NextResponse.json({
        success: true,
        cached: true,
        analysis: cached.recommendation,
        generated_at: cached.generated_at,
        model: cached.model_used,
      });
    }
  }

  // Pull the opportunity row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: opp, error: oppError } = await (supabase
    .from('sam_opportunities')
    .select('*') as any)
    .eq('notice_id', noticeId)
    .maybeSingle();

  if (oppError || !opp) {
    return NextResponse.json(
      { success: false, error: `Opportunity not found: ${noticeId}` },
      { status: 404 }
    );
  }

  // Pull the user profile so the analysis is personalized.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase
    .from('user_notification_settings')
    .select('naics_codes, business_type, set_aside_preferences, target_agencies, agencies') as any)
    .eq('user_email', email)
    .maybeSingle();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'AI service not configured' },
      { status: 500 }
    );
  }

  const prompt = buildPrompt(opp, profile || {});

  let response: Response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a federal contracting BD analyst. You return only valid JSON in the exact shape requested — no markdown, no prose, no code fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    await logToolError({
      tool: ToolNames.ANALYST,
      errorType: classifyError(err instanceof Error ? err : new Error(String(err))),
      errorMessage: err instanceof Error ? err.message : String(err),
      requestPath: '/api/analyst/bid-no-bid',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    }).catch(() => {});
    return NextResponse.json(
      { success: false, error: 'Could not reach AI service' },
      { status: 502 }
    );
  }

  if (!response.ok) {
    const upstreamText = await response.text().catch(() => '');
    await logToolError({
      tool: ToolNames.ANALYST,
      errorType: response.status === 429 ? 'ai_rate_limit' : 'api_error',
      errorMessage: `Groq ${response.status}: ${upstreamText.slice(0, 500)}`,
      requestPath: '/api/analyst/bid-no-bid',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    }).catch(() => {});
    return NextResponse.json(
      { success: false, error: `AI service returned ${response.status}` },
      { status: 502 }
    );
  }

  const payload = await response.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (payload as any)?.choices?.[0]?.message?.content as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = (payload as any)?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  if (!content) {
    await logToolError({
      tool: ToolNames.ANALYST,
      errorType: 'api_error',
      errorMessage: 'Groq returned empty content',
      requestPath: '/api/analyst/bid-no-bid',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Empty AI response' }, { status: 502 });
  }

  const analysis = parseAnalystJson(content);
  if (!analysis) {
    await logToolError({
      tool: ToolNames.ANALYST,
      errorType: 'validation',
      errorMessage: `Could not parse JSON from Groq output: ${content.slice(0, 300)}`,
      requestPath: '/api/analyst/bid-no-bid',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    }).catch(() => {});
    return NextResponse.json(
      { success: false, error: 'AI returned malformed output' },
      { status: 502 }
    );
  }

  // Clamp score to [0, 100] in case the model returned out-of-range.
  const score = Math.max(0, Math.min(100, Math.round(analysis.score)));
  analysis.score = score;

  // Cache (upsert so force=true overwrites).
  const cacheRow = {
    notice_id: noticeId,
    user_email: email,
    recommendation: analysis,
    score,
    recommendation_label: analysis.recommendation,
    model_used: GROQ_MODEL,
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    generated_at: new Date().toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: cacheError } = await (supabase
    .from('analyst_bid_no_bid_cache')
    .upsert(cacheRow, { onConflict: 'notice_id,user_email' }) as any);

  if (cacheError) {
    // Non-fatal — return the analysis even if the cache write failed.
    // Future requests will just re-run Groq.
    console.warn('[analyst] cache write failed:', cacheError.message);
  }

  recordToolSuccess(ToolNames.ANALYST).catch(() => {});

  return NextResponse.json({
    success: true,
    cached: false,
    analysis,
    generated_at: cacheRow.generated_at,
    model: GROQ_MODEL,
  });
}
