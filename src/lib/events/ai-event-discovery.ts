/**
 * AI Event Discovery — Slice 5 of the Target Market Research roadmap.
 *
 * Given an agency the user has saved to their target list, search the
 * open web for upcoming industry days, conferences, and matchmaking
 * events tied to that agency, then have an LLM extract structured,
 * dated events from the search snippets.
 *
 * Why AI-over-the-web instead of a scraper farm (roadmap, May 22):
 *   - 1 prompt × maintenance, not 150 scrapers × maintenance
 *   - Catches anything on the public web, adapts to site redesigns
 *   - Lazy: fires only when a user asks, not on a fixed schedule
 *
 * The LLM is GROUNDED in the Serper results — it extracts from the
 * snippets we hand it, it does not free-associate. Every event carries
 * a `confidence` 0..1 and `source: 'ai_web_search'` so the UI can show
 * a "Mindy found this — verify date" badge. We persist everything and
 * let the user judge (per product decision: show-all, badge low ones).
 *
 * This module is pure logic — no Supabase writes. The route
 * (/api/app/discover-events) owns persistence + throttling so this
 * stays testable and side-effect-free.
 */
import { searchWeb, isSerperConfigured } from '@/lib/briefings/web-intel';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Preferred event sources to bias the search toward — the orgs that
// actually run federal-relevant industry days and conferences.
const DEFAULT_PREFERRED_SOURCES = [
  'AFCEA', 'NDIA', 'ACT-IAC', 'SAME', 'GovEvents', 'SBA',
  'APEX Accelerators', 'industry day', 'small business conference',
];

export interface DiscoveredEvent {
  source: 'ai_web_search';
  title: string;
  event_type: string;        // 'industry_day' | 'conference' | 'webinar' | 'matchmaking' | 'other'
  event_date: string | null; // YYYY-MM-DD when the model is confident; null otherwise
  location: string | null;
  url: string | null;
  description: string | null;
  confidence: number;        // 0..1
}

export interface DiscoverEventsInput {
  agency: string;
  agencyAliases?: string[];
  horizonDays?: number;      // default 120 — conferences are planned far ahead
  preferredSources?: string[];
  /** Current year, passed in because Date.now() context varies. Used
   *  to bias queries toward the right year ("AFCEA 2026"). */
  currentYear: number;
}

export interface DiscoverEventsResult {
  events: DiscoveredEvent[];
  queriesUsed: string[];
  searchResultCount: number;
  reason?: string;           // populated when events is empty (why)
}

// --- Query builder ------------------------------------------------
//
// 3-5 targeted queries. We vary the angle: the agency's own outreach,
// the big association conferences, and small-business matchmaking —
// each surfaces different events.
function buildQueries(input: DiscoverEventsInput): string[] {
  const { agency, currentYear } = input;
  const sources = input.preferredSources || DEFAULT_PREFERRED_SOURCES;
  const nextYear = currentYear + 1;

  // Short agency handle for the association-conference query (e.g.
  // "Department of the Air Force" reads better as just "Air Force"
  // alongside "AFCEA").
  const shortAgency = agency.replace(/^(department of|the)\s+/i, '').trim();

  return [
    `${agency} industry day ${currentYear} OR ${nextYear} contractor outreach event`,
    `${agency} small business conference matchmaking ${currentYear} ${nextYear}`,
    `${sources.slice(0, 4).join(' OR ')} ${shortAgency} conference ${currentYear} ${nextYear} schedule`,
    `upcoming federal contracting events for ${shortAgency} vendors ${currentYear}`,
  ];
}

// --- Extraction prompt --------------------------------------------
//
// Grounded extraction: we give the model the raw snippets and tell it
// to ONLY extract events present in the text. The confidence field is
// its own honesty signal — undated/ambiguous => low confidence, not a
// fabricated date.
function buildExtractionPrompt(
  input: DiscoverEventsInput,
  snippets: string,
): string {
  return [
    `You are extracting UPCOMING federal-contracting events for a BD professional targeting "${input.agency}".`,
    `Horizon: events in roughly the next ${input.horizonDays || 120} days, or undated recurring conferences that clearly relate to this agency.`,
    ``,
    `Below are real web search results (title · url · snippet). Extract ONLY events that actually appear in these snippets. Do NOT invent events, dates, or URLs not present in the text.`,
    ``,
    `# Search Results`,
    snippets,
    ``,
    `# Your Task`,
    `Return JSON: { "events": [ ... ] }. Each event:`,
    `{`,
    `  "title": "exact event name from the snippet",`,
    `  "event_type": "industry_day" | "conference" | "webinar" | "matchmaking" | "other",`,
    `  "event_date": "YYYY-MM-DD" or null if no specific date is stated,`,
    `  "location": "city, ST" or null,`,
    `  "url": "the most relevant URL from the matching result, or null",`,
    `  "confidence": 0.0-1.0 — how sure you are this is a REAL, correctly-attributed, upcoming event for this agency`,
    `}`,
    ``,
    `Rules:`,
    `- confidence < 0.5 if the date is guessed, the agency link is loose, or the snippet is vague.`,
    `- confidence > 0.8 only when name + date + agency relevance are all clearly stated.`,
    `- Prefer specific dated events over generic "see our events page" listings.`,
    `- Skip clearly PAST events. Skip pure marketing pages with no event.`,
    `- Max 8 events. If nothing qualifies, return { "events": [] }.`,
    `- Return ONLY the JSON object. No code fences, no prose.`,
  ].join('\n');
}

// --- Main entry ----------------------------------------------------

export async function searchEventsViaAI(
  input: DiscoverEventsInput,
): Promise<DiscoverEventsResult> {
  if (!isSerperConfigured()) {
    return { events: [], queriesUsed: [], searchResultCount: 0, reason: 'web_search_not_configured' };
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { events: [], queriesUsed: [], searchResultCount: 0, reason: 'ai_not_configured' };
  }

  const queries = buildQueries(input);

  // 1) Web search (Serper). News off — events live on org pages, not
  // news feeds, and news adds noise here.
  const results = await searchWeb(queries, { includeNews: false, maxConcurrent: 3, delayMs: 200 });
  if (results.length === 0) {
    return { events: [], queriesUsed: queries, searchResultCount: 0, reason: 'no_search_results' };
  }

  // 2) Build the snippet block. Cap at 25 results to keep the prompt
  // bounded; Serper already deduped by URL.
  const snippets = results
    .slice(0, 25)
    .map((r, i) => `${i + 1}. ${r.title} · ${r.url}\n   ${r.snippet}`)
    .join('\n');

  const prompt = buildExtractionPrompt(input, snippets);

  // 3) Groq extraction.
  let response: Response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You extract structured event data from web search snippets. You only return events present in the provided text. You never fabricate dates or URLs. You return valid JSON only — no markdown, no code fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1400,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    return {
      events: [], queriesUsed: queries, searchResultCount: results.length,
      reason: `ai_unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      events: [], queriesUsed: queries, searchResultCount: results.length,
      reason: `ai_error_${response.status}: ${text.slice(0, 200)}`,
    };
  }

  const payload = await response.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (payload as any)?.choices?.[0]?.message?.content as string | undefined;
  if (!content) {
    return { events: [], queriesUsed: queries, searchResultCount: results.length, reason: 'ai_empty' };
  }

  const parsed = safeParseJSON<{ events?: unknown[] } | null>(content, {
    fallback: null,
    source: 'ai-event-discovery',
  });
  if (!parsed || !Array.isArray(parsed.events)) {
    return { events: [], queriesUsed: queries, searchResultCount: results.length, reason: 'ai_malformed' };
  }

  // 4) Validate + normalize. Drop anything without a title; clamp
  // confidence; coerce date format loosely (the model is told YYYY-MM-DD
  // but we guard anyway).
  const VALID_TYPES = new Set(['industry_day', 'conference', 'webinar', 'matchmaking', 'other']);
  const events: DiscoveredEvent[] = [];
  for (const raw of parsed.events.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    if (!title) continue;

    const type = typeof e.event_type === 'string' && VALID_TYPES.has(e.event_type) ? e.event_type : 'other';
    const dateRaw = typeof e.event_date === 'string' ? e.event_date.trim() : '';
    const event_date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

    let confidence = typeof e.confidence === 'number' ? e.confidence : 0.5;
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    events.push({
      source: 'ai_web_search',
      title: title.slice(0, 300),
      event_type: type,
      event_date,
      location: typeof e.location === 'string' && e.location.trim() ? e.location.trim().slice(0, 200) : null,
      url: typeof e.url === 'string' && e.url.startsWith('http') ? e.url.slice(0, 500) : null,
      description: typeof e.description === 'string' ? e.description.trim().slice(0, 500) : null,
      confidence,
    });
  }

  return {
    events,
    queriesUsed: queries,
    searchResultCount: results.length,
    reason: events.length === 0 ? 'no_events_extracted' : undefined,
  };
}
