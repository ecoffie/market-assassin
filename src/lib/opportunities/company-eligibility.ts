/**
 * Company-anchored ELIGIBILITY screen — kept SEPARATE from relevance.
 *
 * Relevance answers "is this the work they asked about?" (evidence_class / match_basis).
 * Eligibility answers "may THIS company compete for it, as the notice is written?".
 * One never feeds the other: a DIRECT_MATCH can be NOT_ELIGIBLE (Shaw FY27 MACC), and a
 * row recalled only by a registered code can be ELIGIBLE.
 *
 *   ELIGIBLE      the notice's own restriction is satisfied by the company's own SAM record
 *   NOT_ELIGIBLE  the record positively contradicts the restriction (reason names both facts)
 *   UNKNOWN       anything the sources do not establish — never guessed either way
 *
 * RULES (each is a place this used to be easy to get wrong):
 *   - Size is judged under the NOTICE's NAICS against the company's representation for THAT
 *     NAICS. Small under 332312 says nothing about 236220.
 *   - `not_stated` set-aside (NULL / blank) is UNKNOWN — absent ≠ unrestricted
 *     (classifySetAside, src/lib/beginner/labels.ts). Only a source that SAYS "no set-aside" /
 *     unrestricted / full and open is ELIGIBLE on size grounds.
 *   - SAM 'E' (exception-dependent size standard) is UNKNOWN, never small or not small.
 *   - SDVOSB / WOSB / EDWOSB / VOSB programs need a certification this record cannot establish
 *     (SAM self-identification ≠ SBA VetCert / WOSB certification) → UNKNOWN unless size already
 *     rules the company out (every one of them is a SMALL-business program).
 *   - 8(a) / HUBZone are SBA-certified codes. A negative is asserted only from a complete
 *     Entity API record (`sba_list_authoritative`); a mirror record's silence is UNKNOWN.
 *   - A recompete is not a live solicitation: its future set-aside is not stated, so Coming back
 *     is always UNKNOWN (the prior award's set-aside and the size-under-NAICS ride as context).
 */
import { classifySetAside, type SetAsideKind } from '@/lib/beginner/labels';
import { sizeUnderNaics, type CompanyAnchor } from './company-anchor';

export type EligibilityStatus = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'UNKNOWN';

export interface EligibilityVerdict {
  status: EligibilityStatus;
  reason: string;
  basis: {
    /** What the source record says, verbatim. */
    set_aside: string | null;
    set_aside_kind: SetAsideKind | 'recompete_not_stated';
    naics: string | null;
    /** Company's SAM representation under THAT NAICS. */
    company_size_under_naics: 'Y' | 'N' | 'E' | 'not_represented' | 'size_unavailable' | 'no_naics_on_record';
    /** 'notice' = live SAM notice · 'forecast' = the agency's ANTICIPATED set-aside · 'recompete' = prior award */
    record: 'notice' | 'forecast' | 'recompete';
  };
}

export interface EligibilityInput {
  set_aside_code?: string | null;
  set_aside_description?: string | null;
  naics_code?: string | null;
}

const SMALL_PROGRAMS: ReadonlySet<SetAsideKind> = new Set(['sb', '8a', 'hubzone', 'sdvosb', 'wosb', 'edwosb', 'vosb']);

const PROGRAM_LABEL: Partial<Record<SetAsideKind, string>> = {
  sb: 'small-business set-aside',
  '8a': '8(a) set-aside',
  hubzone: 'HUBZone set-aside',
  sdvosb: 'SDVOSB set-aside',
  wosb: 'WOSB set-aside',
  edwosb: 'EDWOSB set-aside',
  vosb: 'veteran-owned set-aside',
};

/*
 * Some sources carry a YES/NO FLAG in the set-aside field instead of a program name. Measured
 * 2026-09-23 on agency_forecasts.set_aside_type (35,928 rows): "true" 654 · "True" 82 ·
 * "false" 7 · "False" 1 — every one DHS. The DHS APFS feed has two fields,
 * `small_business_set_aside` (boolean) and `small_business_program` (SB / 8(a) / SDVOSB /
 * HUBZone / WOSB / TBD); our ingest keeps the first non-empty of the two, so a flagged row keeps
 * only the boolean. Live feed 2026-09-23: true travels with SB 249 · TBD 58 · 8(a) 39 ·
 * SDVOSB 24 · HUBZone 18 · WOSB 14 — so "true" means "the agency marked this as a small-business
 * set-aside" and the program is not in our record. It must never be quoted to a customer.
 */
const FLAG_TRUE = /^(true|yes)$/i;
const FLAG_FALSE = /^(false|no)$/i;
const UNDECIDED = /^(tbd|to be determined)$/i;

function unevaluatedRestrictionReason(raw: string | null, kind: SetAsideKind): string {
  const t = (raw || '').trim();
  if (FLAG_TRUE.test(t)) {
    return 'The agency marks this as a small-business set-aside but does not say which program '
      + '(general small business, 8(a), HUBZone, SDVOSB or WOSB), so eligibility cannot be judged yet.';
  }
  if (FLAG_FALSE.test(t)) {
    return 'The agency marks this as not set aside for small business but does not state how it will be competed, so eligibility is not established.';
  }
  if (UNDECIDED.test(t)) {
    return 'The agency has not decided the set-aside yet, so eligibility is not established.';
  }
  if (kind === 'unknown') {
    // An unrecognized short code — same rule as translateSetAside: omit rather than print it.
    return 'The record lists a set-aside code this screen does not recognize, so eligibility is not established.';
  }
  // A worded restriction (e.g. "Sole Source", "Indian Small Business Economic Enterprise") is the
  // agency's own language and is safe to quote.
  return `The record lists a restriction ("${t}") that this screen cannot evaluate against the company record.`;
}

function sizeFact(anchor: CompanyAnchor, naics: string | null): EligibilityVerdict['basis']['company_size_under_naics'] {
  if (!naics) return 'no_naics_on_record';
  return sizeUnderNaics(anchor, naics);
}

/**
 * Screen one notice/forecast restriction against the company. `record` says which kind of
 * source the restriction came from (a forecast's set-aside is the agency's PLAN).
 */
export function evaluateEligibility(
  row: EligibilityInput,
  anchor: CompanyAnchor,
  record: 'notice' | 'forecast' = 'notice',
): EligibilityVerdict {
  const raw = String(row.set_aside_description || row.set_aside_code || '').trim() || null;
  // Code first when both exist: SAM codes are the structured field; descriptions vary in wording.
  const kind = classifySetAside(String(row.set_aside_code || '').trim() || raw);
  const naics = String(row.naics_code || '').trim() || null;
  const size = sizeFact(anchor, naics);
  const basis = { set_aside: raw, set_aside_kind: kind, naics, company_size_under_naics: size, record } as const;
  const name = anchor.legal_name || anchor.uei;
  const planned = record === 'forecast' ? ' (the agency\'s anticipated set-aside, not a final solicitation)' : '';
  const v = (status: EligibilityStatus, reason: string): EligibilityVerdict => ({ status, reason: reason + planned, basis: { ...basis } });

  if (kind === 'not_stated') {
    return v('UNKNOWN', 'The record does not state a set-aside. A missing set-aside is not the same as unrestricted, so eligibility is not established.');
  }
  if (kind === 'open') {
    return v('ELIGIBLE', `The record states no set-aside / unrestricted competition, so business size does not restrict ${name}.`);
  }
  if (kind === 'unknown' || kind === 'other') {
    return v('UNKNOWN', unevaluatedRestrictionReason(raw, kind));
  }
  if (!SMALL_PROGRAMS.has(kind)) {
    return v('UNKNOWN', `Set-aside "${raw}" is not evaluated by this screen.`);
  }

  const label = PROGRAM_LABEL[kind] || 'set-aside';
  // Every program here is a SMALL-business program: size under the notice NAICS is the first gate.
  if (!naics) return v('UNKNOWN', `This is a ${label}, but the record carries no NAICS, so size cannot be judged.`);
  if (size === 'N') {
    return v('NOT_ELIGIBLE', `This is a ${label} under NAICS ${naics}, and ${name} does not represent itself as small under ${naics} in SAM.`);
  }
  if (size === 'E') {
    return v('UNKNOWN', `This is a ${label} under NAICS ${naics}; SAM marks ${name}'s size under ${naics} as exception-dependent, which is not a yes/no size answer.`);
  }
  if (size === 'not_represented') {
    return v('UNKNOWN', `This is a ${label} under NAICS ${naics}; ${name} has no size representation for ${naics} in SAM (NAICS not on its registration).`);
  }
  if (size === 'size_unavailable') {
    return v('UNKNOWN', `This is a ${label} under NAICS ${naics}; the company record available here carries no per-NAICS size, so size is not established.`);
  }

  // size === 'Y' — small under this NAICS (SAM self-representation).
  if (kind === 'sb') {
    return v('ELIGIBLE', `This is a ${label} under NAICS ${naics}, and ${name} represents itself as small under ${naics} in SAM (self-representation, not an SBA size determination).`);
  }
  if (kind === '8a' || kind === 'hubzone') {
    const has = kind === '8a' ? anchor.certifications.sba_8a : anchor.certifications.sba_hubzone;
    const prog = kind === '8a' ? '8(a)' : 'HUBZone';
    if (has === true) return v('ELIGIBLE', `This is a ${label}; ${name} is small under ${naics} and holds an SBA-certified ${prog} designation in SAM.`);
    if (has === false && anchor.certifications.sba_list_authoritative) {
      return v('NOT_ELIGIBLE', `This is a ${label}; ${name}'s SAM record carries no SBA-certified ${prog} designation.`);
    }
    return v('UNKNOWN', `This is a ${label}; ${prog} certification is not established by the company record available here.`);
  }
  // SDVOSB / WOSB / EDWOSB / VOSB: self-identification in SAM is not the authoritative certification.
  return v('UNKNOWN', `This is a ${label}; ${name} is small under ${naics}, but the program certification (SBA VetCert / WOSB program) is not established by SAM self-identification.`);
}

/**
 * Coming back rows are recompetes of a PRIOR award — not a live solicitation. The future
 * restriction is not stated anywhere yet, so the verdict is UNKNOWN; the prior set-aside and the
 * company's size under the prior NAICS are returned as context, never as the answer.
 */
export function evaluateRecompeteEligibility(
  row: { set_aside_type?: string | null; naics_code?: string | null },
  anchor: CompanyAnchor,
): EligibilityVerdict {
  const naics = String(row.naics_code || '').trim() || null;
  const size = sizeFact(anchor, naics);
  const prior = String(row.set_aside_type || '').trim() || null;
  const sizeBit = naics && (size === 'Y' || size === 'N')
    ? ` ${anchor.legal_name || anchor.uei} ${size === 'Y' ? 'represents itself as small' : 'does not represent itself as small'} under the prior NAICS ${naics}.`
    : '';
  return {
    status: 'UNKNOWN',
    reason: `Not a live solicitation — the recompete's set-aside has not been stated.${prior ? ` The prior award was "${prior}".` : ''}${sizeBit}`,
    basis: { set_aside: prior, set_aside_kind: 'recompete_not_stated', naics, company_size_under_naics: size, record: 'recompete' },
  };
}

export function unresolvedCompanyVerdict(note: string, record: EligibilityVerdict['basis']['record']): EligibilityVerdict {
  return {
    status: 'UNKNOWN',
    reason: `Company record unavailable: ${note}`,
    basis: { set_aside: null, set_aside_kind: record === 'recompete' ? 'recompete_not_stated' : 'not_stated', naics: null, company_size_under_naics: 'size_unavailable', record },
  };
}
