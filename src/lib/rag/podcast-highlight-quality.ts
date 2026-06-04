/**
 * Heuristic quality scoring for podcast key_lessons before production rollout.
 * Used by /admin/podcast-highlights — not shown to end users.
 */

import { RELEVANCE_THRESHOLDS } from '@/lib/rag/podcast-naics-relevance';

export type HighlightQualityTier = 'good' | 'weak' | 'reject';

export interface HighlightQualityResult {
  tier: HighlightQualityTier;
  reasons: string[];
  charCount: number;
  /** What the Mindy Insight card would display after trim */
  cardPreview: string;
}

const MAX_CARD_CHARS = 180;
const MIN_LESSON_CHARS = 24;

/** Generic platitudes the extractor sometimes emits — flag for re-run or filter */
const WEAK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(build|nurture|maintain)\s+(strong\s+)?relationships?\b/i, reason: 'generic relationship advice' },
  { re: /\balways consult\b/i, reason: 'vague legal disclaimer' },
  { re: /\bnetworking\b/i, reason: 'generic networking' },
  { re: /\bstay top of mind\b/i, reason: 'generic BD platitude' },
  { re: /\bhard work pays off\b/i, reason: 'generic motivation' },
  { re: /\bnever give up\b/i, reason: 'generic motivation' },
  { re: /\bpassion\b/i, reason: 'generic passion framing' },
  { re: /\bthe government wants\b/i, reason: 'vague government generalization' },
  { re: /\bfederal contracting is\b/i, reason: 'generic industry statement' },
  { re: /\beric\s+coff/i, reason: 'host name leak (exit strategy)' },
];

const GOOD_SIGNALS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b\d+\s*(day|week|month|year)s?\b/i, reason: 'specific timeline' },
  { re: /\$\d/i, reason: 'specific dollar amount' },
  { re: /\b(8\(a\)|hubzone|wosb|sdvosb|gsa|naics|rfp|rfq|sources sought)\b/i, reason: 'GovCon-specific term' },
  { re: /\b(cage|uei|sam\.gov|fpds|usaspending)\b/i, reason: 'procurement system reference' },
  { re: /\b(subcontract|prime|teaming|capability statement|past performance)\b/i, reason: 'actionable GovCon tactic' },
  { re: /\bcontracting officers?\b/i, reason: 'agency BD reference' },
  { re: /\b(surety|bonding|prevailing wage|davis-bacon|236|237|238)\b/i, reason: 'construction GovCon' },
  { re: /\b(industry conferences?|trade shows?)\b/i, reason: 'targeted BD event' },
];

/**
 * Production gate: quality tier + industry-fit score (not "good" alone — that
 * emptied the 236220 construction preview when combined with 48% relevance).
 */
export function lessonPassesProductionGate(
  quality: HighlightQualityResult,
  relevanceScore: number,
  matchTier: string,
): boolean {
  if (quality.tier === 'reject') return false;
  if (relevanceScore < RELEVANCE_THRESHOLDS.production) return false;
  if (quality.tier === 'good') return true;
  // Borderline prose on a strongly matched episode still ships
  if (
    quality.tier === 'weak' &&
    relevanceScore >= 50 &&
    (matchTier === 'primary' || matchTier === 'sector')
  ) {
    return true;
  }
  return false;
}

export function trimForMindyCard(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_CARD_CHARS) return cleaned;
  const cut = cleaned.slice(0, MAX_CARD_CHARS - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > MIN_LESSON_CHARS ? cut.slice(0, lastSpace) : cut;
  return `${base}…`;
}

export function assessHighlightQuality(
  lesson: string,
  opts?: { hasGuest?: boolean },
): HighlightQualityResult {
  const cleaned = (lesson || '').replace(/\s+/g, ' ').trim();
  const reasons: string[] = [];
  const charCount = cleaned.length;
  const cardPreview = trimForMindyCard(cleaned);

  if (!cleaned) {
    return { tier: 'reject', reasons: ['empty lesson'], charCount: 0, cardPreview: '' };
  }
  if (charCount < MIN_LESSON_CHARS) {
    reasons.push(`too short (${charCount} chars)`);
  }
  if (charCount > 280) {
    reasons.push(`very long (${charCount} chars)`);
  }
  if (opts?.hasGuest === false) {
    reasons.push('solo/host episode — no guest voice');
  }

  for (const { re, reason } of WEAK_PATTERNS) {
    if (re.test(cleaned)) reasons.push(reason);
  }

  const goodSignals: string[] = [];
  for (const { re, reason } of GOOD_SIGNALS) {
    if (re.test(cleaned)) goodSignals.push(reason);
  }

  let tier: HighlightQualityTier = 'good';
  if (charCount < MIN_LESSON_CHARS || reasons.some((r) => r.includes('host name') || r.includes('empty'))) {
    tier = 'reject';
  } else if (reasons.length >= 2 || (reasons.length >= 1 && goodSignals.length === 0)) {
    tier = 'weak';
  } else if (reasons.length === 1 && goodSignals.length === 0) {
    tier = 'weak';
  }

  if (tier === 'good' && goodSignals.length > 0) {
    // keep good
  } else if (tier === 'good' && charCount >= 50 && charCount <= 200 && reasons.length === 0) {
    tier = 'good';
  }

  return { tier, reasons, charCount, cardPreview };
}

export function assessEpisodeLessons(
  lessons: string[],
  hasGuest: boolean,
): { lessons: Array<{ text: string; quality: HighlightQualityResult }>; bestTier: HighlightQualityTier } {
  const assessed = (lessons || []).filter(Boolean).map((text) => ({
    text,
    quality: assessHighlightQuality(text, { hasGuest }),
  }));
  const tiers = assessed.map((a) => a.quality.tier);
  const bestTier: HighlightQualityTier = tiers.includes('good')
    ? 'good'
    : tiers.includes('weak')
      ? 'weak'
      : 'reject';
  return { lessons: assessed, bestTier };
}
