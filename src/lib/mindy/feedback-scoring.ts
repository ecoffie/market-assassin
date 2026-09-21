import { createClient } from '@supabase/supabase-js';

export type MindyFeedbackType =
  | 'good_match'
  | 'bad_match'
  | 'not_my_industry'
  | 'too_big_small'
  | 'already_knew'
  | 'want_more_like_this';

export interface MindyFeedbackSignals {
  byOpportunityId: Record<string, Partial<Record<MindyFeedbackType, number>>>;
  agencyPositive: Record<string, number>;
  agencyNegative: Record<string, number>;
  keywordPositive: Record<string, number>;
  keywordNegative: Record<string, number>;
}

export interface MindyFeedbackOpportunity {
  opportunityId?: string | null;
  title?: string | null;
  agency?: string | null;
  naicsCode?: string | null;
}

export interface MindyFeedbackScore {
  adjustment: number;
  reasons: string[];
}

interface UserFeedbackRow {
  opportunity_id: string | null;
  feedback_type: string | null;
  is_positive: boolean | null;
  comment: string | null;
}

const EMPTY_SIGNALS: MindyFeedbackSignals = {
  byOpportunityId: {},
  agencyPositive: {},
  agencyNegative: {},
  keywordPositive: {},
  keywordNegative: {},
};

const EXACT_FEEDBACK_WEIGHTS: Record<MindyFeedbackType, number> = {
  want_more_like_this: 35,
  good_match: 25,
  already_knew: -10,
  too_big_small: -25,
  bad_match: -35,
  not_my_industry: -45,
};

const POSITIVE_FEEDBACK = new Set<MindyFeedbackType>(['good_match', 'want_more_like_this']);
const NEGATIVE_FEEDBACK = new Set<MindyFeedbackType>(['bad_match', 'not_my_industry', 'too_big_small']);

function cloneEmptySignals(): MindyFeedbackSignals {
  return {
    byOpportunityId: {},
    agencyPositive: {},
    agencyNegative: {},
    keywordPositive: {},
    keywordNegative: {},
  };
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return url && key ? createClient(url, key) : null;
}

function normalizeKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function parseFeedbackMetadata(comment: string | null): { title?: string; agency?: string } {
  if (!comment) return {};
  try {
    const parsed = JSON.parse(comment) as { title?: unknown; agency?: unknown };
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      agency: typeof parsed.agency === 'string' ? parsed.agency : undefined,
    };
  } catch {
    return {};
  }
}

function extractKeywords(title: string | null | undefined): string[] {
  const ignored = new Set([
    'and', 'the', 'for', 'with', 'from', 'that', 'this', 'services', 'service',
    'support', 'contract', 'requirement', 'requirements', 'federal', 'agency',
  ]);

  return normalizeKey(title)
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 4 && !ignored.has(token))
    .slice(0, 8);
}

function addCount(record: Record<string, number>, key: string, amount = 1) {
  if (!key) return;
  record[key] = (record[key] || 0) + amount;
}

function isKnownFeedbackType(value: string | null): value is MindyFeedbackType {
  return Boolean(value && value in EXACT_FEEDBACK_WEIGHTS);
}

export async function getMindyFeedbackSignals(userEmail: string): Promise<MindyFeedbackSignals> {
  const email = normalizeKey(userEmail);
  if (!email) return cloneEmptySignals();

  const supabase = getSupabaseClient();
  if (!supabase) return cloneEmptySignals();

  const { data, error } = await supabase
    .from('user_feedback')
    .select('opportunity_id,feedback_type,is_positive,comment')
    .eq('user_email', email)
    .eq('feedback_source', 'mindy_app')
    .order('created_at', { ascending: false })
    .limit(750);

  if (error) {
    if (error.code === '42P01') return cloneEmptySignals();
    console.error('[MindyFeedbackScoring] Failed to load feedback:', error);
    return cloneEmptySignals();
  }

  const signals = cloneEmptySignals();
  const seenOpportunityIds = new Set<string>();

  for (const row of (data || []) as UserFeedbackRow[]) {
    if (!isKnownFeedbackType(row.feedback_type)) continue;

    const opportunityId = normalizeKey(row.opportunity_id);
    if (opportunityId) {
      if (seenOpportunityIds.has(opportunityId)) continue;
      seenOpportunityIds.add(opportunityId);
    }

    if (opportunityId) {
      signals.byOpportunityId[opportunityId] ||= {};
      signals.byOpportunityId[opportunityId][row.feedback_type] =
        (signals.byOpportunityId[opportunityId][row.feedback_type] || 0) + 1;
    }

    const metadata = parseFeedbackMetadata(row.comment);
    const agencyKey = normalizeKey(metadata.agency);
    if (POSITIVE_FEEDBACK.has(row.feedback_type)) addCount(signals.agencyPositive, agencyKey);
    if (NEGATIVE_FEEDBACK.has(row.feedback_type)) addCount(signals.agencyNegative, agencyKey);

    for (const keyword of extractKeywords(metadata.title)) {
      if (POSITIVE_FEEDBACK.has(row.feedback_type)) addCount(signals.keywordPositive, keyword);
      if (NEGATIVE_FEEDBACK.has(row.feedback_type)) addCount(signals.keywordNegative, keyword);
    }
  }

  return signals;
}

export function scoreOpportunityWithMindyFeedback(
  opportunity: MindyFeedbackOpportunity,
  signals: MindyFeedbackSignals = EMPTY_SIGNALS
): MindyFeedbackScore {
  let adjustment = 0;
  const reasons: string[] = [];

  const opportunityId = normalizeKey(opportunity.opportunityId);
  const exactSignals = opportunityId ? signals.byOpportunityId[opportunityId] : null;
  if (exactSignals) {
    for (const [feedbackType, count] of Object.entries(exactSignals) as [MindyFeedbackType, number | undefined][]) {
      adjustment += EXACT_FEEDBACK_WEIGHTS[feedbackType] * Math.min(count || 0, 3);
    }
    if ((exactSignals.good_match || 0) + (exactSignals.want_more_like_this || 0) > 0) {
      reasons.push('you liked this opportunity before');
    }
    if ((exactSignals.bad_match || 0) + (exactSignals.not_my_industry || 0) + (exactSignals.too_big_small || 0) > 0) {
      reasons.push('you down-ranked this opportunity before');
    }
  }

  const agencyKey = normalizeKey(opportunity.agency);
  if (agencyKey) {
    const positiveAgency = signals.agencyPositive[agencyKey] || 0;
    const negativeAgency = signals.agencyNegative[agencyKey] || 0;

    if (positiveAgency > 0) {
      adjustment += Math.min(15, positiveAgency * 5);
      reasons.push('similar agencies you liked');
    }
    if (negativeAgency > 0) {
      adjustment -= Math.min(20, negativeAgency * 7);
      reasons.push('similar agencies you down-ranked');
    }
  }

  let positiveKeywordHits = 0;
  let negativeKeywordHits = 0;
  for (const keyword of extractKeywords(opportunity.title)) {
    positiveKeywordHits += signals.keywordPositive[keyword] || 0;
    negativeKeywordHits += signals.keywordNegative[keyword] || 0;
  }

  if (positiveKeywordHits > 0) {
    adjustment += Math.min(12, positiveKeywordHits * 3);
    reasons.push('similar topics you liked');
  }
  if (negativeKeywordHits > 0) {
    adjustment -= Math.min(16, negativeKeywordHits * 4);
    reasons.push('similar topics you down-ranked');
  }

  return {
    adjustment: Math.max(-60, Math.min(60, adjustment)),
    reasons: Array.from(new Set(reasons)).slice(0, 3),
  };
}
