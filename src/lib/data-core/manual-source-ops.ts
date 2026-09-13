/**
 * Shared operations layer for MANUAL data sources.
 *
 * WHY THIS EXISTS
 * A source whose ingest cannot be automated still must not be allowed to rot in
 * silence. The failure mode is not "the robot broke" — it is "nobody remembered".
 * Automation of the INGEST and automation of the WATCHING are separable, and the
 * second one is mandatory even when the first is impossible.
 *
 * THE CENTRAL DISTINCTION — TWO STATES, NOT ONE
 * Every previous version of this idea collapsed into a single status field, and
 * that field always ended up lying, because it was answering two different
 * questions at once:
 *
 *   sourceState        — what is TRUE of the DATA (is Mindy holding the newest
 *                        thing upstream offers?). Only new DATA changes this.
 *   interventionState  — what is TRUE of the HUMAN WORK (has anyone picked this
 *                        up?). Only human action changes this.
 *
 * They are ORTHOGONAL. `content_stale` + `in_progress` is a normal, healthy
 * Tuesday: someone is on it, and the data has still not moved. Collapsing those
 * into one field forces a choice between "looks handled" (hides stale data) and
 * "looks broken" (nags someone already working). Both are wrong.
 *
 * ⚠️ THE LOAD-BEARING RULE — acknowledging is not fixing.
 * Marking an intervention done must NEVER be able to mark the source fresh.
 * `resolveIntervention` REFUSES to clear unless the caller supplies observed
 * evidence that the data actually advanced. Otherwise the ticket closes, the
 * channel goes quiet, and the source is exactly as stale as before — with the
 * alarm now disarmed. That is strictly worse than never having alerted.
 *
 * BLOCKED IS NOT MANUAL.
 * `manual` means a human CAN do it and we know the steps. `blocked` means nobody
 * can, yet — the procedure itself is unresolved. Telling an operator to "go
 * upload the file" when the import contract is unknown burns the one thing the
 * alert channel runs on: that its instructions are true. They get separate
 * action types and separate message text.
 */

/** What is true of the DATA. Advanced only by new data, never by human acknowledgement. */
export type ManualSourceState =
  | 'current'          // Mindy holds the newest thing upstream offers — verified
  | 'content_stale'    // upstream has advanced past what Mindy holds
  | 'upstream_quiet'   // upstream itself has not published; Mindy is not behind
  | 'unreachable'      // cannot even determine upstream state (fetch/parse failed)
  | 'unmeasured';      // never checked — NOT the same as current

/** What is true of the HUMAN WORK. Advanced only by human action, never by data. */
export type InterventionState =
  | 'none_required'    // nothing for a human to do
  | 'required'         // a human must act, nobody has
  | 'in_progress'      // acknowledged and being worked
  | 'blocked'          // a human tried; the procedure itself is unresolved
  | 'completed';       // acted AND the data was verified to advance

/**
 * What KIND of human action. This drives the words in the Slack message, so a
 * wrong value here produces a confidently wrong instruction to an operator.
 */
export type ManualActionType =
  | 'refresh_upload'            // the procedure is known: fetch newest, re-import
  | 'identity_resolution'       // records cannot be matched to held rows — import unsafe
  | 'controlled_import_required'// import possible only under a defined, not-yet-built control
  | 'credential_renewal'        // access expired
  | 'upstream_investigation';   // upstream changed shape; needs a human to look

/** An action type is only safe to describe as routine when we have PROVEN the procedure. */
const PROCEDURE_PROVEN: Record<ManualActionType, boolean> = {
  refresh_upload: true,
  credential_renewal: true,
  identity_resolution: false,
  controlled_import_required: false,
  upstream_investigation: false,
};

export interface ManualSourceContract {
  /** Stable source identity, e.g. 'navy_lrae'. Also the alert dedup key root. */
  sourceKey: string;
  /** Human-facing name used in the alert subject. */
  displayName: string;
  actionType: ManualActionType;
  /** Who is expected to act. Absent owner is itself a finding. */
  owner: string | null;
  /** Path to the runbook. An alert without one is an interruption, not a task. */
  runbookPath: string | null;
  /**
   * How long the data may legitimately sit unchanged before staleness is real.
   * Distinguishes "upstream is quiet" from "we are behind".
   */
  expectedCadenceDays: number;
}

export interface ManualSourceObservation {
  /** When the WATCHER last successfully checked upstream. */
  lastChecked: string | null;
  /** Newest edition/revision upstream currently offers, as observed. */
  latestUpstream: string | null;
  /** Newest edition/revision Mindy actually holds. */
  heldByMindy: string | null;
  /** True only when upstream state was determined; false on fetch/parse failure. */
  upstreamReadable: boolean;
}

/**
 * Derive the DATA state. Deliberately has no access to intervention state — a
 * source cannot become current because someone acknowledged an alert.
 */
export function deriveSourceState(obs: ManualSourceObservation): ManualSourceState {
  if (!obs.lastChecked) return 'unmeasured';
  if (!obs.upstreamReadable) return 'unreachable';
  if (obs.latestUpstream === null) return 'unmeasured';
  if (obs.heldByMindy === null) return 'content_stale';
  if (obs.latestUpstream === obs.heldByMindy) return 'current';
  return 'content_stale';
}

export interface InterventionRecord {
  state: InterventionState;
  /** Edition held at the moment the intervention was opened — the "before" side. */
  openedAtHeld: string | null;
  openedAt: string | null;
}

/** Evidence that the DATA moved. Required to close an intervention. */
export interface AdvanceEvidence {
  heldBefore: string | null;
  heldAfter: string | null;
}

export type ResolveOutcome =
  | { cleared: true; state: 'completed'; reason: 'verified_advance' }
  | { cleared: false; state: InterventionState; reason: 'no_advance_observed' | 'still_behind_upstream' };

/**
 * Close an intervention ONLY on proof the data advanced.
 *
 * ⚠️ This is the guard that keeps the whole system honest. A human saying "done"
 * is not evidence; a changed held-edition is. Refusing to clear keeps the source
 * alerting, which is the correct outcome when nothing actually changed.
 */
export function resolveIntervention(
  current: InterventionRecord,
  evidence: AdvanceEvidence,
  latestUpstream: string | null,
): ResolveOutcome {
  const advanced = evidence.heldAfter !== null && evidence.heldAfter !== evidence.heldBefore;
  if (!advanced) {
    return { cleared: false, state: current.state, reason: 'no_advance_observed' };
  }
  // Advanced, but still not the newest upstream offers: partial progress is not done.
  if (latestUpstream !== null && evidence.heldAfter !== latestUpstream) {
    return { cleared: false, state: 'in_progress', reason: 'still_behind_upstream' };
  }
  return { cleared: true, state: 'completed', reason: 'verified_advance' };
}

/** Whether this situation warrants interrupting a human at all. */
export function needsIntervention(
  sourceState: ManualSourceState,
  interventionState: InterventionState,
): boolean {
  if (interventionState === 'in_progress') return false; // already owned
  if (sourceState === 'current' || sourceState === 'upstream_quiet') return false;
  return true;
}

export interface ManualAlert {
  alertKey: string;
  subject: string;
  /** Fingerprint parts — feed to fingerprint() so re-alerts fire only on CHANGE. */
  fingerprintParts: string[];
  bodyLines: string[];
}

/**
 * Build the alert. The message must be TRUE about what the operator can do:
 * when the procedure is unproven we say so explicitly rather than implying a
 * routine re-upload will fix it.
 */
export function buildManualAlert(
  contract: ManualSourceContract,
  sourceState: ManualSourceState,
  interventionState: InterventionState,
  obs: ManualSourceObservation,
): ManualAlert {
  const proven = PROCEDURE_PROVEN[contract.actionType];
  const blocked = interventionState === 'blocked' || !proven;

  const lead = blocked
    ? `Automated ingest: DISABLED — ${labelForAction(contract.actionType)}`
    : `Automated ingest: DISABLED — manual refresh required`;

  const bodyLines = [
    lead,
    `Source state: ${sourceState}`,
    `Intervention: ${interventionState}`,
    `Latest upstream: ${obs.latestUpstream ?? 'unknown'}`,
    `Held by Mindy: ${obs.heldByMindy ?? 'unknown'}`,
    `Owner: ${contract.owner ?? 'UNASSIGNED — no owner recorded'}`,
  ];

  if (blocked) {
    // Never imply a file upload resolves an unresolved contract.
    bodyLines.push(
      'This source CANNOT be refreshed by uploading a newer file. The import '
      + 'procedure is unresolved; a documented controlled import must be built first.',
    );
  }
  bodyLines.push(
    contract.runbookPath
      ? `Runbook: ${contract.runbookPath}`
      : 'Runbook: NONE RECORDED — this alert has no documented procedure.',
  );

  return {
    alertKey: `manual-source:${contract.sourceKey}`,
    subject: `[Mindy] ${contract.displayName} — ${blocked ? 'manual intervention required' : 'refresh due'}`,
    // Fingerprint on the SITUATION, not the clock: re-alerts fire when the
    // upstream edition or the state changes, not merely because time passed.
    fingerprintParts: [
      contract.sourceKey,
      sourceState,
      interventionState,
      obs.latestUpstream ?? 'none',
      obs.heldByMindy ?? 'none',
    ],
    bodyLines,
  };
}

function labelForAction(a: ManualActionType): string {
  switch (a) {
    case 'identity_resolution': return 'identity contract unresolved';
    case 'controlled_import_required': return 'controlled import not yet built';
    case 'credential_renewal': return 'credentials expired';
    case 'upstream_investigation': return 'upstream format changed';
    case 'refresh_upload': return 'manual refresh required';
  }
}
