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
import { askMindyNoticeStatusLines } from '@/lib/sam/ask-mindy-notice-status';
import { OPPORTUNITY_COLUMNS, describeDeadline, type OpportunityRecord } from './card-chat';

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

// E1 (review 2026-11-16): the incumbent lookup (~2s on the live record) would rerun on every turn while a
// notice stays selected. Cache the FINDING per conversation + notice, in memory (per server instance; a miss
// just recomputes). No table. 'not_checked' (timeout/error) is never cached, so the next turn retries.
const INCUMBENT_TTL_MS = 30 * 60 * 1000;
const INCUMBENT_CACHE_MAX = 500;
const incumbentCache = new Map<string, { at: number; facts: IncumbentFacts }>();

/** Test hook. */
export function clearIncumbentCache(): void { incumbentCache.clear(); }

function cachedIncumbent(key: string, now: number): IncumbentFacts | null {
  const hit = incumbentCache.get(key);
  if (!hit) return null;
  if (now - hit.at > INCUMBENT_TTL_MS) { incumbentCache.delete(key); return null; }
  return hit.facts;
}

function rememberIncumbent(key: string, facts: IncumbentFacts, now: number): void {
  if (facts.finding === 'not_checked') return;
  if (incumbentCache.size >= INCUMBENT_CACHE_MAX) {
    const oldest = incumbentCache.keys().next().value;
    if (oldest !== undefined) incumbentCache.delete(oldest);
  }
  incumbentCache.set(key, { at: now, facts });
}

/** Buyer facts + the incumbent finding, the incumbent bounded by `timeoutMs` (unknown on timeout/error). */
export async function loadSelectedNoticeFacts(
  rec: SelectedNoticeRecord,
  opts: { timeoutMs?: number; resolveIncumbent?: IncumbentResolver; cacheKey?: string; now?: () => number } = {},
): Promise<SelectedNoticeFacts> {
  const buyer = noticeBuyerFacts(rec);
  const now = opts.now ?? Date.now;
  // The key always includes the notice id, so a different notice in the same conversation never reuses it.
  const key = opts.cacheKey ? `${opts.cacheKey}|${rec.notice_id}` : null;
  const cached = key ? cachedIncumbent(key, now()) : null;
  if (cached) return { ...buyer, incumbent: cached };
  const resolve = opts.resolveIncumbent ?? resolveSolicitationIncumbent;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const incumbent = await Promise.race([
    resolve(rec.notice_id).then(incumbentFactsFromResult).catch(() => NOT_CHECKED),
    new Promise<IncumbentFacts>((r) => { timer = setTimeout(() => r(NOT_CHECKED), opts.timeoutMs ?? 4000); }),
  ]);
  clearTimeout(timer);
  if (key) rememberIncumbent(key, incumbent, now());
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

// ── Manual Drive "solicitation facts" (Step 7) ─────────────────────────────────────────────────────────────
// Proposal AI recomputes the facts Ask Mindy found from the pursuit's notice_id with the SAME functions:
// nothing is copied or stored. No notice text or SOW here (Manual Drive already has the pursuit documents).

/** The record fields the facts block reads (no description/SOW). */
export const SOLICITATION_FACT_COLUMNS =
  'notice_id,title,solicitation_number,department,sub_tier,office,notice_type,set_aside_description,naics_code,psc_code,posted_date,response_deadline,archive_date,pop_city,pop_state,ui_link,active,agency_hierarchy,office_address,points_of_contact';

/** The compact block Manual Drive puts beside the requirements. Absent fields are said to be absent. */
export function formatSolicitationFactsBlock(rec: SelectedNoticeRecord, facts: SelectedNoticeFacts): string {
  const v = (s: string | null | undefined) => (s && String(s).trim() ? String(s).trim() : 'not stated in the record');
  const sol = rec.solicitation_number || rec.notice_id;
  return [
    `SOLICITATION FACTS (recomputed by Mindy from SAM.gov notice ${sol} and its incumbent lookup; cite as "SAM.gov notice ${sol}"):`,
    `Title: ${v(rec.title)}`,
    `Solicitation number: ${v(rec.solicitation_number)}`,
    `Agency: ${v([rec.department, rec.sub_tier].filter(Boolean).join(' / '))}`,
    `Notice type: ${v(rec.notice_type)}`,
    `Set-aside: ${v(rec.set_aside_description)}`,
    `NAICS: ${v(rec.naics_code)} · PSC: ${v(rec.psc_code)}`,
    `Response deadline: ${v(describeDeadline(rec.response_deadline))}`,
    `Place of performance: ${v([rec.pop_city, rec.pop_state].filter(Boolean).join(', '))}`,
    ...askMindyNoticeStatusLines(rec),
    ...formatSelectedNoticeFacts(facts),
  ].join('\n');
}

export type FactsDb = {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
    };
  };
};

/**
 * Load the facts block for a notice id. null when the notice is not in Mindy's records or the read fails
 * (the caller answers without the block; never a guessed record).
 */
export async function loadSolicitationFactsBlock(
  db: FactsDb,
  noticeId: string,
  opts: Parameters<typeof loadSelectedNoticeFacts>[1] = {},
): Promise<{ block: string; noticeId: string; label: string; finding: IncumbentFacts['finding'] } | null> {
  const { data, error } = await db.from('sam_opportunities').select(SOLICITATION_FACT_COLUMNS).eq('notice_id', noticeId).maybeSingle();
  if (error) {
    console.error('[solicitation-facts] notice read failed:', error.message);
    return null;
  }
  if (!data) return null;
  const rec = data as SelectedNoticeRecord;
  const facts = await loadSelectedNoticeFacts(rec, opts);
  return {
    block: formatSolicitationFactsBlock(rec, facts),
    noticeId: rec.notice_id,
    label: `SAM.gov notice ${rec.solicitation_number || rec.notice_id}`,
    finding: facts.incumbent.finding,
  };
}

/**
 * The selected notice in the shape find_opportunities returns an open item, so the intelligence gate checks and
 * ranks it with the other candidates on a card turn (openNoticesAsRecords reads these fields). Only fields the
 * record holds; nothing is filled in.
 */
export function cardRecordAsFindItem(rec: OpportunityRecord): Record<string, unknown> {
  return {
    notice_id: rec.notice_id,
    title: rec.title,
    solicitation_number: rec.solicitation_number,
    sub_agency: rec.sub_tier ?? rec.department,
    buyer: rec.department,
    response_deadline: rec.response_deadline,
    notice_type: rec.notice_type,
    set_aside: rec.set_aside_description,
    naics_code: rec.naics_code,
    psc_code: rec.psc_code,
    location_label: [rec.pop_city, rec.pop_state].filter(Boolean).join(', ') || null,
    sam_url: rec.ui_link,
  };
}
