/**
 * Respond early — the beginner-facing meaning of an EARLY-stage Open notice.
 *
 * Research 2026-11-22 (docs/research/2026-11-22-contractor-problems-and-industries.md)
 * ranked "finding bids too late" the #1 contractor problem. FIND already returns
 * sources-sought / RFI / presolicitation notices, but a beginner sees only a SAM
 * notice type and never learns these are the cheapest, earliest way in. Live test
 * 2026-11-23 ("landscaping", VA): 2 of 5 Open items were Sources Sought with no
 * explanation anywhere in the result.
 *
 * Presentation only: never changes recall, eligibility or ranking (canonical
 * discovery owns those). Driven ONLY by the structured SAM notice_type — a title
 * keyword never makes a notice "respond early" (same discipline as acquisition-stage.ts).
 */

export type RespondEarlyKind = 'sources_sought' | 'request_for_information' | 'presolicitation';

export interface RespondEarly {
  kind: RespondEarlyKind;
  label: string;
  what_it_means: string;
  action: string;
}

const MEANINGS: Record<RespondEarlyKind, RespondEarly> = {
  sources_sought: {
    kind: 'sources_sought',
    label: 'Sources sought (market research)',
    what_it_means:
      'The buyer is doing market research before deciding how to buy. It is not a request for proposals, and no contract is awarded from it.',
    action:
      'Send a short capability response by the deadline, answering exactly what the notice asks. Contracting officers use these responses to judge whether enough capable small businesses exist to set the work aside, and it puts you on the buyer\'s radar before the solicitation.',
  },
  request_for_information: {
    kind: 'request_for_information',
    label: 'Request for information',
    what_it_means:
      'The buyer is asking industry for information to shape the requirement. It is not a request for proposals.',
    action:
      'Answer the questions asked by the deadline. It is a chance to influence the requirement before it is final and to get known by the buyer.',
  },
  presolicitation: {
    kind: 'presolicitation',
    label: 'Presolicitation (advance notice)',
    what_it_means: 'Advance notice that a solicitation for this work is expected.',
    action:
      'Prepare now: read the notice, line up partners and past performance, and watch for the solicitation so you are not starting from zero when it posts.',
  },
};

/** Structured SAM notice_type → respond-early meaning, or null. */
export function respondEarlyFor(noticeType: unknown): RespondEarly | null {
  const t = typeof noticeType === 'string' ? noticeType.toLowerCase() : '';
  if (!t) return null;
  if (/sources\s*sought/.test(t)) return MEANINGS.sources_sought;
  if (/request\s+for\s+information|\brfi\b/.test(t)) return MEANINGS.request_for_information;
  if (/pre-?\s*solicitation/.test(t)) return MEANINGS.presolicitation;
  return null;
}

export interface RespondEarlySummary {
  /** Among RETURNED Open items only — not a market-wide count. */
  returned_count: number;
  notice_ids: string[];
}

export function respondEarlySummary(items: Array<Record<string, unknown>>): RespondEarlySummary {
  const hits = items.filter((i) => i.respond_early);
  return { returned_count: hits.length, notice_ids: hits.map((i) => String(i.notice_id || '')).filter(Boolean) };
}

export const HOST_RULES_RESPOND_EARLY = [
  'RESPOND EARLY: summary.respond_early lists returned Open items that are market research (sources sought, request for information) or an advance notice (presolicitation). In Open now, point these out first, in plain English, using each item\'s respond_early.what_it_means and respond_early.action, with its deadline. Say plainly that a sources-sought or RFI response is a short capability answer, not a proposal. A grounded respond-early item is a strong candidate for WHERE I WOULD START. Its count covers returned items only — never call it the number in the whole market. Never label a Coming back or Coming soon row as respond-early.',
];
