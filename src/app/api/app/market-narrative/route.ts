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
  agencyCount?: number;
  topAgencies?: AgencySummary[];
  topPrimes?: PrimeSummary[];
}

interface NarrativeResponse {
  summary: string;
  actions: Array<{ label: string; link?: string }>;
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

  const formatM = (n: number) => {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  };

  const satPct = (req.totalSpending && req.satTotal)
    ? ((req.satTotal / req.totalSpending) * 100).toFixed(1)
    : null;

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
    return NextResponse.json({ error: 'Could not reach AI service' }, { status: 502 });
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
    return NextResponse.json({ error: `AI service returned ${response.status}` }, { status: 502 });
  }

  const payload = await response.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (payload as any)?.choices?.[0]?.message?.content as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = (payload as any)?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  if (!content) {
    return NextResponse.json({ error: 'AI returned empty response' }, { status: 502 });
  }

  let narrative: NarrativeResponse;
  try {
    narrative = JSON.parse(content);
  } catch (err) {
    console.error('[market-narrative] JSON parse failed:', err, content.slice(0, 200));
    return NextResponse.json({ error: 'AI returned malformed JSON' }, { status: 502 });
  }

  // Sanity-validate shape. Drop bogus actions, clamp summary length
  // so a misbehaving model can't blow up the UI card.
  if (!narrative.summary || typeof narrative.summary !== 'string') {
    return NextResponse.json({ error: 'AI response missing summary' }, { status: 502 });
  }
  narrative.summary = narrative.summary.slice(0, 600);
  narrative.actions = Array.isArray(narrative.actions)
    ? narrative.actions
        .filter(a => a && typeof a.label === 'string')
        .slice(0, 3)
        .map(a => ({ label: a.label.slice(0, 150), link: typeof a.link === 'string' ? a.link.slice(0, 300) : undefined }))
    : [];

  // Write to cache. Failures are non-fatal — the user still gets
  // the live narrative; only repeat-visit performance is degraded.
  try {
    await supabase
      .from('market_narrative_cache')
      .upsert({
        ...cacheKey,
        narrative,
        model_used: GROQ_MODEL,
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
    model_used: GROQ_MODEL,
  });
}
