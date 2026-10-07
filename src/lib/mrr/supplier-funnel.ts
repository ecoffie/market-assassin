/**
 * The supplier population, stated ONCE with every denominator named.
 *
 * Before this module the screen, the report and the appendix each phrased the
 * counts differently ("matching UEIs", "bounded sample", "sample_coverage=0.039…"),
 * and one of them was wrong: the market-depth tool scores up to 50 firms but
 * returns only its top 15 rows, and §11 called those 15 "the sample".
 *
 * Every surface renders from `supplierFunnel()`, so a count can only appear
 * with the population it was counted from.
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
  returnedRows: GroundedField<number>;
  /** Listed firms in the capable/active tiers, which were checked for a parent company. */
  checkedForParent?: GroundedField<number>;
  resolvedFamilies: GroundedField<number>;
  unresolvedParents: GroundedField<number>;
}

export interface FunnelStep {
  key:
    | 'registered'
    | 'performers'
    | 'scored'
    | 'capable'
    | 'returned'
    | 'checked'
    | 'families'
    | 'unresolved';
  count: number;
  /** Plain statement of what was counted. */
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

const fmt = (n: number) => n.toLocaleString('en-US');

function pct(part: number, whole: number): string {
  const p = (part / whole) * 100;
  return `${p < 0.1 && p > 0 ? '<0.1' : p.toFixed(1)}%`;
}

function share(part: number, whole: number | null, of: string): string | null {
  if (whole == null || whole <= 0) return null;
  return `${pct(part, whole)} of the ${fmt(whole)} ${of}`;
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
      summary:
        `The supplier search for NAICS ${naics}${where} did not complete, so supplier counts are unknown. Unknown is not zero.`,
      steps: [],
      definitions: [],
    };
  }

  const registered = num(input.eligiblePopulation);
  const performers = num(input.matchingPerformers);
  const scored = num(input.scoredSample);
  const capable = num(input.capableInScoredSample);
  const returned = num(input.returnedRows);
  const checked = num(input.checkedForParent);
  const families = num(input.resolvedFamilies);
  const unresolved = num(input.unresolvedParents);

  const steps: FunnelStep[] = [];
  if (registered != null) {
    steps.push({
      key: 'registered',
      count: registered,
      label: `small businesses registered in SAM for NAICS ${naics}${where}`,
      share: null,
    });
  }
  if (performers != null) {
    steps.push({
      key: 'performers',
      count: performers,
      label: `of those have held a federal prime contract in NAICS ${naics}`,
      share: share(performers, registered, 'registered firms'),
    });
  }
  if (scored != null) {
    steps.push({
      key: 'scored',
      count: scored,
      label: 'firms scored by Mindy, a limited sample drawn from contract holders first',
      share: share(scored, registered, 'registered firms'),
    });
  }
  if (capable != null && scored != null) {
    steps.push({
      key: 'capable',
      count: capable,
      label: `of the ${fmt(scored)} scored firms show capable or active performance`,
      share: share(capable, scored, 'scored firms'),
    });
  }
  if (returned != null) {
    steps.push({
      key: 'returned',
      count: returned,
      label: 'highest-scoring firms listed with full detail',
      share: scored != null ? share(returned, scored, 'scored firms') : null,
    });
  }
  const checkedBase = checked != null && returned != null && checked < returned ? checked : returned;
  if (checked != null && returned != null && checked < returned) {
    steps.push({
      key: 'checked',
      count: checked,
      label: `of the ${fmt(returned)} listed firms are capable or active and were checked for a parent company`,
      share: share(checked, returned, 'listed firms'),
    });
  }
  if (families != null && checkedBase != null) {
    steps.push({
      key: 'families',
      count: families,
      label: `distinct parent companies among those ${fmt(checkedBase)} firms`,
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
  if (registered != null && performers != null) {
    sentences.push(
      `Of ${fmt(registered)} small businesses registered in SAM for NAICS ${naics}${where}, ${fmt(performers)} (${pct(performers, registered || 1)}) have held a federal prime contract in that NAICS.`,
    );
  } else if (registered != null) {
    sentences.push(`${fmt(registered)} small businesses are registered in SAM for NAICS ${naics}${where}.`);
  }
  if (scored != null) {
    sentences.push(
      capable != null
        ? `Mindy scored ${fmt(scored)} of them; ${fmt(capable)} of the ${fmt(scored)} show capable or active performance.`
        : `Mindy scored ${fmt(scored)} of them.`,
    );
  }
  if (returned != null) {
    sentences.push(
      families != null
        ? `The ${fmt(returned)} highest-scoring firms are listed with full detail` +
          (checked != null && checked < returned ? `; ${fmt(checked)} of them are capable or active and were checked for a parent company` : '') +
          `. They belong to ${fmt(families)} distinct parent compan${families === 1 ? 'y' : 'ies'}${unresolved ? ` (${fmt(unresolved)} with a parent not confirmed)` : ''}.`
        : `The ${fmt(returned)} highest-scoring firms are listed with full detail.`,
    );
  }

  return {
    ran: true,
    summary: sentences.join(' '),
    steps,
    definitions: [
      `Registered: active SAM registrations that list NAICS ${naics}, represent themselves as small for that NAICS${input.state ? `, and are located${where}` : ''}. Small-business status is the firm's own SAM representation, not an SBA size determination.`,
      `Contract holders: registered firms that appear as the awardee on a federal prime contract coded NAICS ${naics} in USASpending.`,
      'Scored: the firms Mindy evaluated for capability. The sample is limited in size; it is drawn first from contract holders (largest contract value first), then from other registrants.',
      'Capable or active: scored firms whose federal award history (recency, track record, breadth of agencies, and whether they have won in this NAICS) reaches Mindy’s capability threshold. Registered firms with no relevant award history are not counted.',
      'Listed: the market-depth tool returns at most 15 firms with full detail. Parent-company deduplication is applied to these listed firms only.',
      'Every percentage above names its own denominator. None of these counts is a complete census of the market.',
    ],
  };
}
