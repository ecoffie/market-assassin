/**
 * Podcast episode metadata search.
 *
 * Complements the chunk-level FTS retrieval in `retrieveRagContext` by
 * answering episode-level questions that chunks can't:
 *   - "who's been on the show talking about HUBZone?"
 *   - "find episodes about VA contracts"
 *   - "guests from Booz Allen?"
 *
 * Strategy: light keyword routing on the user message → array-contains
 * + ILIKE against the structured columns in `podcast_episode_metadata`,
 * which was populated by `scripts/extract-podcast-metadata.js`
 * (411 extracted episodes as of 2026-05-29).
 *
 * Returns compact episode-summary cards (not full transcripts) for
 * injection alongside the chunk context. The chat already retrieves
 * transcript chunks; this layer adds "library overview" awareness.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _sb;
}

export interface PodcastEpisodeCard {
  episode_number: number | null;
  episode_title: string;
  episode_url: string | null;
  guest_name: string | null;
  guest_company: string | null;
  topics: string[];
  agencies_mentioned: string[];
  naics_mentioned: string[];
  set_asides_mentioned: string[];
  key_lessons: string[];
  summary_2sent: string | null;
}

const SET_ASIDE_VOCAB = ['8(a)', 'HUBZone', 'WOSB', 'EDWOSB', 'SDVOSB', 'VOSB', 'SDB'];
const NAICS_RE = /\b\d{6}\b/g;

// Known agency tokens — keep short, only well-known ones. We don't try
// to be exhaustive; the agencies_mentioned column already normalizes
// 200+ variations.
const AGENCY_TOKENS: Array<{ token: string; matches: string[] }> = [
  { token: 'va',    matches: ['Department of Veterans Affairs', 'VA'] },
  { token: 'dod',   matches: ['Department of Defense', 'DOD'] },
  { token: 'army',  matches: ['Department of the Army', 'US Army', 'Army Corps of Engineers'] },
  { token: 'navy',  matches: ['Department of the Navy', 'US Navy', 'NAVFAC'] },
  { token: 'air force', matches: ['Department of the Air Force', 'US Air Force'] },
  { token: 'gsa',   matches: ['General Services Administration', 'GSA'] },
  { token: 'dhs',   matches: ['Department of Homeland Security', 'DHS'] },
  { token: 'doe',   matches: ['Department of Energy', 'DOE'] },
  { token: 'doj',   matches: ['Department of Justice', 'DOJ'] },
  { token: 'state', matches: ['Department of State', 'State Department'] },
  { token: 'usaid', matches: ['USAID'] },
  { token: 'nasa',  matches: ['NASA'] },
  { token: 'sba',   matches: ['Small Business Administration', 'SBA'] },
];

/**
 * Pull search tokens out of a free-text user message.
 * Returns whichever structured filters look applicable. If none, we
 * fall back to summary/title ILIKE on the lowercased message keywords.
 */
function parseFilters(message: string) {
  const lower = message.toLowerCase();
  const naicsMatches = (message.match(NAICS_RE) || []).slice(0, 3);

  const setAsides = SET_ASIDE_VOCAB.filter(s => {
    const sLower = s.toLowerCase();
    // strip parens for tokens like 8(a)
    const stripped = sLower.replace(/[()]/g, '');
    return lower.includes(sLower) || lower.includes(stripped);
  });

  const agencyValues: string[] = [];
  for (const a of AGENCY_TOKENS) {
    if (lower.includes(a.token)) agencyValues.push(...a.matches);
  }

  // Title/summary keywords — take meaningful words >= 4 chars,
  // strip stopwords. The 6+ word cap keeps the OR clause tight.
  const stop = new Set(['what', 'when', 'where', 'which', 'about', 'with', 'this', 'that', 'have', 'find', 'show', 'tell', 'episode', 'episodes', 'guest', 'guests', 'podcast', 'mindy', 'please', 'there', 'these', 'those', 'their', 'them', 'they', 'from']);
  const words = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stop.has(w));
  const keywords = Array.from(new Set(words)).slice(0, 6);

  return { naicsMatches, setAsides, agencyValues, keywords };
}

export interface RetrievePodcastOptions {
  query: string;
  limit?: number;
}

/**
 * Returns up to `limit` episode cards matching the query. Empty array
 * when nothing structurally matches AND no keyword survives stopword
 * filtering — at which point chunk-level FTS will handle the question.
 */
export async function retrievePodcastEpisodes(opts: RetrievePodcastOptions): Promise<PodcastEpisodeCard[]> {
  const { query, limit = 4 } = opts;
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const f = parseFilters(trimmed);
  const sb = getSupabase();
  const results = new Map<string, PodcastEpisodeCard>();

  const baseCols = 'episode_number, episode_title, episode_url, guest_name, guest_company, topics, agencies_mentioned, naics_mentioned, set_asides_mentioned, key_lessons, summary_2sent';

  // Run each filter as its own query; merge by episode_title. This is
  // ~5 lightweight indexed lookups, cheaper than building one giant
  // disjunction client-side.
  const queries: Promise<{ data: PodcastEpisodeCard[] | null }>[] = [];

  if (f.naicsMatches.length) {
    queries.push(sb.from('podcast_episode_metadata')
      .select(baseCols)
      .overlaps('naics_mentioned', f.naicsMatches)
      .eq('extraction_status', 'extracted')
      .limit(limit) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>);
  }
  if (f.setAsides.length) {
    queries.push(sb.from('podcast_episode_metadata')
      .select(baseCols)
      .overlaps('set_asides_mentioned', f.setAsides)
      .eq('extraction_status', 'extracted')
      .limit(limit) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>);
  }
  if (f.agencyValues.length) {
    queries.push(sb.from('podcast_episode_metadata')
      .select(baseCols)
      .overlaps('agencies_mentioned', f.agencyValues)
      .eq('extraction_status', 'extracted')
      .limit(limit) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>);
  }
  // Fallback: ILIKE the summary and the title for the first 2 keywords.
  for (const kw of f.keywords.slice(0, 2)) {
    queries.push(sb.from('podcast_episode_metadata')
      .select(baseCols)
      .or(`summary_2sent.ilike.%${kw}%,episode_title.ilike.%${kw}%`)
      .eq('extraction_status', 'extracted')
      .limit(limit) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>);
  }

  if (queries.length === 0) return [];

  const settled = await Promise.allSettled(queries);
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !s.value.data) continue;
    for (const row of s.value.data) {
      const key = row.episode_title;
      if (!results.has(key)) results.set(key, row);
    }
  }

  return Array.from(results.values()).slice(0, limit);
}

/**
 * Format episode cards for the chat context block. Keeps each card to
 * ~5 lines so 4 cards stay under ~1500 chars.
 */
export function formatPodcastCardsForPrompt(cards: PodcastEpisodeCard[]): string {
  if (cards.length === 0) return '';
  return cards
    .map((c) => {
      const epLabel = c.episode_number ? `Episode ${c.episode_number}` : c.episode_title;
      const guest = c.guest_name ? ` — ${c.guest_name}${c.guest_company ? ` (${c.guest_company})` : ''}` : '';
      const tags: string[] = [];
      if (c.agencies_mentioned?.length) tags.push(`agencies: ${c.agencies_mentioned.slice(0, 3).join(', ')}`);
      if (c.set_asides_mentioned?.length) tags.push(`set-asides: ${c.set_asides_mentioned.slice(0, 3).join(', ')}`);
      if (c.naics_mentioned?.length) tags.push(`NAICS: ${c.naics_mentioned.slice(0, 3).join(', ')}`);
      const tagLine = tags.length ? `  ${tags.join(' | ')}\n` : '';
      const summary = c.summary_2sent ? `  ${c.summary_2sent.trim()}\n` : '';
      const lessons = c.key_lessons?.length
        ? `  Lessons: ${c.key_lessons.slice(0, 3).map(l => l.replace(/\s+/g, ' ').trim()).join(' · ')}\n`
        : '';
      return `### ${epLabel}${guest}\n${tagLine}${summary}${lessons}`.trimEnd();
    })
    .join('\n\n');
}
