/**
 * MINDY INSTITUTE — Federal Register adapter (the SECOND document source).
 *
 * Reuses the GAO contract verbatim: the same `InstituteDocument` shape, the same
 * `ingestInstituteDocument()`, the same `institute_sources` destination, the same
 * resolver, the same `intelligence_changes` history, the same four clocks. The ONLY
 * new thing here is an ADMISSION GATE, because Federal Register volume is different
 * in kind from GAO's.
 *
 * ⚠️ WHY AN ADMISSION GATE (measured, not assumed). GAO published 25 reports in the
 * window we ingest; all 25 could enter. The Federal Register published **271
 * documents in three days** (2026-09-11..14), of which **168 were Notices** —
 * "Sunshine Act Meeting", "Information Collection Being Reviewed", "Board of
 * Visitors". Admitting all of them would bury the strategic signal.
 *
 * SO: "a Federal Register document exists" is NOT "Institute strategic evidence."
 *
 * ⚠️ THE GATE USES SOURCE METADATA BEFORE INTERPRETATION. The API gives us
 * `type`, `action`, `significant`, `topics`, `agencies`, `cfr_references`,
 * `docket_ids` — real publisher-assigned fields. We lean on those first and use
 * title/abstract text only to (a) reject a small set of structurally-nonstrategic
 * notice classes and (b) recognise explicit procurement/requirement language.
 *
 * ⚠️ THREE OUTCOMES, NEVER TWO. A classifier that cannot evaluate a document
 * returns `unresolved` — never `not_relevant`. A parse failure must never read as
 * "0 relevant documents today."
 */
import type { InstituteDocument } from './sources';

export type AdmissionOutcome = 'admitted' | 'not_relevant' | 'unresolved';

/** Why the Institute retained (or declined) this document. Categorical — no invented confidence %. */
export type AdmissionCategory =
  | 'regulatory_requirement'      // a Rule/Proposed Rule creating or changing obligations
  | 'significant_action'          // publisher-flagged significant
  | 'acquisition_policy'          // procurement/acquisition/contracting policy
  | 'program_or_funding'          // program creation/change, funding or grant authority
  | 'industry_engagement'         // RFI / request for comment with market implications
  | 'presidential_directive'      // EO / presidential document
  | 'routine_notice'              // structurally non-strategic (rejection reason)
  | 'no_strategic_signal'         // evaluated, nothing strategic (rejection reason)
  | 'insufficient_metadata';      // could not evaluate (UNRESOLVED reason)

export interface AdmissionDecision {
  outcome: AdmissionOutcome;
  category: AdmissionCategory;
  /** One line a human can check. Never asserts more than the metadata supports. */
  basis: string;
}

export interface FederalRegisterApiItem {
  document_number?: string | null;
  type?: string | null;
  title?: string | null;
  abstract?: string | null;
  publication_date?: string | null;
  html_url?: string | null;
  action?: string | null;
  significant?: boolean | null;
  topics?: string[] | null;
  docket_ids?: string[] | null;
  cfr_references?: unknown[] | null;
  agencies?: Array<{ name?: string | null; raw_name?: string | null }> | null;
}

/**
 * Notice classes that are structurally NON-strategic. These are the FR's own
 * recurring administrative furniture — measured as the dominant noise in a real
 * batch. Matched on the title, which for these is highly formulaic.
 */
const ROUTINE_NOTICE = new RegExp([
  'sunshine act',
  'information collection',
  'agency information collection',
  'board of visitors',
  'privacy act of 1974',
  'meeting notice',
  'notice of meeting',
  'combined notice of filings',
  'agenda and notice',
  'petition for',
  'airworthiness directive',      // aircraft-model specific, not agency demand
  'antidumping|countervailing',
  'application for|applications for',
].join('|'), 'i');

/**
 * Explicit procurement / acquisition language — the strongest positive signal.
 *
 * ⚠️ `solicitation` ALONE is deliberately NOT here. Measured against a real batch it
 * matched "Solicitation for Nominations To Serve on the Advisory Council" three
 * times — the word is used in the FR for committee recruitment far more often than
 * for contracting. It is admitted only in a procurement phrase.
 */
const ACQUISITION = /\b(acquisition regulation|federal acquisition regulation|\bFAR\b|procurement|contracting officer|competitive bidding|set-aside|contract award|solicitation for (?:bids|offers|proposals|quotations))\b/i;

/** Program / funding authority language. */
const PROGRAM_FUNDING = /\b(grant program|funding opportunity|notice of funding|program authority|appropriat\w+|allocation of funds|cooperative agreement)\b/i;

/**
 * Subject matter that is real regulation but NOT federal demand. Every pattern here
 * was observed admitting noise in a measured batch — none is speculative.
 */
const NON_DEMAND_SUBJECT = new RegExp([
  'fisheries|fishery|bluefish|catch share',
  'safety zone|special local regulation|navigation',
  'air quality|ozone|implementation plans?;',
  'tariff|duties|importation|trade barrier',
  'quota transfer',
  'roadless|conservation area',
  'depository institution|deductions to foreign source',
].join('|'), 'i');

/** Industry engagement with market implications. */
const ENGAGEMENT = /\b(request for information|request for comment|notice of inquiry|advance notice of proposed rulemaking|public meeting on)\b/i;

/**
 * Decide whether a Federal Register document is Institute evidence.
 *
 * Order matters: UNRESOLVED is checked first (we cannot judge what we cannot read),
 * then structural rejections, then positive signals from publisher metadata.
 */
export function decideAdmission(item: FederalRegisterApiItem): AdmissionDecision {
  const title = (item.title ?? '').trim();
  const type = (item.type ?? '').trim();

  // ── C. UNRESOLVED — missing the fields any decision would rest on. ──
  // NEVER collapse this into "not relevant": an unreadable document is not a
  // judged-irrelevant one, and the difference is the whole point of three outcomes.
  if (!item.document_number || !title || !type) {
    return {
      outcome: 'unresolved',
      category: 'insufficient_metadata',
      basis: `missing ${!item.document_number ? 'document_number' : !title ? 'title' : 'type'} — could not evaluate`,
    };
  }

  const hay = `${title}\n${item.abstract ?? ''}\n${item.action ?? ''}`;

  // ── A. ADMIT on publisher-assigned significance. ──
  if (item.significant === true) {
    return { outcome: 'admitted', category: 'significant_action', basis: 'publisher flagged the document as significant' };
  }

  // ── Structural rejection: the FR's recurring administrative furniture. ──
  // Checked BEFORE the generic Rule admit so an "Airworthiness Directive" rule
  // does not enter as agency demand.
  if (ROUTINE_NOTICE.test(title)) {
    return { outcome: 'not_relevant', category: 'routine_notice', basis: `routine administrative notice class ("${title.slice(0, 48)}")` };
  }

  // ── A. ADMIT on explicit strategic language (any document type). ──
  if (ACQUISITION.test(hay)) {
    return { outcome: 'admitted', category: 'acquisition_policy', basis: 'names acquisition/procurement policy or contracting activity' };
  }
  if (PROGRAM_FUNDING.test(hay)) {
    return { outcome: 'admitted', category: 'program_or_funding', basis: 'names program authority, funding or grant activity' };
  }
  if (ENGAGEMENT.test(hay)) {
    return { outcome: 'admitted', category: 'industry_engagement', basis: 'solicits industry information or comment with market implications' };
  }

  // ── Structural rejection #2: SUBJECT-MATTER that is real regulation but is not
  // federal DEMAND. Measured against a real batch, an unfiltered "admit every Rule"
  // pulled in fisheries quotas, safety zones, state air-quality plans, airworthiness
  // directives and tariff proclamations. Those are genuine federal actions and
  // genuinely irrelevant to what an agency will BUY.
  if (NON_DEMAND_SUBJECT.test(title)) {
    return { outcome: 'not_relevant', category: 'no_strategic_signal', basis: `regulatory action outside federal demand (${title.slice(0, 44)})` };
  }

  // ── A. ADMIT on document type: a Rule changes obligations by definition. ──
  if (type === 'Rule' || type === 'Proposed Rule') {
    return { outcome: 'admitted', category: 'regulatory_requirement', basis: `${type} — creates or changes a federal requirement` };
  }
  if (type === 'Presidential Document') {
    return { outcome: 'admitted', category: 'presidential_directive', basis: 'presidential document — executive requirement' };
  }

  // ── B. EVALUATED, nothing strategic. Distinct from "could not evaluate". ──
  return { outcome: 'not_relevant', category: 'no_strategic_signal', basis: `${type} with no acquisition, program, funding or engagement signal` };
}

/** Map an admitted FR item onto the SHARED Institute document shape. */
export function toInstituteDocument(item: FederalRegisterApiItem, watermark: string | null): InstituteDocument {
  const agency = item.agencies?.[0];
  return {
    sourceOrg: 'Federal Register',
    sourceType: 'federal_register',
    documentNumber: String(item.document_number),   // stable + unique — the idempotency key
    title: String(item.title),
    url: item.html_url ?? `https://www.federalregister.gov/d/${item.document_number}`,
    publicationDate: item.publication_date ?? null,
    abstract: [item.abstract, item.action ? `ACTION: ${item.action}` : null,
      agency ? `AGENCY: ${agency.name ?? agency.raw_name}` : null]
      .filter(Boolean).join('\n\n').slice(0, 4000) || null,
    sourceWatermark: watermark,
  };
}

/**
 * Fetch a BOUNDED forward window. Never the 10,000-document historical population.
 *
 * `since` is the activation boundary or the stored watermark. We deliberately
 * re-request the watermark DAY rather than the instant after it — the FR publishes
 * many documents per day, and an exclusive cursor would drop any document that
 * landed after our last poll on that same date. Re-reading a day is free because
 * ingestion is idempotent on document_number.
 */
export async function fetchFederalRegisterSince(
  since: string,
  fetchImpl: typeof fetch = fetch,
  perPage = 200,
): Promise<FederalRegisterApiItem[]> {
  const fields = ['document_number', 'type', 'title', 'abstract', 'publication_date',
    'html_url', 'action', 'significant', 'topics', 'docket_ids', 'cfr_references', 'agencies'];
  const params = new URLSearchParams({ per_page: String(perPage), order: 'newest' });
  for (const f of fields) params.append('fields[]', f);
  params.append('conditions[publication_date][gte]', since);

  const res = await fetchImpl(`https://www.federalregister.gov/api/v1/documents.json?${params}`, {
    headers: { 'User-Agent': 'Mindy-Institute (hello@getmindy.ai)' },
  });
  if (!res.ok) throw new Error(`Federal Register API ${res.status}`);
  const body = await res.json() as { results?: FederalRegisterApiItem[] };
  if (!Array.isArray(body.results)) throw new Error('Federal Register response had no results array');
  return body.results;
}
