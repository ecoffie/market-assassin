/**
 * The WATCHER for manual sources — automates the noticing, never the ingest.
 *
 * Reuses the existing ops-alert stack wholesale:
 *   sendOpsAlert()    Slack client (no-ops when SLACK_LEAD_WEBHOOK_URL is unset)
 *   shouldSendAlert() duplicate suppression (fails OPEN, re-reminds at 72h)
 *   ops_alert_state   the state table both of those already use
 *
 * Nothing here is source-specific. Navy is a caller, not a special case.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOpsAlert } from '@/lib/ops-alert';
import { shouldSendAlert, fingerprint } from '@/lib/ops-alert-dedup';
import {
  deriveSourceState, needsIntervention, buildManualAlert,
  type ManualSourceContract, type ManualSourceObservation, type InterventionState,
} from './manual-source-ops';

export interface WatchOutcome {
  sourceKey: string;
  sourceState: string;
  interventionState: InterventionState;
  alerted: boolean;
  /** Why we did or did not alert — so a silent run is always explainable. */
  reason: string;
}

export async function watchManualSource(
  sb: SupabaseClient,
  contract: ManualSourceContract,
  observation: ManualSourceObservation,
  interventionState: InterventionState,
): Promise<WatchOutcome> {
  const sourceState = deriveSourceState(observation);

  if (!needsIntervention(sourceState, interventionState)) {
    return { sourceKey: contract.sourceKey, sourceState, interventionState, alerted: false, reason: 'no_intervention_needed' };
  }

  const alert = buildManualAlert(contract, sourceState, interventionState, observation);
  const gate = await shouldSendAlert(sb, alert.alertKey, fingerprint(alert.fingerprintParts));
  if (!gate.send) {
    return { sourceKey: contract.sourceKey, sourceState, interventionState, alerted: false, reason: `suppressed:${gate.reason}` };
  }

  await sendOpsAlert({
    subject: alert.subject,
    html: alert.bodyLines.map((l) => `<p>${l}</p>`).join(''),
  });

  return { sourceKey: contract.sourceKey, sourceState, interventionState, alerted: true, reason: gate.reason };
}
