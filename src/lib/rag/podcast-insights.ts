/**
 * Podcast guest insights for Mindy Insight (Today's Intel hero card).
 *
 * Surfaces actionable quotes from GovCon Giants Podcast guests, matched
 * to the user's NAICS profile — Founders-style "notes" from the
 * `key_lessons` field in podcast_episode_metadata (populated by
 * scripts/extract-podcast-metadata.js across the full back-catalog).
 *
 * Complements:
 *   - mindy-insights.ts (notice-type buckets in daily email — Eric corpus)
 *   - dashboard/insight (briefing AI + deterministic — this adds guest voice)
 *   - podcast-search.ts (episode cards for Mindy Chat)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { retrievePodcastEpisodes, type PodcastEpisodeCard } from '@/lib/rag/podcast-search';
import { dateSeed, isSimilarToRecent } from '@/lib/dashboard/insight-selection';
import {
  assessHighlightQuality,
  lessonPassesProductionGate,
  trimForMindyCard,
} from '@/lib/rag/podcast-highlight-quality';
import { isPodcastInsightEnabled } from '@/lib/rag/podcast-insights-flag';
import {
  filterByRelevance,
  RELEVANCE_THRESHOLDS,
  sortEpisodesByRelevance,
  type PodcastRelevanceResult,
} from '@/lib/rag/podcast-naics-relevance';

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

export interface PodcastInsightQuote {
  quote: string;
  format: string;
  source: 'podcast_guest';
  attribution: string;
  guestName: string | null;
  guestCompany: string | null;
  episodeTitle: string;
  episodeUrl: string | null;
  episodeNumber: number | null;
  matchedNaics: string[];
  relevanceScore: number;
  matchTier: PodcastRelevanceResult['matchTier'];
}

interface ScoredEpisodeCard extends PodcastEpisodeCard {
  relevance: PodcastRelevanceResult;
}

interface LessonCandidate {
  quote: string;
  score: number;
  card: ScoredEpisodeCard;
  lessonIndex: number;
}

const MIN_QUOTE_CHARS = 24;

/**
 * Build a NAICS-aware search query from the user's profile codes.
 */
function buildProfileQuery(naicsCodes: string[], agencies: string[]): string {
  const naics = naicsCodes
    .map((c) => String(c || '').replace(/\D/g, '').slice(0, 6))
    .filter((c) => c.length >= 4)
    .slice(0, 4);
  const agencyHint = agencies.slice(0, 2).join(' ');
  if (naics.length) {
    return `${naics.join(' ')} ${agencyHint} federal contracting`.trim();
  }
  return `${agencyHint} federal contracting small business`.trim();
}

function scoreLesson(lesson: string, card: ScoredEpisodeCard, userNaics: string[]): number {
  let score = 10 + Math.round(card.relevance.relevanceScore * 0.45);
  const lessonLower = lesson.toLowerCase();
  const len = lesson.length;
  if (len >= 70 && len <= 160) score += 12;
  if (len >= 50 && len <= 200) score += 6;
  if (card.guest_name) score += 8;

  for (const code of userNaics) {
    const six = code.replace(/\D/g, '').slice(0, 6);
    const four = six.slice(0, 4);
    if (!six) continue;
    if (card.naics_mentioned?.some((n) => n.startsWith(six) || six.startsWith(n.slice(0, 6)))) {
      score += 20;
    } else if (four && card.naics_mentioned?.some((n) => n.startsWith(four))) {
      score += 10;
    }
    if (lessonLower.includes(six) || (four && lessonLower.includes(four))) score += 5;
  }

  // Prefer imperative / actionable phrasing
  if (/^(always|never|start|build|get|focus|before|when|if|the key)/i.test(lesson)) score += 4;
  if (/\b(should|must|need to|make sure)\b/i.test(lesson)) score += 3;
  // Penalize host-name leaks (exit strategy)
  if (/\beric\s+coff/i.test(lessonLower)) score -= 50;

  // Lesson mentions off-profile cluster (e.g. CMMC line for construction profile)
  if (card.relevance.reasons.some((r) => r.startsWith('off-profile'))) {
    if (/\bcmmc|cyber|nist|800-171\b/i.test(lessonLower) && !/\bconstruction|contractor|236|237\b/i.test(lessonLower)) {
      score -= 35;
    }
  }

  return score;
}

function formatAttribution(card: PodcastEpisodeCard): string {
  const parts: string[] = [];
  if (card.guest_name) {
    parts.push(card.guest_name);
    if (card.guest_company) parts.push(card.guest_company);
  }
  const ep = card.episode_number ? `Ep. ${card.episode_number}` : 'GovCon Giants Podcast';
  parts.push(ep);
  return parts.join(' · ');
}

function trimQuote(text: string): string {
  return trimForMindyCard(text);
}

function collectCandidates(
  cards: ScoredEpisodeCard[],
  userNaics: string[],
  seed: number,
  qualityGate = false,
): LessonCandidate[] {
  const out: LessonCandidate[] = [];
  for (let ci = 0; ci < cards.length; ci++) {
    const card = cards[ci];
    const lessons = (card.key_lessons || []).filter(Boolean);
    for (let li = 0; li < lessons.length; li++) {
      const raw = lessons[li].trim();
      if (raw.length < MIN_QUOTE_CHARS) continue;
      if (qualityGate) {
        const q = assessHighlightQuality(raw, { hasGuest: !!card.guest_name });
        if (!lessonPassesProductionGate(q, card.relevance.relevanceScore, card.relevance.matchTier)) {
          continue;
        }
      }
      const quote = trimQuote(raw);
      if (quote.length < MIN_QUOTE_CHARS) continue;
      out.push({
        quote,
        score: scoreLesson(raw, card, userNaics) + (ci === 0 ? 5 : 0),
        card,
        lessonIndex: li,
      });
    }
  }
  // Stable rotate: bump score for lessons picked by seed so refresh cycles
  for (const c of out) {
    c.score += ((seed + c.lessonIndex * 7) % 11);
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Direct NAICS overlap query when keyword routing returns thin results.
 */
async function fetchByNaicsOverlap(naicsCodes: string[], limit: number): Promise<PodcastEpisodeCard[]> {
  const codes = naicsCodes
    .map((c) => String(c || '').replace(/\D/g, '').slice(0, 6))
    .filter((c) => c.length === 6);
  if (!codes.length) return [];

  const sb = getSupabase();
  const { data } = await sb
    .from('podcast_episode_metadata')
    .select(
      'episode_number, episode_title, episode_url, guest_name, guest_company, topics, agencies_mentioned, naics_mentioned, set_asides_mentioned, key_lessons, summary_2sent, business_type, transcript_keywords, personas'
    )
    .overlaps('naics_mentioned', codes)
    .eq('extraction_status', 'extracted')
    .not('guest_name', 'is', null)
    .not('key_lessons', 'eq', '{}')
    .limit(limit);

  return (data || []) as PodcastEpisodeCard[];
}

function rankEpisodesForProfile(
  cards: PodcastEpisodeCard[],
  userNaics: string[],
  minRelevance: number,
): ScoredEpisodeCard[] {
  const scored = sortEpisodesByRelevance(cards, userNaics) as ScoredEpisodeCard[];
  let filtered = filterByRelevance(scored, minRelevance);
  if (!filtered.length && minRelevance > RELEVANCE_THRESHOLDS.admin) {
    filtered = scored.filter(
      (r) =>
        r.relevance.relevanceScore >= RELEVANCE_THRESHOLDS.admin &&
        (r.relevance.matchTier === 'primary' || r.relevance.matchTier === 'sector'),
    );
  }
  return filtered;
}

/**
 * Pick one guest quote matched to the user's NAICS (and optional agencies).
 * Returns null when no extracted metadata matches or all candidates dedupe.
 */
export async function getPodcastInsightForProfile(opts: {
  naicsCodes: string[];
  agencies?: string[];
  today: string;
  rotateSeed?: number;
  recentQuotes?: string[];
  /** QA mode: only surface lessons scored "good" by highlight heuristics */
  qualityGate?: boolean;
}): Promise<PodcastInsightQuote | null> {
  const naicsCodes = (opts.naicsCodes || [])
    .map((c) => String(c || '').replace(/\D/g, '').slice(0, 6))
    .filter((c) => c.length >= 4);
  if (!naicsCodes.length) return null;

  const agencies = (opts.agencies || []).map((a) => String(a || '').trim()).filter(Boolean);
  const seed = dateSeed(opts.today) + (opts.rotateSeed || 0);
  const recent = opts.recentQuotes || [];

  const query = buildProfileQuery(naicsCodes, agencies);
  // Relevance floor is the same for preview "ungated" browse — only lesson gate differs
  const minRelevance = RELEVANCE_THRESHOLDS.production;

  const [keywordCards, overlapCards] = await Promise.all([
    retrievePodcastEpisodes({ query, limit: 12 }),
    fetchByNaicsOverlap(naicsCodes, 80),
  ]);

  // Merge episode cards by title
  const byTitle = new Map<string, PodcastEpisodeCard>();
  for (const c of [...overlapCards, ...keywordCards]) {
    if (!c.key_lessons?.length || !c.guest_name) continue;
    byTitle.set(c.episode_title, c);
  }
  const ranked = rankEpisodesForProfile(Array.from(byTitle.values()), naicsCodes, minRelevance);
  if (!ranked.length) return null;

  const candidates = collectCandidates(ranked, naicsCodes, seed, !!opts.qualityGate);
  if (!candidates.length) return null;

  const start = seed % candidates.length;
  const rotated = candidates.slice(start).concat(candidates.slice(0, start));

  for (const pick of rotated) {
    if (isSimilarToRecent(pick.quote, recent)) continue;
    return {
      quote: pick.quote,
      format: 'sentence',
      source: 'podcast_guest',
      attribution: formatAttribution(pick.card),
      guestName: pick.card.guest_name,
      guestCompany: pick.card.guest_company,
      episodeTitle: pick.card.episode_title,
      episodeUrl: pick.card.episode_url,
      episodeNumber: pick.card.episode_number,
      matchedNaics: pick.card.relevance.matchedNaics.slice(0, 3),
      relevanceScore: pick.card.relevance.relevanceScore,
      matchTier: pick.card.relevance.matchTier,
    };
  }

  return null;
}

/** Whether Today's Intel should use podcast guest quotes for this user. */
export function podcastInsightFeatureEnabled(userEmail: string): boolean {
  return isPodcastInsightEnabled(userEmail);
}
