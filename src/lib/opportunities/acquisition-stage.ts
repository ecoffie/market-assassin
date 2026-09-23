/**
 * ACQUISITION STAGE — "only RFIs and sources sought", "only vehicle solicitations", "only non-FAR".
 *
 * IMI test (2026-09-22): four of the five notices the manual run found were RFIs / sources sought,
 * and nothing let FIND ask for market-research notices only — Eric's standing screen.
 *
 * The rule, in order of authority:
 *   1. STRUCTURED FIRST. `sam_opportunities.notice_type` is the only structured stage field the cache
 *      carries (`notice_type_code` is NULL on all 36,506 active rows, measured 2026-09-22). Nine values
 *      exist live; the beginner stage classifier (src/lib/beginner/labels.ts `noticeStage`) already
 *      reads them — the patterns below are the same families, expressed ONCE as regexes so the SQL
 *      predicate and the JS labeller cannot disagree.
 *   2. TITLE KEYWORDS ARE SECONDARY and documented per rule. SAM has no "vehicle type" field and no
 *      live notice carries a BAA / CSO / OTA notice_type, so those groups can only be recognised from
 *      a word-bounded title keyword — and only on a notice whose STRUCTURED type is compatible (an
 *      Award Notice that mentions "IDIQ" is not a vehicle solicitation).
 *   3. UNKNOWN STAYS UNKNOWN. A notice with no / an unrecognised notice_type is never placed in a
 *      stage. A stage filter excludes it and the result reports HOW MANY were excluded that way.
 *
 * No length rules, no substring matches: every keyword is `\m…\M` word-bounded (the /try lesson —
 * `person` ⊂ `personnel`), acronyms that are also English words (SABER) are case-sensitive.
 */
import { imatchClause, matchClause, jsRegex } from '@/lib/discovery/matcher';

export type AcquisitionStageGroup = 'MARKET_RESEARCH' | 'VEHICLE_SOLICITATIONS' | 'NON_FAR';
export type StageSignal = 'structured_notice_type' | 'title_keyword';

export const ACQUISITION_STAGE_GROUPS: readonly AcquisitionStageGroup[] = ['MARKET_RESEARCH', 'VEHICLE_SOLICITATIONS', 'NON_FAR'];

export const STAGE_GROUP_LABEL: Record<AcquisitionStageGroup, string> = {
  MARKET_RESEARCH: 'Market research (RFI / sources sought)',
  VEHICLE_SOLICITATIONS: 'Vehicle solicitations (IDIQ / MACC / MATOC / JOC / SABER / BPA)',
  NON_FAR: 'Non-FAR (CSO / OTA / BAA)',
};

export interface StageRule {
  group: AcquisitionStageGroup;
  signal: StageSignal;
  /** Why this rule is defensible — surfaced as the match reason. */
  reason: string;
  /** Postgres regex (case-insensitive) the STRUCTURED notice_type must satisfy. Always required. */
  noticeTypeRe: string;
  /** Secondary title keywords (word-bounded). Case-insensitive and/or case-sensitive (acronyms). */
  titleCi?: string;
  titleCs?: string;
}

/** Every notice_type family the classifier recognises. Anything else (or NULL) is UNKNOWN. */
export const KNOWN_NOTICE_TYPE_RE =
  '(sources sought|\\mrfi\\M|request for information|special notice|presol|pre-sol|solicitation|combined|award|justification|surplus|sale of|consolidat|bundle|broad agency|\\mbaa\\M|commercial solutions|\\mcso\\M|other transaction|\\mota\\M|\\mrfq\\M|quot|\\mrfp\\M)';

/** Structured families (mirrors translateNoticeType / classifyNoticeType in beginner + utils). */
const NT_MARKET_RESEARCH = '(sources sought|\\mrfi\\M|request for information)';
const NT_ANNOUNCEMENT = '(special notice|presol|pre-sol)';
/** Solicitation-family + presolicitation ("Presolicitation" contains "solicitation"); never award/J&A/surplus/sources sought. */
const NT_SOLICITATION_OR_PRESOL = '(solicitation|combined|consolidat|bundle)';
const NT_NON_FAR = '(broad agency|\\mbaa\\M|commercial solutions|\\mcso\\M|other transaction|\\mota\\M)';
/** A notice that could carry a non-FAR call: anything live except award / justification / surplus sale. */
const NT_OPEN_FAMILY = '(sources sought|\\mrfi\\M|request for information|special notice|presol|pre-sol|solicitation|combined|consolidat|bundle)';

export const STAGE_RULES: readonly StageRule[] = [
  {
    group: 'MARKET_RESEARCH',
    signal: 'structured_notice_type',
    reason: 'SAM notice type is Sources Sought / RFI',
    noticeTypeRe: NT_MARKET_RESEARCH,
  },
  {
    group: 'MARKET_RESEARCH',
    signal: 'title_keyword',
    reason: 'Special notice / presolicitation whose title says RFI, request for information, sources sought or market research/survey',
    noticeTypeRe: NT_ANNOUNCEMENT,
    titleCi: '\\m(rfis?|requests? for information|sources sought|market research|market survey)\\M',
  },
  {
    group: 'VEHICLE_SOLICITATIONS',
    signal: 'title_keyword',
    reason: 'Solicitation / presolicitation whose title names a contract vehicle (SAM has no vehicle-type field)',
    noticeTypeRe: NT_SOLICITATION_OR_PRESOL,
    titleCi: '\\m(idiqs?|id/iq|indefinite[-\\s]+delivery|maccs?|matocs?|satocs?|jocs?|job order contract(s|ing)?|bpas?|blanket purchase agreements?|multiple[-\\s]+award)\\M',
    titleCs: '\\mSABER\\M',
  },
  {
    group: 'NON_FAR',
    signal: 'structured_notice_type',
    reason: 'SAM notice type is BAA / CSO / OTA',
    noticeTypeRe: NT_NON_FAR,
  },
  {
    group: 'NON_FAR',
    signal: 'title_keyword',
    reason: 'Title names a Commercial Solutions Opening, Other Transaction or Broad Agency Announcement (no award / J&A notices)',
    noticeTypeRe: NT_OPEN_FAMILY,
    titleCi: '\\m(commercial solutions? openings?|other transactions?|broad agency announcements?)\\M',
    titleCs: '\\m(CSO|OTA|BAA)s?\\M',
  },
];

export function parseStageGroup(raw: unknown): AcquisitionStageGroup | null | 'invalid' {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!s) return null;
  return (ACQUISITION_STAGE_GROUPS as readonly string[]).includes(s) ? (s as AcquisitionStageGroup) : 'invalid';
}

/** One rule as a PostgREST logic body. */
export function stageRuleExpr(r: StageRule): string {
  const title = [r.titleCi && imatchClause('title', r.titleCi), r.titleCs && matchClause('title', r.titleCs)].filter(Boolean) as string[];
  const nt = imatchClause('notice_type', r.noticeTypeRe);
  if (!title.length) return nt;
  return `and(${nt},or(${title.join(',')}))`;
}

/** PostgREST OR body: a notice is in the group when ANY of its rules holds. NULL notice_type never matches. */
export function stageOrExpr(group: AcquisitionStageGroup): string {
  return STAGE_RULES.filter((r) => r.group === group).map(stageRuleExpr).join(',');
}

/** PostgREST OR body for UNKNOWN stage: notice_type missing or not a recognised family. */
export function unknownStageOrExpr(): string {
  return `notice_type.is.null,${imatchClause('notice_type', KNOWN_NOTICE_TYPE_RE).replace('.imatch.', '.not.imatch.')}`;
}

export interface StageMatch {
  group: AcquisitionStageGroup;
  signal: StageSignal;
  reason: string;
}

export interface StageClassification {
  /** true when notice_type is missing or unrecognised — never placed in a group. */
  unknown: boolean;
  /** Every group the notice falls in, strongest signal first (structured before title). */
  groups: StageMatch[];
}

function ruleHolds(r: StageRule, row: { notice_type?: unknown; title?: unknown }): boolean {
  const nt = String(row.notice_type ?? '');
  if (!jsRegex(r.noticeTypeRe).test(nt)) return false;
  if (!r.titleCi && !r.titleCs) return true;
  const title = String(row.title ?? '');
  return (!!r.titleCi && jsRegex(r.titleCi).test(title)) || (!!r.titleCs && jsRegex(r.titleCs, true).test(title));
}

/** JS mirror of stageOrExpr — the SAME rules, so a labelled item always agrees with the SQL filter. */
export function classifyAcquisitionStage(row: { notice_type?: unknown; title?: unknown }): StageClassification {
  const nt = String(row.notice_type ?? '').trim();
  if (!nt || !jsRegex(KNOWN_NOTICE_TYPE_RE).test(nt)) return { unknown: true, groups: [] };
  const groups: StageMatch[] = [];
  for (const g of ACQUISITION_STAGE_GROUPS) {
    const hits = STAGE_RULES.filter((r) => r.group === g && ruleHolds(r, row));
    const best = hits.find((r) => r.signal === 'structured_notice_type') || hits[0];
    if (best) groups.push({ group: g, signal: best.signal, reason: best.reason });
  }
  return { unknown: false, groups };
}

export function stageMatchFor(row: { notice_type?: unknown; title?: unknown }, group: AcquisitionStageGroup): StageMatch | null {
  return classifyAcquisitionStage(row).groups.find((m) => m.group === group) || null;
}
