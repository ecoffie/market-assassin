/**
 * Output translation: grounded search_sam_opportunities item → beginner card.
 *
 * Does not mutate the source record. Raw item is attached as `raw` for
 * advanced/detail views.
 */

import {
  applyEligibilityGuard,
  beginnerPscLabel,
  formatBeginnerAmount,
  formatDueLabel,
  translateNoticeType,
  translateSetAside,
} from './labels';
import type {
  BeginnerOpportunityCard,
  EligibilityEvidence,
  SamSearchItem,
} from './types';

export interface TranslateOptions {
  nowMs?: number;
  eligibility?: EligibilityEvidence;
  searchContext?: string | null;
}

function displayTitle(title: string | null | undefined): string {
  const t = (title || '').trim();
  return t || 'Untitled listing';
}

export function translateOpportunity(
  item: SamSearchItem,
  opts: TranslateOptions = {},
): BeginnerOpportunityCard {
  const nowMs = opts.nowMs ?? Date.now();
  const notice = translateNoticeType(item.type, item.title);
  const setAside = translateSetAside(item.set_aside);
  const eligibility = applyEligibilityGuard(setAside, opts.eligibility);
  const amount = formatBeginnerAmount(item.amount);
  const amountLabel =
    amount.kind === 'omitted' ? null : amount.kind === 'value' || amount.kind === 'zero' || amount.kind === 'missing'
      ? amount.label
      : null;
  const pscLabel = beginnerPscLabel(item.psc_description, item.psc_code);
  const agency = (item.agency || '').trim() || null;
  const reference = (item.solicitation || '').trim() || null;
  const samUrl = (item.link || '').trim() || null;

  return {
    title: displayTitle(item.title),
    noticeLabel: notice.label,
    setAsideLabel: setAside.label,
    audienceLabel: eligibility.audienceLabel,
    dueLabel: formatDueLabel(item.deadline, nowMs),
    amountLabel,
    pscLabel,
    agencyLabel: agency,
    plainMeaning: notice.meaning,
    nextStep: notice.nextStep,
    referenceNumber: reference,
    samUrl,
    source: 'sam',
    grounded: true,
    searchContext: opts.searchContext ?? null,
    raw: item,
  };
}

export function translateOpportunities(
  items: readonly SamSearchItem[],
  opts: TranslateOptions = {},
): BeginnerOpportunityCard[] {
  return items.map((item) => translateOpportunity(item, opts));
}
