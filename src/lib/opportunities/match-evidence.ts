/**
 * FIND match evidence — WHAT established that a row matched, per horizon.
 *
 * ⚖️ THE RULE (A MATCH IS A CLAIM, applied to FIND): a DIRECT_MATCH needs BUY-SIDE evidence —
 * what the acquisition itself says it buys: its description / title, its PSC, its NAICS (or the
 * interpreted taxonomy codes). Three other things can put a row in front of the customer, and
 * each is labelled as what it is, never promoted:
 *
 *   holder_name              the incumbent/recipient's NAME carries the words (HOLDER_SIGNAL)
 *   buyer_name               the agency's NAME carries the words (RELATED_MARKET_CANDIDATE)
 *   company_registered_psc   the customer's OWN registered PSC recalled it (company anchor)
 *   company_registered_naics the customer's OWN registered NAICS recalled it (company anchor)
 *
 * Measured failure this closes (IMI test, 2026-09-22): 7 TYONEK MACHINING AND FABRICATION orders
 * under FA8571-23-D-0004 — NAICS 334515, PSC 4920, "VERSATILE DIAGNOSTIC AUTOMATED TEST STATION"
 * — came back DIRECT_MATCH for "industrial steel fabrication … machining". The only evidence was
 * the word MACHINING in the holder's legal name. The contract is a diagnostic test-station
 * requirement; nothing on the buy side is machining or fabrication.
 */
import { matchesText, type DiscoveryPlan } from '@/lib/discovery';
import {
  classifyRecord,
  type CapabilityInterpretation,
  type EvidenceClass,
} from '@/lib/opportunities/market-interpretation';
import { companyRecallBasis, type CompanyAnchor, type CompanyRecallBasis } from './company-anchor';

export type MatchBasis =
  | 'structured_scope'
  | 'buy_side_text'
  | 'buy_side_code'
  | 'holder_name'
  | 'buyer_name'
  | CompanyRecallBasis;

/** Coming back classes: the two FIND evidence classes + the holder-name signal. */
export type ComingBackClass = EvidenceClass | 'HOLDER_SIGNAL';

export interface ComingBackEvidence {
  cls: ComingBackClass | null;
  basis: MatchBasis[];
}

export interface RecompeteEvidenceRow {
  description?: string | null;
  psc_description?: string | null;
  naics_description?: string | null;
  naics_code?: string | null;
  psc_code?: string | null;
  incumbent_name?: string | null;
  awarding_agency?: string | null;
  awarding_sub_agency?: string | null;
  piid?: string | null;
}

function codeIn(list: string[], value: string | null | undefined): boolean {
  const v = String(value || '').trim();
  if (!v || !list.length) return false;
  return list.some((c) => (c.length < 6 ? v.startsWith(c) : v === c));
}

/** Codes the PLAN itself retrieved on (typed NAICS/PSC, crosswalks, industry preset, term-of-art). */
function planCodeHit(row: RecompeteEvidenceRow, plan: DiscoveryPlan, cap: CapabilityInterpretation): boolean {
  const naicsList = [...plan.horizons.recompete.naics, ...cap.direct.naics];
  const pscList = [...plan.psc, ...cap.direct.psc];
  return codeIn(naicsList, row.naics_code) || codeIn(pscList, row.psc_code);
}

const buySide = (r: RecompeteEvidenceRow) => [r.description, r.psc_description, r.naics_description];

/**
 * Evidence class for one Coming back (recompete) row.
 *   cyber plans   → classifyRecord (buy-side blob only), then holder-name → HOLDER_SIGNAL
 *   no text query → every admitted row IS the requested structured scope (DIRECT)
 *   code evidence → DIRECT (buy_side_code)
 *   buy-side text → DIRECT (buy_side_text)
 *   holder name   → HOLDER_SIGNAL
 *   agency name   → RELATED_MARKET_CANDIDATE (the buyer's broader market, not confirmed work)
 *   company code  → no class (labelled by basis only; never DIRECT)
 */
export function classifyComingBackEvidence(
  row: RecompeteEvidenceRow,
  plan: DiscoveryPlan,
  cap: CapabilityInterpretation,
  anchor?: CompanyAnchor | null,
): ComingBackEvidence {
  const basis: MatchBasis[] = [];
  const company = companyRecallBasis(row, anchor);
  if (company) basis.push(company);
  const holderHit = plan.matcher.mode !== 'none' && !!row.incumbent_name && matchesText(plan.matcher, [row.incumbent_name]);

  if (cap.kind === 'cyber_with_related_it') {
    const cls = classifyRecord(
      {
        title: row.naics_description || row.piid || '',
        description: [row.description, row.psc_description].filter(Boolean).join(' '),
        naics_code: row.naics_code || '',
        naics_description: row.naics_description || '',
        psc_code: row.psc_code || '',
      },
      cap,
    );
    if (cls === 'DIRECT_MATCH') basis.unshift(planCodeHit(row, plan, cap) ? 'buy_side_code' : 'buy_side_text');
    if (cls) return { cls, basis };
    if (holderHit) return { cls: 'HOLDER_SIGNAL', basis: ['holder_name', ...basis] };
    return { cls: null, basis };
  }

  if (plan.matcher.mode === 'none') return { cls: 'DIRECT_MATCH', basis: ['structured_scope', ...basis] };
  if (planCodeHit(row, plan, cap)) return { cls: 'DIRECT_MATCH', basis: ['buy_side_code', ...basis] };
  if (matchesText(plan.matcher, buySide(row))) return { cls: 'DIRECT_MATCH', basis: ['buy_side_text', ...basis] };
  if (holderHit) return { cls: 'HOLDER_SIGNAL', basis: ['holder_name', ...basis] };
  if (matchesText(plan.matcher, [row.awarding_agency, row.awarding_sub_agency])) {
    return { cls: 'RELATED_MARKET_CANDIDATE', basis: ['buyer_name', ...basis] };
  }
  return { cls: null, basis };
}

export function holderSignalWhy(phrase: string, row: { incumbent_name?: string | null; naics_code?: string | null; psc_code?: string | null }): string {
  const codes = [row.naics_code && `NAICS ${row.naics_code}`, row.psc_code && `PSC ${row.psc_code}`].filter(Boolean).join(' / ');
  return `Holder signal, not a match: only the holder's name (“${row.incumbent_name || 'unknown'}”) carries “${phrase}”. `
    + `What this contract bought${codes ? ` (${codes})` : ''} does not establish that work, and a name is not verified evidence the holder performs it.`;
}

export function buyerNameWhy(phrase: string): string {
  return `Related-market candidate for “${phrase}” — only the buying agency's name carries those words; the record does not establish the work.`;
}

export function companyCodeWhy(
  basis: CompanyRecallBasis,
  row: { naics_code?: string | null; psc_code?: string | null },
  record: 'notice' | 'contract' | 'forecast' = 'notice',
): string {
  return basis === 'company_registered_psc'
    ? `Recalled because the ${record}'s PSC ${row.psc_code} is one the company registered in SAM — not a match on the words you typed.`
    : `Recalled because the ${record}'s NAICS ${row.naics_code} is one the company registered in SAM — not a match on the words you typed.`;
}
