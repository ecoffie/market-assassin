/**
 * Pulse vs Lesson — daily Mindy Insight source selection.
 *
 *   Pulse  = today's market (briefing AI or deterministic opp stats)
 *   Lesson = podcast guest teaching matched to user's NAICS
 *
 * One card per day; sources compete via rules, not calendar parity.
 */

import type { NaicsMatchTier } from '@/lib/rag/podcast-naics-relevance';
import { RELEVANCE_THRESHOLDS } from '@/lib/rag/podcast-naics-relevance';

export type InsightMode = 'pulse' | 'lesson';

export type DailyInsightSource =
  | 'ai_briefing'
  | 'deterministic_data'
  | 'podcast_guest'
  | 'fallback';

export interface DailyInsightCandidate {
  quote: string;
  format: string;
  source: DailyInsightSource;
  attribution?: string;
}

export interface LessonCandidate extends DailyInsightCandidate {
  source: 'podcast_guest';
  relevanceScore: number;
  matchTier: NaicsMatchTier;
}

export interface PulseLessonPick {
  insight: DailyInsightCandidate;
  mode: InsightMode;
  reason: string;
}

/** Days until response deadline that triggers "pulse" (market is hot) */
export const URGENT_DEADLINE_DAYS = 14;

/** Strong guest fit — prefer lesson when no urgent opp */
export const STRONG_LESSON_FIT_SCORE = 50;

export interface PulseLessonInput {
  pulse: DailyInsightCandidate | null;
  lesson: LessonCandidate | null;
  briefingHasUrgency: boolean;
  /** Skip podcast path entirely when feature flag off */
  podcastEnabled: boolean;
  /** On refresh: don't return the same source type again if the other exists */
  excludeSource?: DailyInsightSource;
  /** Last N days' sources — nudge variety */
  recentSources?: DailyInsightSource[];
}

function recentStreak(sources: DailyInsightSource[], target: DailyInsightSource, n = 2): boolean {
  const tail = sources.slice(0, n);
  return tail.length >= n && tail.every((s) => s === target);
}

export function isStrongLesson(lesson: LessonCandidate | null): boolean {
  if (!lesson) return false;
  if (lesson.relevanceScore < STRONG_LESSON_FIT_SCORE) return false;
  return lesson.matchTier === 'primary' || lesson.matchTier === 'sector';
}

export function isViableLesson(lesson: LessonCandidate | null): boolean {
  if (!lesson) return false;
  return lesson.relevanceScore >= RELEVANCE_THRESHOLDS.production;
}

function isPulseSource(s: DailyInsightSource): boolean {
  return s === 'ai_briefing' || s === 'deterministic_data';
}

/**
 * Apply pulse vs lesson decision tree. Caller supplies pre-built candidates.
 */
export function selectPulseOrLesson(input: PulseLessonInput): PulseLessonPick | null {
  const {
    pulse,
    lesson,
    briefingHasUrgency,
    podcastEnabled,
    excludeSource,
    recentSources = [],
  } = input;

  const lessonOk = podcastEnabled && isViableLesson(lesson);
  const lessonStrong = podcastEnabled && isStrongLesson(lesson);
  const pulseBriefing = pulse?.source === 'ai_briefing' ? pulse : null;
  const pulseAny = pulse;

  const skipLesson = excludeSource === 'podcast_guest';
  const skipPulse = excludeSource === 'ai_briefing' || excludeSource === 'deterministic_data';

  const lessonFatigue = recentStreak(recentSources, 'podcast_guest');
  const pulseFatigue = recentStreak(recentSources, 'ai_briefing');

  // 1. Hot market → pulse (briefing), unless user just refreshed away from pulse
  if (briefingHasUrgency && pulseBriefing && !skipPulse) {
    return { insight: pulseBriefing, mode: 'pulse', reason: 'urgent opportunity in today\'s briefing' };
  }

  // 2. Strong industry guest fit → lesson (unless refresh excluded or 2 lesson days in a row)
  if (lessonStrong && lessonOk && lesson && !skipLesson && !lessonFatigue) {
    return { insight: lesson, mode: 'lesson', reason: `guest lesson · ${lesson.relevanceScore}% industry fit · ${lesson.matchTier}` };
  }

  // 3. Variety: two podcast days → prefer pulse when briefing exists
  if (lessonFatigue && pulseBriefing && !skipPulse) {
    return { insight: pulseBriefing, mode: 'pulse', reason: 'variety — rotating to today\'s market after guest lessons' };
  }

  // 4. Any briefing pulse beats weak/tangential lesson
  if (pulseBriefing && !skipPulse) {
    if (!lessonOk || !lessonStrong) {
      return { insight: pulseBriefing, mode: 'pulse', reason: 'today\'s briefing (no strong guest match)' };
    }
  }

  // 5. Viable lesson when pulse isn't briefing-quality
  if (lessonOk && lesson && !skipLesson) {
    return {
      insight: lesson,
      mode: 'lesson',
      reason: `guest lesson · ${lesson.relevanceScore}% fit`,
    };
  }

  // 6. Deterministic pulse (opp counts)
  if (pulseAny && isPulseSource(pulseAny.source) && !skipPulse) {
    return {
      insight: pulseAny,
      mode: 'pulse',
      reason: pulseAny.source === 'deterministic_data' ? 'your opportunity stats today' : 'briefing',
    };
  }

  // 7. Lesson last resort if pulse exhausted on refresh
  if (lessonOk && lesson && !skipLesson) {
    return { insight: lesson, mode: 'lesson', reason: 'guest lesson (fallback)' };
  }

  // 8. Pulse fatigue → try lesson even if not "strong"
  if (pulseFatigue && lessonOk && lesson && !skipLesson) {
    return { insight: lesson, mode: 'lesson', reason: 'variety — guest lesson after market pulse streak' };
  }

  return null;
}

// ---- Briefing urgency detection ------------------------------------

function parseDaysRemaining(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function daysUntilDate(deadline: unknown): number | null {
  const raw = String(deadline || '').trim();
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

/**
 * True when any opportunity in the briefing template is due within N days.
 */
export function briefingHasUrgentOpportunity(
  briefing: Record<string, unknown> | null | undefined,
  maxDays = URGENT_DEADLINE_DAYS,
): boolean {
  const opps = (briefing?.opportunities || []) as Array<Record<string, unknown>>;
  for (const opp of opps) {
    const days =
      parseDaysRemaining(opp.daysRemaining) ??
      daysUntilDate(opp.responseDeadline ?? opp.deadline ?? opp.response_deadline);
    if (days !== null && days >= 0 && days <= maxDays) return true;
  }
  return false;
}
