/**
 * Daily Mindy Insight quote — powers the /app dashboard hero card.
 *
 * GET /api/app/dashboard/insight?email=
 *   Returns one quote for today (cached per-user per-day in
 *   dashboard_insights table). Generates fresh on first call of the
 *   day, returns cached on subsequent calls.
 *
 * Strategy (hybrid):
 *   1. Check cache — return immediately if today's row exists
 *   2. Try AI extraction from the user's most recent briefing template
 *   3. Fall back to deterministic data point (top opp, NAICS stat)
 *   4. Last resort: a static "Mindy is watching X opportunities today" message
 *
 * Content Reaper pattern #1 (visual quote cards) applied to in-app
 * surfaces. Browser does the Canvas rendering using the data returned
 * here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';
import { dateSeed, isSimilarToRecent, selectInsightOpportunities } from '@/lib/dashboard/insight-selection';

export const dynamic = 'force-dynamic';

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

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

// Mindy palette themes — single layout, themes cycle by day-of-week.
// Index 0-6 maps Sun-Sat. Frontend uses this to pick gradient + accent.
const TOTAL_THEMES = 4;
const RECENT_DEDUPE_DAYS = 5;
const MAX_GENERATION_ATTEMPTS = 3;
const INSIGHT_FORMATS = ['stat', 'question', 'contrarian', 'fragment', 'sentence'] as const;

interface InsightResponse {
  quote: string;
  format: string;             // 'stat' | 'question' | 'contrarian' | 'fragment' | 'sentence'
  source: 'ai_briefing' | 'deterministic_data' | 'fallback';
  attribution?: string;
  themeIndex: number;
  insightDate: string;
}

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;
  const supabase = getSupabase();

  // Key the daily insight on the USER's LOCAL date, not UTC. The client
  // passes its local YYYY-MM-DD via ?localDate=; without it the insight
  // flipped at UTC midnight (mid-evening for US users), so it looked
  // "stuck all day" then changed at a weird time. Validate the param
  // (YYYY-MM-DD) and fall back to UTC if absent/malformed.
  const localDateParam = (request.nextUrl.searchParams.get('localDate') || '').trim();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(localDateParam)
    ? localDateParam
    : new Date().toISOString().split('T')[0];
  // Theme rotates by day-of-week; derive it from `today` so it stays
  // consistent with the local date the insight is keyed on.
  const themeIndex = (new Date(`${today}T00:00:00Z`).getUTCDay()) % TOTAL_THEMES;

  // refresh=1 forces a NEW insight on demand (the "Refresh" control on
  // the card). It skips the daily cache read and overwrites the cached
  // row with a fresh pick.
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
  const refreshSeed = forceRefresh ? (new Date().getUTCMinutes() + 1) : 0;

  // 1. Check cache (unless forcing a refresh)
  const { data: cached } = forceRefresh
    ? { data: null }
    : await supabase
        .from('dashboard_insights')
        .select('quote, quote_format, source, attribution, theme_index, insight_date')
        .eq('user_email', userEmail)
        .eq('insight_date', today)
        .maybeSingle();

  if (cached) {
    return NextResponse.json({
      success: true,
      insight: {
        quote: cached.quote,
        format: cached.quote_format || 'sentence',
        source: cached.source as InsightResponse['source'],
        attribution: cached.attribution || undefined,
        themeIndex: cached.theme_index,
        insightDate: cached.insight_date,
      } satisfies InsightResponse,
      cached: true,
    });
  }

  const recentQuotes = await loadRecentInsightQuotes(userEmail, today);

  // 2. Try AI extraction from user's most recent briefing
  let insight: InsightResponse | null = null;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && !insight; attempt++) {
    try {
      const candidate = await extractFromBriefing(userEmail, themeIndex, today, refreshSeed + attempt);
      if (candidate && !isSimilarToRecent(candidate.quote, recentQuotes)) {
        insight = candidate;
      }
    } catch (err) {
      console.warn('[dashboard/insight] AI extraction failed:', err);
    }
  }

  // 3. Deterministic fallback: top opportunity or NAICS stat
  if (!insight) {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && !insight; attempt++) {
      try {
        const candidate = await deterministicFallback(userEmail, themeIndex, today, refreshSeed + attempt, recentQuotes);
        if (candidate && !isSimilarToRecent(candidate.quote, recentQuotes)) {
          insight = candidate;
        }
      } catch (err) {
        console.warn('[dashboard/insight] deterministic fallback failed:', err);
      }
    }
  }

  // 4. Static last-resort fallback (every user always sees something)
  if (!insight) {
    insight = {
      quote: 'Federal contracts close 67% faster when you respond in Week 1.',
      format: 'stat',
      source: 'fallback',
      themeIndex,
      insightDate: today,
    };
  }

  // Persist for the day (idempotent — UNIQUE constraint will reject duplicates)
  try {
    await supabase.from('dashboard_insights').upsert({
      user_email: userEmail,
      insight_date: today,
      quote: insight.quote,
      quote_format: insight.format,
      source: insight.source,
      attribution: insight.attribution || null,
      theme_index: insight.themeIndex,
    }, { onConflict: 'user_email,insight_date' });
  } catch {
    // Non-fatal — return the insight anyway
  }

  return NextResponse.json({ success: true, insight, cached: false });
}

// ---- AI extraction from briefing -----------------------------------

async function extractFromBriefing(
  userEmail: string,
  themeIndex: number,
  today: string,
  rotateSeed = 0
): Promise<InsightResponse | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const supabase = getSupabase();

  // Get this user's briefing data — first check user_notification_settings
  // for their profile hash, then find the most recent briefing template
  const { data: settings } = await supabase
    .from('user_notification_settings')
    .select('naics_profile_hash')
    .eq('user_email', userEmail)
    .maybeSingle();

  if (!settings?.naics_profile_hash) return null;

  const { data: template } = await supabase
    .from('briefing_templates')
    .select('briefing_content, generated_at')
    .eq('naics_profile_hash', settings.naics_profile_hash)
    .eq('briefing_type', 'daily')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!template?.briefing_content) return null;

  // Build a tight prompt around a date-rotated focus opportunity. Briefing
  // templates change slowly, so always sending the top five makes the model
  // keep extracting the same #1 opportunity day after day.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const briefing = template.briefing_content as any;
  const opps = selectInsightOpportunities(briefing.opportunities || [], today, rotateSeed, 5);
  if (opps.length === 0) return null;
  const angle = INSIGHT_FORMATS[(dateSeed(today) + rotateSeed) % INSIGHT_FORMATS.length];

  const oppSummary = opps.map((o, index) =>
    `${index === 0 ? 'FOCUS' : 'Context'}: ${o.contractName || 'Unnamed'} @ ${o.agency || 'unknown agency'} (${o.value || 'TBD'})`
  ).join('\n');

  const systemPrompt = `You are extracting ONE shareable insight from a federal contracting briefing for a small business user. Output JSON only.

Shape: { "quote": "...", "format": "stat" | "question" | "contrarian" | "fragment" | "sentence", "attribution": "Optional — agency name or briefing source" }

Rules:
- Quote ≤15 words. Punchy, scannable, makes the user want to look at the briefing.
- format: pick ONE that fits the quote shape.
- Anchor in REAL data from the briefing — agency name, $ value, opportunity count, NAICS — not generic federal-speak.
- Prefer the FOCUS opportunity. Do not default to the first opportunity from yesterday's briefing.
- Today's angle should be "${angle}" unless the data strongly fits a better shape.
- NO "world-class", "best-in-class", "cutting-edge", "leverage", "innovative".
- NO "In today's federal landscape..." style intros.`;

  const userPrompt = `Today's briefing top opportunities:
${oppSummary}

Extract ONE shareable insight as JSON.`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = safeParseJSON<{ quote?: string; format?: string; attribution?: string }>(content, {
      fallback: {},
      source: 'dashboard.insight.aiExtract',
    });
    const quote = (parsed.quote || '').trim();
    if (!quote || quote.length < 5 || quote.length > 200) return null;

    return {
      quote,
      format: (parsed.format || 'sentence').slice(0, 20),
      source: 'ai_briefing',
      attribution: parsed.attribution || undefined,
      themeIndex,
      insightDate: today,
    };
  } catch {
    return null;
  }
}

// ---- Deterministic fallback (no AI) --------------------------------

async function deterministicFallback(
  userEmail: string,
  themeIndex: number,
  today: string,
  // When the user forces a refresh, vary the pick so it doesn't return
  // the same day-indexed quote. Caller passes the current minute so
  // consecutive refreshes differ. Default 0 = the stable daily pick.
  rotateSeed = 0,
  recentQuotes: string[] = [],
): Promise<InsightResponse | null> {
  const supabase = getSupabase();

  // Try the user's profile to get NAICS for a NAICS-aware fact
  const { data: settings } = await supabase
    .from('user_notification_settings')
    .select('naics_codes, naics_profile_hash')
    .eq('user_email', userEmail)
    .maybeSingle();

  // Best fact we have without AI: count of opportunities in the user's
  // alert feed today
  if (settings?.naics_profile_hash) {
    const { count } = await supabase
      .from('alert_opportunities_cache')
      .select('id', { count: 'exact', head: true })
      .eq('user_email', userEmail);
    if (count && count > 0) {
      const naicsCount = (settings.naics_codes || []).length;
      return {
        quote: naicsCount > 0
          ? `${count} opportunities matched your ${naicsCount} NAICS code${naicsCount === 1 ? '' : 's'} today.`
          : `${count} federal opportunities flagged for your profile today.`,
        format: 'stat',
        source: 'deterministic_data',
        themeIndex,
        insightDate: today,
      };
    }
  }

  // Profile-less or empty: a NAICS-agnostic federal fact rotating by date
  // (deterministic across users so we don't burn the surprise of fresh AI)
  const PROFILE_LESS_QUOTES: Array<{ quote: string; format: string }> = [
    { quote: 'Federal SAM.gov posts 3,000+ new opportunities every week.', format: 'stat' },
    { quote: 'Small business set-asides hit $183B in FY25.', format: 'stat' },
    { quote: 'Why do most small businesses miss their first federal bid?', format: 'question' },
    { quote: 'The agency wants you. They just don\'t know your name yet.', format: 'contrarian' },
    { quote: 'Sources Sought windows decide who gets shortlisted.', format: 'sentence' },
    { quote: '40% of FY26 spending goes to small business — if they apply.', format: 'stat' },
    { quote: 'Your NAICS profile is your federal calling card.', format: 'fragment' },
  ];
  const dayIdx = dateSeed(today);
  let pick = PROFILE_LESS_QUOTES[(dayIdx + rotateSeed) % PROFILE_LESS_QUOTES.length];
  for (let offset = 1; offset < PROFILE_LESS_QUOTES.length && isSimilarToRecent(pick.quote, recentQuotes); offset++) {
    pick = PROFILE_LESS_QUOTES[(dayIdx + rotateSeed + offset) % PROFILE_LESS_QUOTES.length];
  }
  return {
    quote: pick.quote,
    format: pick.format,
    source: 'deterministic_data',
    themeIndex,
    insightDate: today,
  };
}

async function loadRecentInsightQuotes(userEmail: string, today: string): Promise<string[]> {
  try {
    const { data } = await getSupabase()
      .from('dashboard_insights')
      .select('quote')
      .eq('user_email', userEmail)
      .lt('insight_date', today)
      .order('insight_date', { ascending: false })
      .limit(RECENT_DEDUPE_DAYS);
    return (data || []).map((row: { quote?: string | null }) => row.quote || '').filter(Boolean);
  } catch {
    return [];
  }
}
