/**
 * The supplier populations, stated ONCE with every denominator and overlap named.
 *
 * These are NOT the steps of a funnel. Every population is a subset of the
 * registered firms, but they are not nested in order:
 *
 *   registered (e.g. 633)  ⊇ contract holders (9)
 *   registered             ⊇ scored (50) = contract holders first + other registrants
 *   scored                 ⊇ capable (12)  (some contract holders, some not)
 *   scored                 ⊇ listed (15)   = the highest scorers, so listed ⊇ capable
 *                                            whenever every capable firm made the list
 *   capable listed firms   → parent companies (12)
 *
 * Presenting them as 633 → 9 → 50 → 12 → 15 implied the 50 were drawn from the
 * 9 and that 15 narrows 12 (Fort Bragg 561730/NC run, 2026-10-07). Every surface
 * renders from `supplierFunnel()`.
 */
import type { GroundedField } from './types';
import { geographyName } from './market-scope';

export interface SupplierFunnelInput {
  naics: string | null;
  state: string | null;
  /** Why the supplier search did not run, when it did not. */
  notRun?: 'missing_naics' | 'failed' | 'degraded' | null;
  eligiblePopulation: GroundedField<number>;
  matchingPerformers: GroundedField<number>;
  scoredSample?: GroundedField<number>;
  capableInScoredSample?: GroundedField<number>;
  /** Scored firms that are contract holders (seeded first). */
  contractHoldersInScored?: number | null;
  /** Contract holders among the capable scored firms. */
  capableContractHolders?: number | null;
  returnedRows: GroundedField<number>;
  /** Listed firms in the capable/active tiers (checked for a parent company). */
  checkedForParent?: GroundedField<number>;
  resolvedFamilies: GroundedField<number>;
  unresolvedParents: GroundedField<number>;
}

export interface FunnelStep {
  key: 'registered' | 'performers' | 'scored' | 'capable' | 'returned' | 'families' | 'unresolved';
  count: number;
  /** Plain statement of what was counted, including how it overlaps the others. */
  label: string;
  /** "3.9% of the 2,442 registered firms" — null when no meaningful denominator. */
  share: string | null;
}

export interface SupplierFunnel {
  ran: boolean;
  /** One paragraph a contracting officer can read without the glossary. */
  summary: string;
  steps: FunnelStep[];
  /** How the numbers relate, for Evidence & methodology and the appendix. */
  definitions: string[];
}

function num(field: GroundedField<number> | undefined): number | null {
  return field && field.state === 'value' ? field.value : field?.state === 'true_zero' ? 0 : null;
}

function finite(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function pct(part: number, whole: number): string {
  const p = (part / whole) * 100;
  return `${p < 0.1 && p > 0 ? '<0.1' : p.toFixed(1)}%`;
}

function share(part: number, whole: number | null, of: string): string | null {
  if (whole == null || whole <= 0) return null;
  return `${pct(part, whole)} of the ${fmt(whole)} ${of}`;
}

/** The matching census is current / recently ended contracts only — say so. */
function holderPhrase(naics: string): string {
  return `hold a current or recently ended federal prime contract in NAICS ${naics}`;
}

function holders(n: number): string {
  return `${fmt(n)} contract ${plural(n, 'holder', 'holders')}`;
}

export function supplierFunnel(input: SupplierFunnelInput): SupplierFunnel {
  const naics = input.naics;
  const where = input.state ? ` in ${geographyName(input.state)}` : '';

  if (input.notRun === 'missing_naics' || !naics) {
    return {
      ran: false,
      summary:
        'Supplier search was not run because no NAICS code was provided. Potential suppliers, the Rule-of-Two evidence and pricing evidence need a NAICS code.',
      steps: [],
      definitions: [],
    };
  }
  if (input.notRun === 'failed' || input.notRun === 'degraded') {
    return {
      ran: false,
      summary: `The supplier search for NAICS ${naics}${where} did not complete, so supplier counts are unknown. Unknown is not zero.`,
      steps: [],
      definitions: [],
    };
  }

  const registered = num(input.eligiblePopulation);
  const holderCount = num(input.matchingPerformers);
  const scored = num(input.scoredSample);
  const capable = num(input.capableInScoredSample);
  const holdersScored = finite(input.contractHoldersInScored);
  const capableHolders = finite(input.capableContractHolders);
  const listed = num(input.returnedRows);
  const checked = num(input.checkedForParent);
  const families = num(input.resolvedFamilies);
  const unresolved = num(input.unresolvedParents);
  const allHoldersScored = holdersScored != null && holderCount != null && holdersScored === holderCount;
  const allCapableListed = capable != null && checked != null && checked === capable;

  const steps: FunnelStep[] = [];
  if (registered != null) {
    steps.push({
      key: 'registered',
      count: registered,
      label: `small businesses registered in SAM for NAICS ${naics}${where} — every count below is a subset of these`,
      share: null,
    });
  }
  if (holderCount != null) {
    steps.push({
      key: 'performers',
      count: holderCount,
      label: `of the registered firms ${holderPhrase(naics)}`,
      share: share(holderCount, registered, 'registered firms'),
    });
  }
  if (scored != null) {
    steps.push({
      key: 'scored',
      count: scored,
      label:
        holdersScored != null
          ? `registered firms scored by Mindy: ${allHoldersScored ? 'all ' : ''}${holders(holdersScored)} and ${fmt(scored - holdersScored)} other registered ${plural(scored - holdersScored, 'firm', 'firms')}`
          : 'registered firms scored by Mindy (contract holders first, then other registered firms)',
      share: share(scored, registered, 'registered firms'),
    });
  }
  if (capable != null && scored != null) {
    steps.push({
      key: 'capable',
      count: capable,
      label:
        capableHolders != null
          ? `of the ${fmt(scored)} scored firms show capable or active performance (${holders(capableHolders)}, ${fmt(capable - capableHolders)} not)`
          : `of the ${fmt(scored)} scored firms show capable or active performance`,
      share: share(capable, scored, 'scored firms'),
    });
  }
  if (listed != null) {
    let label =
      scored != null
        ? `highest-scoring of the ${fmt(scored)} scored firms, listed with full detail`
        : 'highest-scoring firms, listed with full detail';
    if (checked != null) {
      label += allCapableListed
        ? ` — all ${fmt(checked)} capable firms plus ${fmt(listed - checked)} that are not capable`
        : ` — ${fmt(checked)} of them capable or active`;
    }
    steps.push({ key: 'returned', count: listed, label, share: scored != null ? share(listed, scored, 'scored firms') : null });
  }
  if (families != null && checked != null) {
    steps.push({
      key: 'families',
      count: families,
      label: `distinct parent companies among the ${fmt(checked)} capable listed ${plural(checked, 'firm', 'firms')}`,
      share: null,
    });
  }
  if (unresolved != null && unresolved > 0) {
    steps.push({
      key: 'unresolved',
      count: unresolved,
      label: 'listed firm(s) whose parent company could not be confirmed; not counted toward the Rule of Two',
      share: null,
    });
  }

  const sentences: string[] = [];
  if (registered != null && holderCount != null) {
    sentences.push(
      `${fmt(registered)} small businesses are registered in SAM for NAICS ${naics}${where}; ${fmt(holderCount)} of them (${pct(holderCount, registered || 1)}) ${holderPhrase(naics)}.`,
    );
  } else if (registered != null) {
    sentences.push(`${fmt(registered)} small businesses are registered in SAM for NAICS ${naics}${where}.`);
  }
  if (scored != null) {
    let s =
      holdersScored != null
        ? `Mindy scored ${fmt(scored)} of the registered firms: ${allHoldersScored ? 'all ' : ''}${holders(holdersScored)} and ${fmt(scored - holdersScored)} other registered ${plural(scored - holdersScored, 'firm', 'firms')}.`
        : `Mindy scored ${fmt(scored)} of the registered firms.`;
    if (capable != null) {
      s +=
        capableHolders != null
          ? ` ${fmt(capable)} of the ${fmt(scored)} show capable or active performance (${holders(capableHolders)}, ${fmt(capable - capableHolders)} not).`
          : ` ${fmt(capable)} of the ${fmt(scored)} show capable or active performance.`;
    }
    sentences.push(s);
  }
  if (listed != null) {
    const which =
      checked != null
        ? allCapableListed
          ? `: all ${fmt(checked)} capable firms and ${fmt(listed - checked)} that are not`
          : `, ${fmt(checked)} of them capable or active`
        : '';
    const parents =
      families != null && checked != null
        ? ` The ${fmt(checked)} capable listed ${plural(checked, 'firm belongs', 'firms belong')} to ${fmt(families)} distinct parent ${plural(families, 'company', 'companies')}${unresolved ? ` (${fmt(unresolved)} with a parent not confirmed)` : ''}.`
        : '';
    sentences.push(`The report lists the ${fmt(listed)} highest-scoring scored firms${which}.${parents}`);
  }

  return {
    ran: true,
    summary: sentences.join(' '),
    steps,
    definitions: [
      'These counts are separate populations, not steps in a funnel. Each is a subset of the registered firms, and each percentage names its own denominator.',
      `Registered: active SAM registrations that list NAICS ${naics}, represent themselves as small for that NAICS${input.state ? `, and are located${where}` : ''}. Small-business status is the firm's own SAM representation, not an SBA size determination.`,
      `Contract holders: registered firms that are the awardee on a current or recently ended federal prime contract coded NAICS ${naics} in Mindy's contract data from USASpending (performance ending from early 2026 onward). Firms whose ${naics} contracts ended earlier are not counted.`,
      'Scored: the firms Mindy evaluated for capability. Contract holders are scored first; the rest of the sample is other registered firms taken in a fixed order, not at random.',
      'Capable or active: scored firms whose federal award history (recency, track record, breadth of agencies, and whether they have won in this NAICS) reaches Mindy’s capability threshold.',
      'Listed: the highest-scoring scored firms (the market-depth tool returns at most 15). Parent-company deduplication is applied to the capable listed firms only.',
      'None of these counts is a complete census of the market.',
    ],
  };
}
