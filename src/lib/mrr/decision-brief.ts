/**
 * Contracting-officer presentation of an unchanged Rule-of-Two / epistemic result.
 *
 * This module does not decide Rule of Two. It translates the existing
 * determination, recommendation, and evidence buckets into four presentation
 * states. Binary yes/no is forbidden.
 */
import type { EvidenceClass } from './market-scope';
import type { GroundedField, RuleOfTwoDetermination } from './types';
import type { ReviewFinding } from './workspace-dto';

export type DecisionState =
  | 'SUPPORTED'
  | 'MORE RESEARCH NEEDED'
  | 'CONFLICTING EVIDENCE'
  | 'DATA UNAVAILABLE';

export interface DecisionBrief {
  state: DecisionState;
  stateLabel: string;
  found: string;
  supports: string;
  doesNotSupport: string;
  nextAction: string;
}

export interface DecisionBriefInput {
  determination: GroundedField<RuleOfTwoDetermination> | ReviewFinding;
  recommendation: GroundedField<string> | ReviewFinding;
  buyerAwardCount: number | null;
  buyerHistoryEmpty: boolean;
  buyerHistoryUnknown: boolean;
  installationContextPresent: boolean;
  predecessorEvidenceClass?: EvidenceClass | null;
  supplierScopeLabel?: string | null;
  supplierEvidenceClass?: EvidenceClass | null;
  pricingUnknown: boolean;
  pricingDegraded: boolean;
}

function fieldState(
  field: GroundedField<unknown> | ReviewFinding,
): 'value' | 'true_zero' | 'unknown' | 'degraded' | 'Sourced' | 'Measured zero' | 'Unknown' | 'Degraded' {
  return field.state;
}

function fieldText(field: GroundedField<unknown> | ReviewFinding): string {
  if ('text' in field && typeof field.text === 'string') return field.text;
  if (field.state === 'value' && 'value' in field) return String(field.value);
  if (field.state === 'true_zero' && 'label' in field) return field.label;
  if ((field.state === 'unknown' || field.state === 'Unknown') && 'reason' in field) {
    return field.reason ?? 'Unknown / Insufficient evidence';
  }
  if ((field.state === 'degraded' || field.state === 'Degraded') && 'reason' in field) {
    return field.reason ?? 'Degraded evidence';
  }
  return '';
}

function determinationValue(
  field: GroundedField<RuleOfTwoDetermination> | ReviewFinding,
): RuleOfTwoDetermination | null {
  if (field.state === 'value' && 'value' in field) {
    const value = field.value;
    if (value === 'met' || value === 'not_met' || value === 'undetermined') return value;
  }
  const text = fieldText(field).toLowerCase();
  if (/\bmet\b/.test(text) && !/undetermined|not_met|not met/.test(text)) return 'met';
  if (/not_met|not met/.test(text)) return 'not_met';
  if (/undetermined/.test(text)) return 'undetermined';
  return null;
}

export function buildDecisionBrief(input: DecisionBriefInput): DecisionBrief {
  const detState = fieldState(input.determination);
  const detValue = determinationValue(input.determination);
  const recommendation = fieldText(input.recommendation);
  const awardClause =
    input.buyerAwardCount == null
      ? 'Buyer-history award count was not established.'
      : input.buyerAwardCount === 0
        ? 'The scoped contracting office returned no in-scope awards for this requirement.'
        : `The scoped contracting office has ${input.buyerAwardCount} in-scope award${input.buyerAwardCount === 1 ? '' : 's'} in the retrieved buyer history.`;

  const capacityClause = input.supplierScopeLabel
    ? `Supplier evidence is ${input.supplierScopeLabel}.`
    : 'Broader market-capacity evidence was not separately labeled.';

  const found = [awardClause, capacityClause].join(' ');

  if (
    detState === 'degraded' ||
    detState === 'Degraded' ||
    input.predecessorEvidenceClass === 'contextual' && /conflict/i.test(recommendation)
  ) {
    return {
      state: 'CONFLICTING EVIDENCE',
      stateLabel: 'Sources disagree materially.',
      found,
      supports:
        'The record supports disclosing the disagreement and withholding a Rule-of-Two conclusion until the conflict is resolved.',
      doesNotSupport:
        'The evidence does not support treating one source as the acquisition conclusion while the other remains unresolved.',
      nextAction: input.installationContextPresent
        ? 'Review the identified predecessor as installation / mission context — not as this office’s buyer history — and resolve the conflicting source before choosing a strategy.'
        : 'Reconcile the disagreeing sources before choosing an acquisition strategy.',
    };
  }

  if (
    detState === 'unknown' ||
    detState === 'Unknown' ||
    input.buyerHistoryUnknown ||
    (input.buyerHistoryEmpty && (detValue === 'undetermined' || detValue == null))
  ) {
    const unavailable = input.buyerHistoryEmpty || input.buyerHistoryUnknown || detState === 'unknown' || detState === 'Unknown';
    if (unavailable && (input.buyerHistoryEmpty || input.buyerHistoryUnknown)) {
      return {
        state: 'DATA UNAVAILABLE',
        stateLabel: 'Required evidence could not be established.',
        found,
        supports:
          'The empty or unknown buyer-history result is itself a finding: Ralph did not invent awards for this office.',
        doesNotSupport:
          'It does not support a Rule-of-Two set-aside or an unrestricted strategy, and it does not support treating installation-context work as this office’s history.',
        nextAction: input.installationContextPresent
          ? 'Validate incumbent and buyer history at the scoped office, and review the identified predecessor only as installation context.'
          : 'Validate incumbent and buyer history for this office and requirement pairing before proceeding.',
      };
    }
  }

  if (detValue === 'met') {
    return {
      state: 'SUPPORTED',
      stateLabel: 'Evidence supports the acquisition conclusion.',
      found,
      supports: recommendation || 'Rule of Two is supported by at least two distinct parent-deduplicated capable small businesses.',
      doesNotSupport:
        input.supplierEvidenceClass === 'contextual'
          ? 'It does not establish a supplier census for the scoped contracting office — the supplier sample is broader market capacity.'
          : 'It does not replace the contracting officer’s independent determination, estimate, or signature.',
      nextAction: 'Proceed with the supported small-business set-aside strategy, subject to contracting-officer review.',
    };
  }

  if (detValue === 'not_met') {
    return {
      state: 'SUPPORTED',
      stateLabel: 'Evidence supports the acquisition conclusion.',
      found,
      supports: recommendation || 'The exhaustive sample does not support a Rule-of-Two set-aside.',
      doesNotSupport:
        'It does not support claiming two capable small businesses at this scope, and it does not convert an incomplete sample into a set-aside.',
      nextAction: 'Proceed with the supported unrestricted acquisition strategy, subject to contracting-officer review.',
    };
  }

  let nextAction = 'Obtain the missing evidence that currently blocks a defensible Rule-of-Two conclusion.';
  if (input.installationContextPresent) {
    nextAction =
      'Review the identified predecessor as installation / mission context and validate buyer history at the scoped office.';
  } else if (input.pricingUnknown || input.pricingDegraded) {
    nextAction = 'Obtain missing pricing evidence. Do not treat the absence as an Independent Government Estimate.';
  } else if (input.supplierEvidenceClass === 'contextual') {
    nextAction =
      'Broaden or refocus supplier outreach only after treating the current sample as market capacity — not as this office’s supplier census.';
  }

  if (/sources sought/i.test(recommendation) === false && /insufficient evidence/i.test(recommendation)) {
    // Keep Sources Sought off the default abstention path unless the engine said it.
  }

  return {
    state: 'MORE RESEARCH NEEDED',
    stateLabel: 'Evidence is insufficient for a defensible conclusion.',
    found,
    supports:
      recommendation ||
      'The evidence supports withholding a Rule-of-Two conclusion. Incomplete coverage is not a finding of zero capable small businesses.',
    doesNotSupport:
      'It does not support a set-aside, an unrestricted award decision, or converting installation-context awards into this office’s buyer history.',
    nextAction,
  };
}
