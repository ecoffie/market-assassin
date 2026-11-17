/**
 * Consumer impact of switching to the shared paid-status resolver — PURE, fixture-driven.
 *
 * Given per-account facts (synthetic fixtures, or facts an operator assembles offline),
 * report what each consumer decides today (flag OFF) versus with PAID_STATUS_RESOLVER=true,
 * and list only the accounts whose answer changes. No I/O, no customer data in this file.
 */
import { classifyPaidStatus, type PaidStatusFacts, type PaidStatusKind } from './paid-status';
import { LEGACY_ACTIVATION_PAID_REASONS, PAID_FUNDING_REASONS } from './paid-reasons';

/** Mirror of extraction-guard PAID_LEDGER_REASONS (flag OFF), frozen for comparison. */
export const LEGACY_GUARD_PAID_REASONS: readonly string[] = [
  'stripe_topup', 'pro_monthly', 'comp_monthly', 'admin_grant', 'app_tier_pro', 'app_tier_team',
];

export interface ImpactFixture { label: string; facts: PaidStatusFacts }

export interface ImpactRow {
  label: string;
  kind: PaidStatusKind;
  guardOld: boolean;
  guardNew: boolean;
  activationOld: boolean;
  activationNew: boolean;
  changed: boolean;
}

/** Legacy Layer A: any grant in the legacy list, or a funded pool (unknown pool → not paid, then the guard's catch fails open). */
export function legacyGuardStanding(f: PaidStatusFacts): boolean {
  const reasons = new Set((f.ledgerGrants ?? []).map((g) => g.reason));
  return LEGACY_GUARD_PAID_REASONS.some((r) => reasons.has(r)) || f.poolFunded === true;
}

function ledgerHasAny(f: PaidStatusFacts, list: readonly string[]): boolean {
  const reasons = new Set((f.ledgerGrants ?? []).map((g) => g.reason));
  return list.some((r) => reasons.has(r));
}

export function impactReport(fixtures: ImpactFixture[]): ImpactRow[] {
  return fixtures.map(({ label, facts }) => {
    const status = classifyPaidStatus(facts);
    const guardOld = legacyGuardStanding(facts);
    const guardNew = status.kind === 'unknown' || status.paidFunding === true || status.complimentaryAccess;
    const activationOld = ledgerHasAny(facts, LEGACY_ACTIVATION_PAID_REASONS);
    const activationNew = ledgerHasAny(facts, PAID_FUNDING_REASONS);
    return {
      label, kind: status.kind, guardOld, guardNew, activationOld, activationNew,
      changed: guardOld !== guardNew || activationOld !== activationNew,
    };
  });
}
