/**
 * /api/app/market-narrative — Mindy Says AI narrative for the
 * Market Map flagship view.
 *
 * Turns the pile of agency / spending / set-aside / primes data
 * into a 3-sentence market read + 3 recommended next actions that
 * a BD person could screenshot for their boss or paste into a
 * customer deck.
 *
 * Cached per (naics, business_type, user_email) for 7 days in
 * market_narrative_cache. Cache hit = ~50ms. Cache miss = ~2-3s
 * Groq call.
 *
 * Pro-gated (free users see a teaser placeholder client-side).
 *
 * Verbs:
 *   POST { naics, businessType, email, summaryStats } — returns
 *         { success, narrative: { summary, actions }, cached }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { logToolError, classifyError, ToolNames, AIProviders } from '@/lib/tool-errors';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';
import { smallBizSharePct } from './share';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

interface AgencySummary {
  contractingOffice?: string;
  parentAgency?: string;
  spending?: number;
  contractCount?: number;
}

interface PrimeSummary {
  name: string;
  reason?: string;
}

interface NarrativeRequest {
  naics?: string;
  naicsCode?: string;
  businessType?: string;
  email?: string;
  totalSpending?: number;
  satTotal?: number;
  // Denominator for the small-business SHARE %. MUST be the total over the same
  // row set satTotal was summed over — NOT totalSpending (a different, often
  // much smaller department-level scalar), which produced "13935% of total".
  satBase?: number;
  agencyCount?: number;
  topAgencies?: AgencySummary[];
  topPrimes?: PrimeSummary[];
}


interface NarrativeResponse {
  summary: string;
  actions: Array<{ label: string; link?: string }>;
}

// --- Fact guardrail ----------------------------------------------
//
// The #1 rule: dollar/agency/name FACTS must come from real data, never an
// LLM guess. This card sits next to the ground-truth table, so a hallucinated
// figure or agency is a visible contradiction. We validate every $ figure the
// model emits against the real input numbers; if any figure can't be matched,
// we throw the LLM output away and serve a deterministic summary built only
// from real stats. (Names are not hard-blocked — the deterministic fallback is
// the safety net for both, and a mismatched $ is the strongest fabrication tell.)

const formatMoney = (n: number): string => {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
};

// Parse a "$1.8B" / "$491.5M" / "$250K" token back to a number.
function parseMoneyToken(tok: string): number | null {
  const m = tok.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([BMK])?/i);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(base)) return null;
  const unit = (m[2] || '').toUpperCase();
  if (unit === 'B') return base * 1_000_000_000;
  if (unit === 'M') return base * 1_000_000;
  if (unit === 'K') return base * 1_000;
  return base;
}

// The set of real dollar figures the narrative is allowed to cite.
function realFigures(req: NarrativeRequest): number[] {
  const figs: number[] = [];
  if (req.totalSpending) figs.push(req.totalSpending);
  if (req.satTotal) figs.push(req.satTotal);
  for (const a of req.topAgencies || []) if (a.spending) figs.push(a.spending);
  return figs.filter((n) => n > 0);
}

// True if `cited` is within 5% of any real figure (covers $1.8B-style rounding).
function figureMatchesReal(cited: number, real: number[]): boolean {
  return real.some((r) => r > 0 && Math.abs(cited - r) / r <= 0.05);
}

// Does the LLM text only cite dollar figures that exist in the real data?
function narrativeFiguresAreReal(narr: NarrativeResponse, req: NarrativeRequest): boolean {
  const real = realFigures(req);
  const text = [narr.summary, ...(narr.actions || []).map((a) => a.label)].join(' ');
  const tokens = text.match(/\$\s*[\d,]+(?:\.\d+)?\s*[BMK]?/gi) || [];
  for (const tok of tokens) {
    const val = parseMoneyToken(tok);
    if (val === null) continue;
    if (!figureMatchesReal(val, real)) return false; // a $ figure not in the data → reject
  }
  // Percentage sanity: a "share" can't exceed 100%. Catches the 13935%/432.7%
  // class that the $-only check let through (Jul 8). Any %>110 (small rounding
  // headroom) → reject so the deterministic path (clamped) is used instead.
  const pctTokens = text.match(/\d[\d,]*(?:\.\d+)?\s*%/g) || [];
  for (const tok of pctTokens) {
    const val = parseFloat(tok.replace(/[,%\s]/g, ''));
    if (Number.isFinite(val) && val > 110) return false;
  }
  return true;
}

// Deterministic, real-data-only summary — the safe fallback when the LLM
// strays. Uses ONLY agency names + figures from the structured payload.
function deterministicNarrative(req: NarrativeRequest): NarrativeResponse {
  const naics = req.naics || req.naicsCode || 'this market';
  const top = (req.topAgencies || []).filter((a) => (a.spending || 0) > 0).slice(0, 3);
  const total = req.totalSpending || top.reduce((s, a) => s + (a.spending || 0), 0);
  const sharePct = smallBizSharePct(req);
  const satPct = sharePct !== null ? Math.round(sharePct) : null;

  const lead = top.length
    ? `${formatMoney(total)} in tracked spend for NAICS ${naics}, led by ${top
        .map((a) => `${a.contractingOffice || a.parentAgency || 'an agency'} (${formatMoney(a.spending || 0)})`)
        .join(', ')}.`
    : `${formatMoney(total)} in tracked spend for NAICS ${naics}.`;
  const sat = satPct !== null
    ? ` Small-business set-aside addressable share is about ${satPct}% of total.`
    : '';

  const actions: Array<{ label: string }> = [];
  if (top[0]) actions.push({ label: `Target ${top[0].contractingOffice || top[0].parentAgency} — top buyer at ${formatMoney(top[0].spending || 0)}` });
  if (top[1]) actions.push({ label: `Add ${top[1].contractingOffice || top[1].parentAgency} (${formatMoney(top[1].spending || 0)}) to your agency watchlist` });
  actions.push({ label: 'Set up daily alerts on this NAICS to catch new solicitations' });

  return { summary: (lead + sat).slice(0, 600), actions: actions.slice(0, 3) };
}

// --- Prompt builder ----------------------------------------------
//
// The contract: we give Groq the stats + ask for JSON only. Tone
// guidance lives in the system prompt so we don't burn tokens on
// it in every user message. Output shape matches the cache table
// `narrative` column so we can stash it without reshaping.
function buildPrompt(req: NarrativeRequest): string {
  const naics = req.naics || req.naicsCode || '';
  const top10 = (req.topAgencies || []).slice(0, 10);
  const top5Primes = (req.topPrimes || []).slice(0, 5);

  const formatM = formatMoney;

  const sharePct = smallBizSharePct(req);
  const satPct = sharePct !== null ? sharePct.toFixed(1) : null;

  return [
    `Analyze this federal market for a BD professional pursuing NAICS ${naics}${req.businessType ? ` as a ${req.businessType} firm` : ''}.`,
    ``,
    `# Market Stats`,
    `- Total tracked spend: ${formatM(req.totalSpending || 0)}`,
    `- Agencies buying: ${req.agencyCount || (req.topAgencies?.length ?? 0)}`,
    satPct ? `- Set-Aside (SAT) share: ${satPct}% of total — addressable for small business under $250K contracts` : '',
    ``,
    `# Top Agencies (by tracked spend)`,
    ...top10.map(a => `- ${a.contractingOffice || a.parentAgency || 'Unknown'} — ${formatM(a.spending || 0)} (${a.contractCount || 0} contracts)`),
    ``,
    `# Top Primes`,
    ...top5Primes.map(p => `- ${p.name}${p.reason ? ` — ${p.reason}` : ''}`),
    ``,
    `# Your Task`,
    `Return JSON in this exact shape:`,
    `{`,
    `  "summary": "Three concise sentences a BD pro would say to their boss. Lead with the BIG observation (concentration, growth, set-aside opportunity). Reference 2-3 specific agencies or primes by name. Be honest — call out crowded markets or weak signals if you see them.",`,
    `  "actions": [`,
    `    {"label": "Specific next action #1 (e.g. 'Reach out to DOD OSBP — they spent $1.8B in this NAICS')"},`,
    `    {"label": "Specific next action #2 (e.g. 'Track Booz Allen recompetes — 3 contracts expire in 18mo')"},`,
    `    {"label": "Specific next action #3 (e.g. 'Generate teaming partner list for IDV holders')"}`,
    `  ]`,
    `}`,
    ``,
    `Constraints:`,
    `- Summary: 2-4 sentences, max 350 chars. No bullet lists, no markdown.`,
    `- Actions: exactly 3. Each label under 100 chars. Concrete, not generic.`,
    `- Use real agency / prime names from the data above — do not invent.`,
    `- CRITICAL: every dollar figure you write MUST be copied verbatim from the stats above. Never compute, estimate, sum, or round to a new number. If you can't cite an exact figure from the data, omit the figure.`,
    `- Tone: confident, specific, no hedging. Talk like a senior BD analyst.`,
    `- No markdown headers or formatting in the values.`,
    `- Return ONLY the JSON object. No code fences, no prose.`,
  ].filter(Boolean).join('\n');
}

// --- Endpoint ----------------------------------------------------

export async function POST(request: NextRequest) {
  let body: NarrativeRequest = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = body.email || '';
  const naics = body.naics || body.naicsCode || '';
  const businessType = body.businessType || '';

  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  if (!naics) return NextResponse.json({ error: 'naics required' }, { status: 400 });

  // Pro gate. Free users get a 402 — UI renders an upgrade teaser.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      {
        upgrade_required: true,
        message: 'Mindy Says market narratives are included with Mindy Pro',
        teaser: {
          summary: 'Pro shows a 3-sentence AI read of your market + 3 recommended next actions, refreshed weekly.',
        },
      },
      { status: 402 }
    );
  }

  const supabase = getSupabase();
  const cacheKey = {
    naics_code: naics,
    business_type: businessType,
    user_email: email.toLowerCase(),
  };

  // Cache lookup first. Hit = 50ms; miss = full Groq call.
  try {
    const { data: cached } = await supabase
      .from('market_narrative_cache')
      .select('*')
      .eq('naics_code', cacheKey.naics_code)
      .eq('business_type', cacheKey.business_type)
      .eq('user_email', cacheKey.user_email)
      .maybeSingle();

    if (cached?.generated_at) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({
          success: true,
          narrative: cached.narrative as NarrativeResponse,
          cached: true,
          cache_age_ms: age,
          model_used: cached.model_used,
        });
      }
    }
  } catch (cacheErr) {
    console.warn('[market-narrative] cache lookup failed (proceeding live):', cacheErr);
  }

  // Cache miss / stale — call Groq.
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
  }

  const prompt = buildPrompt(body);

  // When the AI is unreachable / errors / returns garbage, don't show an error
  // card mid-demo — serve the real-data deterministic summary. Returns a 200 so
  // the UI renders a valid (if plainer) narrative.
  const serveFallback = (reason: string) =>
    NextResponse.json({
      success: true,
      narrative: deterministicNarrative(body),
      cached: false,
      fact_safe: true,
      model_used: 'deterministic-fallback',
      fallback_reason: reason,
    });

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
            content: 'You are a senior federal contracting BD analyst. You return only valid JSON in the exact shape requested — no markdown, no prose, no code fences. Speak confidently and reference real agency/prime names from the data.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    await logToolError({
      tool: ToolNames.ANALYST,
      errorType: classifyError(err instanceof Error ? err : new Error(String(err))),
      errorMessage: err instanceof Error ? err.message : String(err),
      requestPath: '/api/app/market-narrative',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    }).catch(() => {});
    return serveFallback('ai_unreachable');
  }

  if (!response.ok) {
    const upstreamText = await response.text().catch(() => '');
    await logToolError({
      tool: ToolNames.ANALYST,
      errorType: response.status === 429 ? 'ai_rate_limit' : 'api_error',
      errorMessage: `Groq ${response.status}: ${upstreamText.slice(0, 500)}`,
      requestPath: '/api/app/market-narrative',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    }).catch(() => {});
    return serveFallback(`ai_status_${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (payload as any)?.choices?.[0]?.message?.content as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = (payload as any)?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  if (!content) {
    return serveFallback('ai_empty');
  }

  // safeParseJSON handles code fences, wrapper prose, and 2-pass cleanup
  const narrative = safeParseJSON<NarrativeResponse | null>(content, {
    fallback: null,
    source: 'market-narrative',
  });
  if (!narrative) {
    return serveFallback('ai_malformed_json');
  }

  // Sanity-validate shape. Drop bogus actions, clamp summary length
  // so a misbehaving model can't blow up the UI card.
  if (!narrative.summary || typeof narrative.summary !== 'string') {
    return serveFallback('ai_missing_summary');
  }
  narrative.summary = narrative.summary.slice(0, 600);
  narrative.actions = Array.isArray(narrative.actions)
    ? narrative.actions
        .filter(a => a && typeof a.label === 'string')
        .slice(0, 3)
        .map(a => ({ label: a.label.slice(0, 150), link: typeof a.link === 'string' ? a.link.slice(0, 300) : undefined }))
    : [];

  // FACT GUARDRAIL: if the model cited any dollar figure that isn't in the real
  // input data, it's fabricating — discard the LLM output and serve a
  // deterministic real-data-only summary. This card sits beside the ground-truth
  // table, so a stray figure would be a visible contradiction (the #1 rule).
  let factSafe = true;
  if (!narrativeFiguresAreReal(narrative, body)) {
    factSafe = false;
    const safe = deterministicNarrative(body);
    narrative.summary = safe.summary;
    narrative.actions = safe.actions;
    console.warn('[market-narrative] LLM cited a non-real $ figure — served deterministic fallback', { naics, email: email.toLowerCase() });
  }

  const modelUsed = factSafe ? GROQ_MODEL : `${GROQ_MODEL}+deterministic-fallback`;

  // Write to cache. Failures are non-fatal — the user still gets
  // the live narrative; only repeat-visit performance is degraded.
  try {
    await supabase
      .from('market_narrative_cache')
      .upsert({
        ...cacheKey,
        narrative,
        model_used: modelUsed,
        prompt_tokens: usage?.prompt_tokens || null,
        completion_tokens: usage?.completion_tokens || null,
        generated_at: new Date().toISOString(),
      }, { onConflict: 'naics_code,business_type,user_email' });
  } catch (cacheWriteErr) {
    console.warn('[market-narrative] cache write failed:', cacheWriteErr);
  }

  return NextResponse.json({
    success: true,
    narrative,
    cached: false,
    fact_safe: factSafe,
    model_used: modelUsed,
  });
}
