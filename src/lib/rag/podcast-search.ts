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

/**
 * Repair episode URLs that were stored as `https:libsyn.com/...`
 * (missing the `//` after the scheme) by an older version of the
 * metadata extractor. Without this, Safari treats them as
 * same-origin relative paths and 404s on getmindy.ai.
 */
function normalizeEpisodeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https:(?!\/\/)/, 'https://').replace(/^http:(?!\/\/)/, 'http://');
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
  // Layer-2 fields, null until the re-extraction has run for an episode.
  business_type?: 'product' | 'service' | 'both' | null;
  transcript_keywords?: string[] | null;
  personas?: string[] | null;
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

// Words that signal "this episode is about selling PRODUCTS to the
// government" (reseller, distributor, hardware on a GSA Schedule)
// vs "this episode is about selling SERVICES" (consulting, labor).
// Used to route queries like "product sales" → business_type=product.
const PRODUCT_SIGNALS = ['product', 'products', 'reseller', 'resell', 'reselling', 'distributor', 'distribution', 'hardware', 'equipment', 'wholesale', 'catalog', 'gsa schedule', 'schedule contract', 'commodity'];
const SERVICE_SIGNALS = ['service', 'services', 'consulting', 'labor', 'staffing', 'janitorial', 'maintenance contract', 'professional services'];

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

  // Guest-name detection. Two heuristics:
  //  1. Two-word capitalized sequences in the ORIGINAL casing —
  //     "Ryan Atencio", "Megan Sheckles" — typical when a user names
  //     a guest. We split into individual tokens for the trigram
  //     search; matching on either word produces a hit, then the
  //     intersection wins the dedup.
  //  2. Single capitalized last-name-shaped token (4+ chars) so
  //     "Atencio" alone still pulls Ryan.
  const guestNameTokens: string[] = [];
  const properRe = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = properRe.exec(message))) {
    guestNameTokens.push(m[1], m[2]);
  }
  // De-dupe + drop obvious non-guest proper nouns that collide
  // with our agency / vocab tables.
  const guestBlacklist = new Set(['Veterans', 'Affairs', 'Defense', 'Energy', 'Justice', 'State', 'Homeland', 'Security', 'Services', 'Administration', 'Department', 'United', 'States', 'Army', 'Navy', 'Air', 'Force', 'Coast', 'Guard', 'Marine', 'Corps', 'Small', 'Business', 'Sources', 'Sought']);
  const guestNames = Array.from(new Set(guestNameTokens)).filter(t => !guestBlacklist.has(t));

  // Business-type signal: product vs service. Only fires when the
  // query is clearly one-sided. Mixed signals → null (don't filter).
  const productHit = PRODUCT_SIGNALS.some(s => lower.includes(s));
  const serviceHit = SERVICE_SIGNALS.some(s => lower.includes(s));
  let businessType: 'product' | 'service' | null = null;
  if (productHit && !serviceHit) businessType = 'product';
  else if (serviceHit && !productHit) businessType = 'service';

  // Title/summary keywords — take meaningful words >= 4 chars,
  // strip stopwords. The 6+ word cap keeps the OR clause tight.
  const stop = new Set(['what', 'when', 'where', 'which', 'about', 'with', 'this', 'that', 'have', 'find', 'show', 'tell', 'episode', 'episodes', 'guest', 'guests', 'podcast', 'mindy', 'please', 'there', 'these', 'those', 'their', 'them', 'they', 'from', 'discussed', 'discuss', 'another', 'where', 'talked', 'said']);
  const words = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stop.has(w));
  const keywords = Array.from(new Set(words)).slice(0, 6);

  return { naicsMatches, setAsides, agencyValues, guestNames, businessType, keywords };
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
  // Use a scored Map: key = episode_title, value = { row, score }
  // so we can rank by how many filters agreed instead of just dedup.
  const scored = new Map<string, { row: PodcastEpisodeCard; score: number }>();
  const addHits = (rows: PodcastEpisodeCard[] | null | undefined, points: number) => {
    if (!rows) return;
    for (const r of rows) {
      const key = r.episode_title;
      const prev = scored.get(key);
      if (prev) prev.score += points;
      else scored.set(key, { row: r, score: points });
    }
  };

  const baseCols = 'episode_number, episode_title, episode_url, guest_name, guest_company, topics, agencies_mentioned, naics_mentioned, set_asides_mentioned, key_lessons, summary_2sent, business_type, transcript_keywords, personas';

  // Run each filter as its own query; merge by episode_title. This is
  // ~5 lightweight indexed lookups, cheaper than building one giant
  // disjunction client-side. Scores per filter type — guest match is
  // the strongest signal because "Ryan Atencio" is a specific ask.
  const queries: Array<{ p: Promise<{ data: PodcastEpisodeCard[] | null }>; points: number }> = [];

  // Guest name search — runs per token via ILIKE (the trigram index
  // makes this fast). One hit per token contributes; episodes that
  // match both first AND last name end up with the highest score.
  for (const name of f.guestNames) {
    queries.push({
      p: sb.from('podcast_episode_metadata')
        .select(baseCols)
        .ilike('guest_name', `%${name}%`)
        .eq('extraction_status', 'extracted')
        .limit(limit * 2) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>,
      points: 50,  // dominant signal
    });
  }

  // business_type filter — pre-Layer-2 episodes don't have this
  // column populated yet, so this query returns nothing until the
  // re-extraction runs. Harmless meanwhile.
  if (f.businessType) {
    queries.push({
      p: sb.from('podcast_episode_metadata')
        .select(baseCols)
        .eq('business_type', f.businessType)
        .eq('extraction_status', 'extracted')
        .limit(limit * 2) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>,
      points: 20,
    });
  }

  if (f.naicsMatches.length) {
    queries.push({
      p: sb.from('podcast_episode_metadata')
        .select(baseCols)
        .overlaps('naics_mentioned', f.naicsMatches)
        .eq('extraction_status', 'extracted')
        .limit(limit * 2) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>,
      points: 15,
    });
  }
  if (f.setAsides.length) {
    queries.push({
      p: sb.from('podcast_episode_metadata')
        .select(baseCols)
        .overlaps('set_asides_mentioned', f.setAsides)
        .eq('extraction_status', 'extracted')
        .limit(limit * 2) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>,
      points: 15,
    });
  }
  if (f.agencyValues.length) {
    queries.push({
      p: sb.from('podcast_episode_metadata')
        .select(baseCols)
        .overlaps('agencies_mentioned', f.agencyValues)
        .eq('extraction_status', 'extracted')
        .limit(limit * 2) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>,
      points: 10,
    });
  }
  // Fallback: ILIKE the summary and the title for the first 2 keywords.
  for (const kw of f.keywords.slice(0, 2)) {
    queries.push({
      p: sb.from('podcast_episode_metadata')
        .select(baseCols)
        .or(`summary_2sent.ilike.%${kw}%,episode_title.ilike.%${kw}%`)
        .eq('extraction_status', 'extracted')
        .limit(limit) as unknown as Promise<{ data: PodcastEpisodeCard[] | null }>,
      points: 5,  // weakest signal
    });
  }

  if (queries.length === 0) return [];

  const settled = await Promise.allSettled(queries.map(q => q.p));
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status !== 'fulfilled' || !s.value.data) continue;
    // Repair URL on the way in; only the first sighting per episode
    // counts toward addHits, but score accumulates across queries.
    const rows = s.value.data.map(r => ({ ...r, episode_url: normalizeEpisodeUrl(r.episode_url) }));
    addHits(rows, queries[i].points);
  }

  // Sort by score desc and return top-N
  return Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.row);
}

/**
 * Format episode cards for the chat context block. Keeps each card to
 * ~5 lines so 4 cards stay under ~1500 chars.
 */
export function formatPodcastCardsForPrompt(cards: PodcastEpisodeCard[]): string {
  if (cards.length === 0) return '';
  return cards
    .map((c) => {
      const epLabel = c.episode_title ? (c.episode_number ? `Ep ${c.episode_number}: ${c.episode_title}` : c.episode_title) : (c.episode_number ? `Episode ${c.episode_number}` : 'GovCon Giants Podcast');
      const guest = c.guest_name ? ` — ${c.guest_name}${c.guest_company ? ` (${c.guest_company})` : ''}` : '';
      const tags: string[] = [];
      if (c.business_type) tags.push(`type: ${c.business_type}`);
      if (c.agencies_mentioned?.length) tags.push(`agencies: ${c.agencies_mentioned.slice(0, 3).join(', ')}`);
      if (c.set_asides_mentioned?.length) tags.push(`set-asides: ${c.set_asides_mentioned.slice(0, 3).join(', ')}`);
      if (c.naics_mentioned?.length) tags.push(`NAICS: ${c.naics_mentioned.slice(0, 3).join(', ')}`);
      if (c.personas?.length) tags.push(`for: ${c.personas.slice(0, 3).join(', ')}`);
      const tagLine = tags.length ? `  ${tags.join(' | ')}\n` : '';
      const summary = c.summary_2sent ? `  ${c.summary_2sent.trim()}\n` : '';
      const lessons = c.key_lessons?.length
        ? `  Lessons: ${c.key_lessons.slice(0, 3).map(l => l.replace(/\s+/g, ' ').trim()).join(' · ')}\n`
        : '';
      return `### ${epLabel}${guest}\n${tagLine}${summary}${lessons}`.trimEnd();
    })
    .join('\n\n');
}
