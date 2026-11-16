/**
 * The selected listing on the main Ask Mindy chat (Eric, 2026-11-16: "the selected notice attaches to the
 * existing main Ask Mindy chat; no separate per-card chat and no card-chat flag").
 *
 * The client sends only `context: { kind: 'opportunity', notice_id }`. Everything below is loaded here from
 * Mindy's own records with the SAME functions the tools use, so the context block cannot disagree with
 * lookup_solicitation or get_solicitation_incumbent:
 *   - buyer office: the notice's agency hierarchy leaf (what lookup_solicitation reports as `buyer`), with
 *     the DoDAAC parsed from the solicitation number (`decodeDodaac`) and the office city;
 *   - contact: the notice's point of contact (`extractNoticePoc`, what lookup_solicitation returns);
 *   - incumbent: `resolveSolicitationIncumbent`, stated exactly as its finding says. Only 'identified' names
 *     an incumbent; every other finding carries its absence note verbatim.
 *
 * Why: parity audit 2026-11-16. The card block said "Office: not stated in the record" (the `office` column
 * is null on most notices), so the planner believed it and answered "the notice does not identify the buying
 * office or a contact" while lookup_solicitation had both. Carrying the DoDAAC also turns the office-roster
 * hop (search_federal_contacts by dodaac) into a single planner round.
 */
import { extractNoticePoc } from '@/lib/proposal/notice-poc';
import { decodeDodaac } from '@/lib/gov-contacts/dodaac';
import {
  resolveSolicitationIncumbent,
  INCUMBENT_ABSENCE_NOTES,
  type IncumbentFinding,
  type SolicitationIncumbentResult,
} from '@/lib/usaspending/solicitation-incumbent';
import { OPPORTUNITY_COLUMNS, type OpportunityRecord } from './card-chat';

/** The card columns plus what the buyer/contact facts read. */
export const SELECTED_NOTICE_COLUMNS = `${OPPORTUNITY_COLUMNS},agency_hierarchy,office_address,points_of_contact`;

export type SelectedNoticeRecord = OpportunityRecord & {
  agency_hierarchy?: string | null;
  office_address?: unknown;
  points_of_contact?: unknown;
};

export interface IncumbentFacts {
  finding: IncumbentFinding | 'not_checked';
  /** What to tell the model about the finding (absence note, or the identified award). */
  note: string;
  /** The award the finding refers to (identified, or the unconfirmed candidate). Never named as incumbent unless identified. */
  award: {
    recipient: string | null;
    award_id: string | null;
    naics: string | null;
    psc: string | null;
    expires: string | null;
  } | null;
}

export interface SelectedNoticeFacts {
  buyer_office: string | null;
  office_city: string | null;
  dodaac: string | null;
  contact: { name: string | null; title: string | null; email: string | null; phone: string | null } | null;
  incumbent: IncumbentFacts;
}

/**
 * SAM sometimes stores the phone in the name field ("Telephone: 2157373861" on SPRPA127RUA05). That is not a
 * person; present it as the phone, never as a name.
 */
function contactFrom(poc: ReturnType<typeof extractNoticePoc>['primary']): SelectedNoticeFacts['contact'] {
  if (!poc) return null;
  let name = poc.fullName;
  let phone = poc.phone;
  const label = name?.match(/^\s*(?:tel(?:ephone)?|phone)\s*[:#.]?\s*(.*)$/i);
  if (label) {
    name = null;
    if (!phone && label[1]?.trim()) phone = label[1].trim();
  }
  if (!name && !poc.email && !phone) return null;
  return { name, title: poc.title, email: poc.email, phone };
}

/** Buyer office + DoDAAC + contact, from the record alone (pure). */
export function noticeBuyerFacts(rec: SelectedNoticeRecord): Omit<SelectedNoticeFacts, 'incumbent'> {
  // Same leaf lookup_solicitation reports as `buyer`. The `office` column wins when SAM filled it.
  const leaf = String(rec.agency_hierarchy || '').split('.').map((s) => s.trim()).filter(Boolean).pop() || null;
  const buyer = (rec.office && rec.office.trim()) || leaf;
  const addr = rec.office_address && typeof rec.office_address === 'object' ? rec.office_address as { city?: unknown; state?: unknown } : null;
  const city = addr ? [addr.city, addr.state].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(', ') : '';
  const decoded = decodeDodaac(rec.solicitation_number);
  const poc = extractNoticePoc({ pointOfContact: rec.points_of_contact }).primary;
  return {
    buyer_office: buyer || null,
    office_city: city || null,
    dodaac: decoded?.dodaac ?? null,
    contact: contactFrom(poc),
  };
}

/** The incumbent finding as the tool states it (pure). */
export function incumbentFactsFromResult(r: SolicitationIncumbentResult): IncumbentFacts {
  const finding = r._meta.incumbent_finding;
  if (finding === 'identified' && r.incumbent) {
    const a = r.incumbent;
    return {
      finding,
      note: 'Supported prior award identified by Mindy\'s incumbent lookup (USASpending). You may name it as the incumbent, citing the award id.',
      award: { recipient: a.recipientName ?? null, award_id: a.awardId ?? null, naics: a.naicsCode ?? null, psc: a.pscCode ?? null, expires: a.popPotentialEnd ?? null },
    };
  }
  const note = r._meta.absence_note || INCUMBENT_ABSENCE_NOTES[finding === 'identified' ? 'not_found' : finding];
  const cand = finding === 'candidate_not_confirmed' ? r.prior_awards[0] : null;
  return {
    finding: finding === 'identified' ? 'not_found' : finding,
    note,
    award: cand ? { recipient: cand.recipientName ?? null, award_id: cand.awardId ?? null, naics: cand.naicsCode ?? null, psc: cand.pscCode ?? null, expires: cand.popPotentialEnd ?? null } : null,
  };
}

const NOT_CHECKED: IncumbentFacts = {
  finding: 'not_checked',
  note: 'The incumbent lookup did not finish in time for this answer. If the user asks about the incumbent, call get_solicitation_incumbent with this notice id. Never say there is no incumbent.',
  award: null,
};

export type IncumbentResolver = (noticeId: string) => Promise<SolicitationIncumbentResult>;

/** Buyer facts + the incumbent finding, the incumbent bounded by `timeoutMs` (unknown on timeout/error). */
export async function loadSelectedNoticeFacts(
  rec: SelectedNoticeRecord,
  opts: { timeoutMs?: number; resolveIncumbent?: IncumbentResolver } = {},
): Promise<SelectedNoticeFacts> {
  const buyer = noticeBuyerFacts(rec);
  const resolve = opts.resolveIncumbent ?? resolveSolicitationIncumbent;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const incumbent = await Promise.race([
    resolve(rec.notice_id).then(incumbentFactsFromResult).catch(() => NOT_CHECKED),
    new Promise<IncumbentFacts>((r) => { timer = setTimeout(() => r(NOT_CHECKED), opts.timeoutMs ?? 4000); }),
  ]);
  clearTimeout(timer);
  return { ...buyer, incumbent };
}

/** The facts as labelled lines appended to the selected-opportunity block. */
export function formatSelectedNoticeFacts(f: SelectedNoticeFacts): string[] {
  const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : 'not stated in the record');
  const lines = [
    'Buyer and contact (from the same record lookup_solicitation reads):',
    `Buying office: ${v(f.buyer_office)}${f.office_city ? ` (${f.office_city})` : ''}`,
    `Office DoDAAC: ${f.dodaac ?? 'none parsed from the solicitation number'}${f.dodaac ? ' (pass it as `dodaac` to search_federal_contacts for this office\'s contact roster)' : ''}`,
    `Notice point of contact: ${f.contact ? [f.contact.name, f.contact.title, f.contact.email, f.contact.phone].filter(Boolean).join(', ') : 'not stated in the record'}`,
    'Incumbent (Mindy\'s incumbent lookup):',
    `Finding: ${f.incumbent.finding}. ${f.incumbent.note}`,
  ];
  const a = f.incumbent.award;
  if (a) {
    const label = f.incumbent.finding === 'identified' ? 'Incumbent award' : 'Similar prior award (NOT identified as the incumbent; never call it the incumbent)';
    lines.push(`${label}: ${[a.recipient, a.award_id && `award ${a.award_id}`, a.naics && `NAICS ${a.naics}`, a.psc && `PSC ${a.psc}`, a.expires && `ends ${a.expires}`].filter(Boolean).join(', ')}`);
    if (a.naics || a.psc) {
      lines.push('For "who else competes in this market", the prior award\'s NAICS/PSC can be passed to find_capable_contractors; describe the results as firms in this market, not confirmed bidders.');
    }
  }
  return lines;
}
