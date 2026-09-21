/**
 * Supplier Activation — the reach gap, and the outreach list.
 *
 * PRD: tasks/PRD-supplier-activation.md §5 (the Gold Coast bridge).
 *
 * THE DISTINCTION THIS FILE EXISTS TO DRAW:
 *   The Market Research Workspace proves a market EXISTS.
 *   This helps the buyer ACTIVATE it.
 * A set-aside that drew one offer is not a market-depth problem — the market
 * was there. It is a reach problem, and nothing we shipped before addressed it.
 *
 * ⚠️ TERMINOLOGY (PRD §2). We do NOT call these firms "capable." What we have
 * measured is a current SAM registration in the target NAICS plus relevant
 * federal past performance. In an acquisition context "capable" carries
 * regulatory weight, and requirement-specific qualification — facility access,
 * clearances, quality certifications, capacity — is UNKNOWN to us and is
 * reported as Unknown, never assumed. The phrase is "relevant supplier pool"
 * or "market-qualified candidate."
 *
 * ⚠️ CONTACT DATA. SAM's public API redacts POC email and phone: measured 0
 * emails and 0 phones across a 20,000-POC sample, with a name on ~49%. This
 * module therefore emits a POC NAME and the SAM entity URL, and labels that
 * column "Identity for outreach" — never "Contact." An export column full of
 * blanks reads as a broken product and would be a false promise besides.
 */

import type { ScoredEntity, MarketResearchResult } from '@/lib/gov-buyer/market-research';
import type { ProcurementHistory } from '@/lib/gov-buyer/acquisition-context';

/** Normalize a business name for incumbent matching. */
function norm(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PBC|JV|JV2|JV3)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Did this pool firm appear in the sampled award record?
 *
 * Deliberately conservative: a token-overlap match, so "VIGOR MARINE LLC" in
 * the award record marks "VIGOR WORKS LLC" in the pool as observed. Over-
 * matching is the safe direction — wrongly calling a firm "already reached"
 * costs one candidate off an outreach list; wrongly calling an existing
 * awardee "never reached" puts a false claim in front of the contracting
 * officer who awarded them.
 */
/**
 * Leading words too common in company names to identify a firm on their own.
 *
 * Without this, "NATIONAL PUMP AND PROCESS" matches "NATIONAL STEEL AND
 * SHIPBUILDING" and gets marked as an existing awardee — which would quietly
 * drop a genuine outreach candidate off the list. Measured against the real
 * Navy 336611 award record, these were the actual false-positive sources.
 */
const GENERIC_LEADS = new Set([
  'NATIONAL', 'AMERICAN', 'UNITED', 'GENERAL', 'FEDERAL', 'ADVANCED', 'GLOBAL',
  'PACIFIC', 'ATLANTIC', 'NORTHWEST', 'NORTHERN', 'SOUTHERN', 'EASTERN',
  'WESTERN', 'INTERNATIONAL', 'CENTRAL', 'PREMIER', 'PROFESSIONAL', 'TECHNICAL',
  'INDUSTRIAL', 'MARINE', 'MARITIME', 'DEFENSE', 'ALLIED', 'FIRST', 'STANDARD',
]);

function matchesIncumbent(firmName: string, incumbentNames: string[]): boolean {
  const f = norm(firmName);
  if (!f) return false;
  const fTokens = f.split(' ').filter((t) => t.length > 2);
  if (!fTokens.length) return false;

  return incumbentNames.some((inc) => {
    const i = norm(inc);
    if (!i) return false;
    // Whole-name containment is safe in either direction once suffixes are
    // stripped ("VIGOR MARINE" ⊂ "VIGOR MARINE LLC").
    if (i === f || i.includes(f) || f.includes(i)) return true;

    const iTokens = i.split(' ').filter((t) => t.length > 2);
    if (!iTokens.length) return false;

    // Otherwise require the FIRST TWO tokens to agree, and the lead token to
    // be distinctive. One shared generic word is not evidence of identity.
    if (GENERIC_LEADS.has(fTokens[0])) {
      return fTokens.length > 1 && iTokens.length > 1
        && fTokens[0] === iTokens[0] && fTokens[1] === iTokens[1];
    }
    return fTokens[0] === iTokens[0] && fTokens[0].length > 3;
  });
}

export type ReachGroup = 'observed_in_awards' | 'not_in_sample';

export interface OutreachCandidate {
  company: string;
  uei: string;
  cage: string | null;
  location: string;
  /** Socioeconomic status, or 'Not certified' — never blank. */
  sbStatus: string;
  relevantPastPerformance: string;
  awardCount: number;
  totalObligated: number;
  /** Observed in the sampled award record for this office? */
  officeAwardObserved: boolean;
  /** POC name + SAM link. NOT contact details — see the file header. */
  pocName: string | null;
  samUrl: string;
  /** A sentence a CO can put in the file. Never a bare score. */
  whyMatched: string;
  /** Requirement-specific qualification. Always 'Unknown' today — Stage 2 is unbuilt. */
  qualificationStatus: 'Unknown';
  group: ReachGroup;
}

export interface ReachGap {
  /** Every firm returned by the market-research query. */
  totalIdentified: number;
  /** Market-qualified: excludes registered-only. The Rule-of-Two basis. */
  relevantPool: number;
  /** Pool firms matched to the sampled award record. */
  observedInAwards: number;
  /** Pool firms NOT matched — the activation candidates. */
  notInSample: number;
  /** Stage 2 is unbuilt, so these are honestly null rather than 0. */
  qualificationVerified: null;
  qualificationUnknown: number;
  /** Incumbent names the gap was computed against — provenance for the claim. */
  comparedAgainst: string[];
  caveat: string;
}

export interface SupplierActivation {
  reachGap: ReachGap;
  candidates: OutreachCandidate[];
}

function certLabel(certs: string[]): string {
  return certs.length ? certs.join(' · ') : 'Not certified';
}

function pastPerformance(e: ScoredEntity): string {
  if (!e.awardCount) return 'No federal award history on record';
  const usd = '$' + Math.round(e.totalObligated).toLocaleString('en-US');
  return `${e.awardCount} federal award${e.awardCount === 1 ? '' : 's'}, ${usd} obligated`;
}

/** The sentence that justifies this firm's presence on the list. */
function whyMatched(e: ScoredEntity, naics: string): string {
  const bits: string[] = [];
  bits.push(e.primaryNaics === naics ? `NAICS ${naics} primary` : `Registered in NAICS ${naics}`);
  if (e.awardCount) {
    bits.push(`${e.awardCount} federal award${e.awardCount === 1 ? '' : 's'} totaling $${Math.round(e.totalObligated).toLocaleString('en-US')}`);
  }
  if (e.distinctAgencyCount > 1) bits.push(`${e.distinctAgencyCount} agencies`);
  if (e.certifications.length) bits.push(e.certifications.join(', '));
  if (e.state) bits.push(e.state);
  return bits.join('; ') + '.';
}

/**
 * Build the reach gap + outreach candidate list.
 *
 * `history` supplies the incumbent set. When it is unmeasured, the gap is not
 * computed against an empty list — that would label every firm "never reached"
 * on the strength of a failed query. Instead the comparison set is empty and
 * the caveat says the reach gap could not be established.
 */
export function buildSupplierActivation(input: {
  research: MarketResearchResult;
  history: ProcurementHistory | null;
  naics: string;
  officeLabel?: string;
}): SupplierActivation {
  const { research, history, naics } = input;
  const office = input.officeLabel || 'this office';

  const incumbents = history?.measured
    ? Array.from(new Set(history.contracts.map((c) => c.incumbent).filter(Boolean)))
    : [];
  const gapComputable = incumbents.length > 0;

  // Market-qualified = everything except registered-only.
  const pool = research.businesses.filter((b) => b.tier !== 'registered_only');

  const candidates: OutreachCandidate[] = pool.map((e) => {
    const observed = gapComputable && matchesIncumbent(e.legalBusinessName, incumbents);
    return {
      company: e.legalBusinessName,
      uei: e.uei,
      cage: e.cageCode,
      location: [e.city, e.state].filter(Boolean).join(', ') || 'Not recorded',
      sbStatus: certLabel(e.certifications),
      relevantPastPerformance: pastPerformance(e),
      awardCount: e.awardCount,
      totalObligated: e.totalObligated,
      officeAwardObserved: observed,
      pocName: e.pocName,
      samUrl: e.samUrl || `https://sam.gov/entity/${e.uei}`,
      whyMatched: whyMatched(e, naics),
      qualificationStatus: 'Unknown',
      group: observed ? 'observed_in_awards' : 'not_in_sample',
    };
  });

  const observedCount = candidates.filter((c) => c.officeAwardObserved).length;

  const caveat = gapComputable
    ? `"Observed in awards" is computed against the ${incumbents.length} incumbent${incumbents.length === 1 ? '' : 's'} in the sampled award record for ${office}, not the complete contract file. A firm shown as not in the sample may still have worked with ${office}.`
    : `The reach gap could not be computed: no prior-award record was available for ${office}. Every firm is reported as not-in-sample, which reflects the absence of comparison data rather than an absence of prior work.`;

  return {
    reachGap: {
      totalIdentified: research.businesses.length,
      relevantPool: pool.length,
      observedInAwards: observedCount,
      notInSample: pool.length - observedCount,
      qualificationVerified: null,
      qualificationUnknown: pool.length,
      comparedAgainst: incumbents,
      caveat,
    },
    candidates,
  };
}

const CSV_HEADERS = [
  'Company', 'UEI', 'CAGE', 'Location', 'Small Business Status',
  'Relevant Past Performance', `${'Office Award Observed'}`,
  'Requirement Qualification', 'POC Name (SAM)', 'SAM.gov Record', 'Why Matched',
] as const;

function csvCell(v: string | number | null): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The outreach list as CSV.
 *
 * The header block is part of the artifact, not decoration: this file is
 * intended to land in an acquisition file, where an unlabeled list of company
 * names invites exactly the wrong reading — that these firms are vetted and
 * reachable. The caveats travel with the data.
 */
export function activationToCsv(input: {
  activation: SupplierActivation;
  naics: string;
  scope: string;
  preparedBy: string;
  onlyNotInSample?: boolean;
}): string {
  const { activation, naics, scope, preparedBy } = input;
  const rows = input.onlyNotInSample
    ? activation.candidates.filter((c) => !c.officeAwardObserved)
    : activation.candidates;

  const lines: string[] = [];
  lines.push(csvCell('Supplier Outreach List — market research support'));
  lines.push(csvCell(`Scope: ${scope}`));
  lines.push(csvCell(`Prepared by: ${preparedBy}`));
  lines.push(csvCell(`Generated: ${new Date().toISOString().slice(0, 10)}`));
  lines.push(csvCell(
    `Inclusion basis: current SAM registration in NAICS ${naics} plus relevant federal past performance. ` +
    'This is a market-qualification screen, NOT a determination that a firm is qualified, available, or ' +
    'interested in any specific requirement.',
  ));
  lines.push(csvCell(
    'Requirement-specific qualification (facility access, clearances, quality certifications, capacity) ' +
    'is Unknown for every firm listed and has not been evaluated.',
  ));
  lines.push(csvCell(activation.reachGap.caveat));
  lines.push(csvCell(
    'SAM.gov does not publish point-of-contact email or telephone through its public API. Where a POC ' +
    'name is shown, contact details must be obtained from the SAM.gov record linked in each row.',
  ));
  lines.push('');
  lines.push(CSV_HEADERS.map(csvCell).join(','));

  for (const c of rows) {
    lines.push([
      c.company, c.uei, c.cage ?? 'Not recorded', c.location, c.sbStatus,
      c.relevantPastPerformance,
      c.officeAwardObserved ? 'Yes — in sampled awards' : 'Not in sampled awards',
      c.qualificationStatus, c.pocName ?? 'Not published', c.samUrl, c.whyMatched,
    ].map(csvCell).join(','));
  }

  return lines.join('\r\n');
}
