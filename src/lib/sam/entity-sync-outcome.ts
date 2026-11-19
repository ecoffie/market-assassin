/**
 * Incremental SAM entity slice outcome.
 *
 * The ~910k sam_entities mirror is updated by bounded (NAICS, state) slices,
 * not a full reimport. An entities-only run must not stamp sync-decision-makers:
 * that job is the contacts pull, and a chained entity fetch was overwriting it
 * with success.
 */

export const SAM_ENTITY_JOB = 'sync-sam-entities';

export function entityPullStampsDecisionMakers(pull: string): boolean {
  return pull === 'contacts' || pull === 'both';
}

export function entitySyncOutcome(input: {
  upserted: number;
  errors: string[];
}): { success: boolean; cronOutcome: 'success' | 'error' | 'partial'; disclosure: string } {
  const disclosure = input.errors.join('; ').slice(0, 500);
  if (input.errors.length === 0) {
    return { success: true, cronOutcome: 'success', disclosure: '' };
  }
  if (input.upserted === 0) {
    return { success: false, cronOutcome: 'error', disclosure };
  }
  return { success: false, cronOutcome: 'partial', disclosure };
}
