/**
 * Ask Mindy on Opportunity Map cards (2026-11-14). Behind MAP_CARD_CHAT_ENABLED (off unless "true").
 *
 * This is NOT a new chat backend. It adds three things to the existing /api/app/chat turn:
 *   1. CONTEXT: the browser sends only { kind: 'opportunity', notice_id }. The server loads that record
 *      (and the relevant part of its stored statement of work) from sam_opportunities. Nothing the client
 *      writes is ever presented to the model as a record fact.
 *   2. ACCESS: Pro behaves exactly as today. A non-Pro account may ask on a card when it holds at least one
 *      turn's worth of its existing credits (the introductory grant or anything it bought). No new grant.
 *   3. CHARGE: a successful non-Pro card turn costs CARD_CHAT_TURN_CREDITS, charged ONCE PER QUESTION: the
 *      answer is saved and debited in one transaction (src/lib/chat/card-chat-turns.ts), and a retry, refresh
 *      or reopen of the same question replays the saved answer for free. Failed, empty, degraded or
 *      incomplete turns cost nothing. Pro card turns are not charged (unchanged).
 */
import { selectRelevantRfp } from '@/lib/proposal/select-relevant';

/** Server flag. Off unless exactly "true" (case-insensitive). */
export function isCardChatEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.MAP_CARD_CHAT_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * One flat, predictable charge per successful card answer. Proposed default 10 credits: the most common
 * per-tool price on the MCP catalog is 5 or 10 credits and a card answer typically runs one to three lookups,
 * so 10 is at or below what the same work costs through MCP, and the 100-credit introductory grant buys
 * about ten answers. Override with CARD_CHAT_TURN_CREDITS (integer 1..100). Pending Eric's approval.
 */
export function cardChatTurnCredits(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(String(env.CARD_CHAT_TURN_CREDITS ?? ''), 10);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 10;
}

/** SAM notice ids are 32 lowercase hex characters. */
const NOTICE_ID = /^[0-9a-f]{32}$/;

export type OpportunityContext = { kind: 'opportunity'; noticeId: string };

/** Accept only { kind: 'opportunity', notice_id: <32 hex> }. Anything else → null (no context). */
export function parseOpportunityContext(raw: unknown): OpportunityContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'opportunity') return null;
  const id = typeof r.notice_id === 'string' ? r.notice_id.trim().toLowerCase() : '';
  return NOTICE_ID.test(id) ? { kind: 'opportunity', noticeId: id } : null;
}

/**
 * Ask Mindy answer billing (Eric decision 3, 2026-11-17): every SUCCESSFUL intelligence answer on main Ask
 * Mindy and the map costs CARD_CHAT_TURN_CREDITS (default 10), Pro included (Pro's monthly allowance pays for
 * it). Off unless ASK_MINDY_ANSWER_BILLING is exactly "true", so merging this changes nothing until it is
 * turned on. Same once-per-question path as card chat (card_chat_turns): retries and reopens replay free.
 */
export function isAnswerBillingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.ASK_MINDY_ANSWER_BILLING || '').trim().toLowerCase() === 'true';
}

/**
 * Credits for one COMPLETE turn (isBillableTurn already true). Only an INTELLIGENCE answer is charged: one that
 * read Mindy's data this turn (a data tool succeeded) or was grounded in a notice record. A clarifying
 * question, a greeting, a refusal or a "which agency?" reply is saved (so it replays) but costs nothing.
 */
export function answerCredits(p: { billable: boolean; usedData: boolean; turnCredits: number }): number {
  return p.billable && p.usedData ? p.turnCredits : 0;
}

export type CardChatAccess =
  | { allow: true; billable: boolean }
  | { allow: false; status: 403 | 402; error: 'pro_required' | 'credits_required'; balance?: number };

/**
 * Who may ask. Pro: always (as today), never billed. Non-Pro: only on a card (flag on + valid context) and
 * only with at least one turn of credits. A null balance means UNKNOWN → refuse, never assume credits.
 */
export function cardChatAccess(p: {
  isPro: boolean; flagOn: boolean; context: OpportunityContext | null; balance: number | null; turnCredits: number;
  /** ASK_MINDY_ANSWER_BILLING: Pro answers are charged too, so Pro needs one answer's worth of credits. */
  answerBilling?: boolean;
}): CardChatAccess {
  if (p.isPro && p.answerBilling) {
    if (p.balance == null || p.balance < p.turnCredits) {
      return { allow: false, status: 402, error: 'credits_required', ...(p.balance != null ? { balance: p.balance } : {}) };
    }
    return { allow: true, billable: true };
  }
  if (p.isPro) return { allow: true, billable: false };
  if (!p.flagOn || !p.context) return { allow: false, status: 403, error: 'pro_required' };
  if (p.balance == null || p.balance < p.turnCredits) {
    return { allow: false, status: 402, error: 'credits_required', ...(p.balance != null ? { balance: p.balance } : {}) };
  }
  return { allow: true, billable: true };
}

/**
 * A turn is billable only if it produced a COMPLETE answer with live data behind it. Approved rule
 * (2026-11-14): failed, empty, degraded or incomplete answers are free. "Complete" means the model said it
 * finished ('stop'); a length cut, a provider error, a content filter, a missing finish signal or a stream we
 * stopped early (streamError) is incomplete.
 */
export function isBillableTurn(t: {
  billable: boolean; answer: string; streamError: boolean; plannerUnavailable: boolean; finishReason: string | null;
}): boolean {
  if (!t.billable || t.streamError || t.plannerUnavailable) return false;
  if (!t.answer || !t.answer.trim()) return false;
  return t.finishReason === 'stop';
}

/**
 * The tools a card conversation may use: about this solicitation, its buyer, its incumbent, and the
 * customer's own fit. Smaller than the full chat set (cheaper planning, focused answers). Only names that
 * exist in the registry and pass the chat tool policy are ever offered; this list can only narrow.
 */
export const CARD_CHAT_TOOLS: ReadonlySet<string> = new Set([
  'lookup_solicitation',
  'get_solicitation_documents',
  'get_solicitation_incumbent',
  'find_predecessor_award',
  'get_award_detail',
  'evaluate_bid_decision',
  'get_agency_intel',
  'lookup_federal_osbp',
  'search_federal_contacts',
  'get_contractor_profile',
  'get_contractor_award_history',
  'search_my_vault',
  'get_my_pipeline',
]);

export type OpportunityRecord = {
  notice_id: string;
  title: string | null;
  solicitation_number: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  notice_type: string | null;
  set_aside_description: string | null;
  naics_code: string | null;
  psc_code: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  pop_city: string | null;
  pop_state: string | null;
  description: string | null;
  sow_text: string | null;
  ui_link: string | null;
  active: boolean | null;
};

export const OPPORTUNITY_COLUMNS =
  'notice_id,title,solicitation_number,department,sub_tier,office,notice_type,set_aside_description,naics_code,psc_code,posted_date,response_deadline,pop_city,pop_state,description,sow_text,ui_link,active';

const DESCRIPTION_BUDGET = 6000;
const SOW_BUDGET = 12000;

/** A description that is only SAM's link to the text (not yet backfilled) carries no text. */
function usableText(s: string | null): string {
  const t = (s || '').trim();
  return !t || /^https?:\/\//i.test(t) ? '' : t;
}

/**
 * The deadline as the record stores it plus its Eastern and UTC readings, computed here so the model never
 * converts time zones itself (live check 2026-11-14: a stored 23:00 UTC came back as "11:00 PM Eastern").
 * A date-only or unparseable value is returned unchanged.
 */
export function describeDeadline(raw: string | null): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  if (!/T\d{2}:\d{2}/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const et = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
  const utc = d.toISOString().slice(0, 16).replace('T', ' ');
  return `${t} (= ${et} Eastern = ${utc} UTC). State the deadline using these readings; do not convert time zones yourself`;
}

/**
 * The labeled source block the model receives. Every fact comes from the record; absent fields are said to
 * be absent, never filled in. `question` selects which parts of a long statement of work are included.
 */
export function buildOpportunityContextBlock(
  rec: OpportunityRecord,
  question: string,
  /** Buyer office/DoDAAC/contact/incumbent lines (selected-notice.ts). Inserted before the notice text. */
  factLines: string[] = [],
  /**
   * 'selected' (default): the user has the listing selected on the map (#2096).
   * 'mentioned': plain chat, the user named this notice's id or solicitation number (mentioned-notice.ts).
   */
  origin: 'selected' | 'mentioned' = 'selected',
): { block: string; source: { label: string; url: string | null } } {
  const sol = rec.solicitation_number || rec.notice_id;
  const line = (label: string, v: string | null | undefined) => `${label}: ${v && String(v).trim() ? String(v).trim() : 'not stated in the record'}`;
  const place = [rec.pop_city, rec.pop_state].filter(Boolean).join(', ');
  const desc = usableText(rec.description);
  const sow = usableText(rec.sow_text);
  const header = origin === 'mentioned'
    ? [
      'MENTIONED OPPORTUNITY (loaded by Mindy from its SAM.gov record because the user named ' + sol + ' in this conversation; this is a source, not the user\'s words).',
      'Questions about "this", "it", the solicitation, its contracting officer or contact, the incumbent, the buyer or the competition refer to THIS opportunity; answer them about it. Use the notice text below for its requirements, set-aside and instructions, and the notice point of contact when the user wants to reach the buyer or contracting officer (address a draft to that contact and cite the solicitation number). A question clearly about something else is answered as asked. When the record or documents do not contain an answer, say so plainly and do not guess. Cite facts from it as "SAM.gov notice ' + sol + '".',
    ]
    : [
      'SELECTED OPPORTUNITY (loaded by Mindy from its SAM.gov record; this is a source, not the user\'s words).',
      'The user has this opportunity selected on the map. Questions about "this", "it", the incumbent, the buyer or the competition refer to THIS opportunity; answer them about it. A question clearly about something else is answered as asked. When the record or documents do not contain an answer, say so plainly and do not guess. Cite facts from it as "SAM.gov notice ' + sol + '".',
    ];
  const parts = [
    ...header,
    line('Title', rec.title),
    line('Solicitation number', rec.solicitation_number),
    line('SAM notice id', rec.notice_id),
    line('Agency', [rec.department, rec.sub_tier].filter(Boolean).join(' / ') || null),
    line('Office', rec.office),
    line('Notice type', rec.notice_type),
    line('Set-aside', rec.set_aside_description),
    line('NAICS', rec.naics_code),
    line('PSC', rec.psc_code),
    line('Posted', rec.posted_date),
    line('Response deadline', describeDeadline(rec.response_deadline)),
    line('Place of performance', place || null),
    line('Status', rec.active === false ? 'inactive' : rec.active ? 'active' : null),
    ...factLines,
    'Notice text:',
    desc ? desc.slice(0, DESCRIPTION_BUDGET) : 'not available in Mindy\'s copy of this notice',
    'Statement of work (excerpts most relevant to the question):',
    sow ? selectRelevantRfp(sow, question, SOW_BUDGET) : 'not extracted; attachments can be read with get_solicitation_documents using this notice id',
  ];
  return { block: parts.join('\n'), source: { label: `SAM.gov notice ${sol}`, url: rec.ui_link || null } };
}
