/**
 * NAICS / sector relevance scoring for podcast episode matching.
 *
 * Problem: Postgres `overlaps(naics_mentioned, user_codes)` returns any
 * episode that *mentioned* the user's code in passing (e.g. CMMC episode
 * that briefly references construction NAICS). We rank by how *targeted*
 * the episode is to the user's industry profile.
 */

import { getNaics } from '@/lib/codes/lookup';

export type NaicsMatchTier = 'primary' | 'sector' | 'tangential' | 'unrelated';

export interface PodcastRelevanceInput {
  naics_mentioned?: string[] | null;
  topics?: string[] | null;
  transcript_keywords?: string[] | null;
  personas?: string[] | null;
  business_type?: string | null;
  summary_2sent?: string | null;
  key_lessons?: string[] | null;
  episode_title?: string | null;
}

export interface PodcastRelevanceResult {
  relevanceScore: number;
  matchTier: NaicsMatchTier;
  matchedNaics: string[];
  userSectorLabels: string[];
  episodeSectorLabels: string[];
  reasons: string[];
}

/** Industry clusters — episode must align with user's cluster, not just share a NAICS digit */
const CLUSTERS: Array<{
  id: string;
  label: string;
  naicsPrefixes: string[];
  topicHints: RegExp[];
  textHints: RegExp[];
}> = [
  {
    id: 'construction',
    label: 'Construction',
    naicsPrefixes: ['23', '236', '237', '238'],
    topicHints: [/construction/, /contractor/, /building/, /surety/, /bonding/],
    textHints: [/construction|general contractor|surety bond|236\d|237\d|238\d/i],
  },
  {
    id: 'it_cyber',
    label: 'IT / Cyber',
    naicsPrefixes: ['5415', '518', '511', '5419'],
    topicHints: [/it-services/, /cyber/, /software/, /cmmc/, /cloud/],
    textHints: [/cmmc|cyber|nist|800-171|fedramp|541512|it services|saas|cloud security/i],
  },
  {
    id: 'professional',
    label: 'Professional services',
    naicsPrefixes: ['5416', '5413', '5414', '5411'],
    topicHints: [/consulting/, /engineering/, /management/],
    textHints: [/consulting|5416|engineering services|management consulting/i],
  },
  {
    id: 'facilities',
    label: 'Facilities / Janitorial',
    naicsPrefixes: ['561', '562'],
    topicHints: [/janitorial/, /facilities/, /maintenance/],
    textHints: [/janitorial|facilities maintenance|5617/i],
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    naicsPrefixes: ['62', '621', '622'],
    topicHints: [/healthcare/, /medical/],
    textHints: [/healthcare|medical|hospital|621/i],
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing / Products',
    naicsPrefixes: ['33', '32', '31'],
    topicHints: [/manufactur/, /product/, /reseller/, /distributor/],
    textHints: [/manufactur|reseller|distributor|gsa schedule|product sales/i],
  },
];

/** Calibrated on 236220 construction — 48 was filtering the entire pool in preview */
const MIN_RELEVANCE_PRODUCTION = 36;
const MIN_RELEVANCE_ADMIN = 22;
export function normalizeNaicsList(codes: string[]): string[] {
  return Array.from(
    new Set(
      codes
        .map((c) => String(c || '').replace(/\D/g, '').slice(0, 6))
        .filter((c) => c.length === 6),
    ),
  );
}

function naicsMatch(userCode: string, episodeCode: string): 'exact' | 'sector' | 'none' {
  const u = userCode.slice(0, 6);
  const e = episodeCode.slice(0, 6);
  if (u === e) return 'exact';
  if (u.slice(0, 4) === e.slice(0, 4)) return 'sector';
  if (u.slice(0, 2) === e.slice(0, 2)) return 'sector';
  return 'none';
}

function detectClusters(text: string, naics: string[]): string[] {
  const found = new Set<string>();
  const blob = text.toLowerCase();
  for (const c of CLUSTERS) {
    if (c.naicsPrefixes.some((p) => naics.some((n) => n.startsWith(p)))) found.add(c.id);
    if (c.topicHints.some((re) => re.test(blob))) found.add(c.id);
    if (c.textHints.some((re) => re.test(blob))) found.add(c.id);
  }
  return Array.from(found);
}

function sectorLabelsFromNaics(codes: string[]): string[] {
  const labels = new Set<string>();
  for (const code of codes) {
    const entry = getNaics(code.slice(0, 6)) || getNaics(code.slice(0, 4)) || getNaics(code.slice(0, 2));
    if (entry?.title) labels.add(entry.title.length > 48 ? `${code} (${entry.title.slice(0, 45)}…)` : `${code} — ${entry.title}`);
    else labels.add(code);
  }
  return Array.from(labels).slice(0, 4);
}

function episodeTextBlob(ep: PodcastRelevanceInput): string {
  return [
    ep.episode_title,
    ep.summary_2sent,
    ...(ep.topics || []),
    ...(ep.transcript_keywords || []),
    ...(ep.personas || []),
    ...(ep.key_lessons || []),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Score 0–100 how well an episode fits the user's NAICS profile.
 */
export function scorePodcastRelevance(
  episode: PodcastRelevanceInput,
  userNaicsRaw: string[],
): PodcastRelevanceResult {
  const userNaics = normalizeNaicsList(userNaicsRaw);
  const epNaics = normalizeNaicsList(episode.naics_mentioned || []);
  const reasons: string[] = [];
  let score = 0;

  const exact: string[] = [];
  const sector: string[] = [];

  for (const u of userNaics) {
    for (const e of epNaics) {
      const m = naicsMatch(u, e);
      if (m === 'exact' && !exact.includes(e)) exact.push(e);
      else if (m === 'sector' && !sector.includes(e) && !exact.includes(e)) sector.push(e);
    }
  }

  const matchedNaics = [...exact, ...sector];

  if (exact.length) {
    score += exact.length * 28;
    reasons.push(`${exact.length} exact NAICS match${exact.length > 1 ? 'es' : ''}`);
  }
  if (sector.length) {
    score += sector.length * 10;
    reasons.push(`${sector.length} same-sector (4-digit) match${sector.length > 1 ? 'es' : ''}`);
  }

  // Tangential: episode name-drops many industries but only one aligns with user
  if (epNaics.length >= 4 && exact.length <= 1 && sector.length <= 1) {
    score -= 25;
    reasons.push('tangential — episode mentions many NAICS, weak fit to your profile');
  }
  if (!exact.length && !sector.length) {
    return {
      relevanceScore: 0,
      matchTier: 'unrelated',
      matchedNaics: [],
      userSectorLabels: sectorLabelsFromNaics(userNaics),
      episodeSectorLabels: sectorLabelsFromNaics(epNaics),
      reasons: ['no NAICS overlap with your profile'],
    };
  }

  const blob = episodeTextBlob(episode);
  const userClusters = new Set<string>();
  for (const u of userNaics) {
    detectClusters(u, [u]).forEach((c) => userClusters.add(c));
    detectClusters(blob, [u]).forEach((c) => userClusters.add(c));
  }
  // User profile clusters from all their codes
  const profileClusters = detectClusters(userNaics.join(' '), userNaics);
  profileClusters.forEach((c) => userClusters.add(c));

  const episodeClusters = detectClusters(blob, epNaics);
  const overlapClusters = episodeClusters.filter((c) => profileClusters.includes(c));
  const mismatchClusters = episodeClusters.filter((c) => !profileClusters.includes(c));

  if (overlapClusters.length) {
    score += overlapClusters.length * 12;
    reasons.push(`topic/sector aligned: ${overlapClusters.map((id) => CLUSTERS.find((c) => c.id === id)?.label || id).join(', ')}`);
  }
  if (mismatchClusters.length && profileClusters.length) {
    const penalty = mismatchClusters.length * 18;
    score -= penalty;
    reasons.push(
      `off-profile topics: ${mismatchClusters.map((id) => CLUSTERS.find((c) => c.id === id)?.label || id).join(', ')}`,
    );
  }

  // Primary vs tangential tier
  let matchTier: NaicsMatchTier = 'unrelated';
  if (exact.length >= 2 || (exact.length === 1 && epNaics.length <= 3)) {
    matchTier = 'primary';
  } else if (exact.length === 1) {
    matchTier = epNaics.length >= 4 ? 'tangential' : 'primary';
  } else if (sector.length) {
    matchTier = 'sector';
  } else {
    matchTier = 'tangential';
  }

  if (matchTier === 'tangential') score = Math.min(score, 42);

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    relevanceScore: score,
    matchTier,
    matchedNaics: matchedNaics.slice(0, 6),
    userSectorLabels: sectorLabelsFromNaics(userNaics),
    episodeSectorLabels: sectorLabelsFromNaics(epNaics),
    reasons,
  };
}

export function sortEpisodesByRelevance<T extends PodcastRelevanceInput>(
  episodes: T[],
  userNaics: string[],
): Array<T & { relevance: PodcastRelevanceResult }> {
  return episodes
    .map((ep) => ({ ...ep, relevance: scorePodcastRelevance(ep, userNaics) }))
    .sort((a, b) => b.relevance.relevanceScore - a.relevance.relevanceScore);
}

export function filterByRelevance<T extends { relevance: PodcastRelevanceResult }>(
  rows: T[],
  minScore: number,
): T[] {
  return rows.filter((r) => r.relevance.relevanceScore >= minScore);
}

export const RELEVANCE_THRESHOLDS = {
  production: MIN_RELEVANCE_PRODUCTION,
  admin: MIN_RELEVANCE_ADMIN,
};
