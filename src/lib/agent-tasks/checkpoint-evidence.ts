import { hasStructuredCandidate } from './candidate-evidence-contract';
import type { CheckpointOutcome, RegistryResult, TaskCheckpoint, TaskRecord } from './types';
import { requiredCommandsForProfiles } from './verification-profiles';

/**
 * PHASE 3A.4 (A) — REJECT INCOMPLETE STRUCTURED CHECKPOINTS AT SUBMISSION TIME.
 *
 * ⚠️ THE DEFECT THIS CLOSES (measured on the real TASK-PSTACK-PILOT-002): a Builder
 * submitted `ready_for_verification` and a Verifier submitted `verified`, and BOTH were
 * ACCEPTED — the registry advanced ready -> verification -> integration and released the
 * lease — even though neither carried `evidence.candidateHeadSha` or
 * `evidence.candidateTreeSha`. The candidate identity existed only as PROSE inside
 * `evidence.notes`:
 *
 *     "candidateHeadSha=4a02c915... candidateTreeSha=2ec36230... baseSha=5d8a3007..."
 *
 * Prose is not a schema. Nothing reads it, nothing validates it, and it cannot be compared.
 * The task therefore looked healthy through three state transitions and only failed much
 * later, at `integration-handoff`, when `extractCandidateIdentity` demanded structured
 * fields. By then the Builder and Verifier leases were gone and their work could not be
 * amended — the only remaining routes were re-running the whole chain or an administrator
 * act. A validation that fires three transitions after the mistake is not a gate; it is an
 * autopsy.
 *
 * ── THE SCHEMA LOCATION, STATED EXACTLY ──────────────────────────────────────────────────
 * Candidate identity lives at, and ONLY at:
 *
 *     checkpoint.evidence.candidateHeadSha   (string, /^[0-9a-f]{7,40}$/i — see validate.ts)
 *     checkpoint.evidence.candidateTreeSha   (string, same pattern)
 *
 * They are declared on `TaskCheckpoint['evidence']` in types.ts and shape-checked by
 * `parseCheckpoint` in validate.ts. `evidence.notes` is FREE PROSE and is never a source of
 * candidate identity — a head SHA mentioned there carries no weight whatsoever.
 *
 * ── WHERE THIS RUNS ──────────────────────────────────────────────────────────────────────
 * Inside `appendCheckpoint`, BEFORE any mutation: no revision bump, no state change, no
 * checkpoint append, no audit entry, no lease change. A rejected submission leaves the
 * registry byte-identical, so the Builder still holds its lease and can simply resubmit a
 * complete checkpoint.
 *
 * `progress` (and `blocked`/`failed`/`released`) checkpoints are deliberately UNAFFECTED:
 * they make no claim about a candidate, so requiring one would block honest interim
 * reporting. Only the two HANDOFF outcomes assert "there is a candidate to verify/integrate".
 */

/** Outcomes that ASSERT a candidate exists, and therefore must carry structured identity. */
export const CANDIDATE_BEARING_OUTCOMES: ReadonlySet<CheckpointOutcome> = new Set([
  'ready_for_verification',
  'verified',
]);

export function requiresCandidateEvidence(outcome: CheckpointOutcome): boolean {
  return CANDIDATE_BEARING_OUTCOMES.has(outcome);
}

function evidenceErr(message: string): RegistryResult<never> {
  return { ok: false, code: 'verification_incomplete', message };
}

/**
 * Does the prose notes field appear to be smuggling a candidate identity?
 *
 * This is the EXACT TASK-002 shape: structured fields absent, `notes` carrying
 * `candidateHeadSha=<sha>`. Detecting it lets the error say what the submitter actually did
 * wrong instead of a generic "missing field" — the difference between a gate that teaches
 * and a gate that merely blocks.
 */
const PROSE_CANDIDATE_RE = /candidate(head|tree)sha\s*[=:]\s*[0-9a-f]{7,40}/i;

export function notesClaimCandidate(notes: string): boolean {
  return PROSE_CANDIDATE_RE.test(notes ?? '');
}

/**
 * Validate a candidate-bearing checkpoint BEFORE it is written.
 *
 * Enforced, in order:
 *  1. structured `candidateHeadSha` AND `candidateTreeSha` present and well-formed
 *     (shape already guaranteed by parseCheckpoint; here we reject ABSENT/EMPTY)
 *  2. prose-only evidence rejected explicitly, naming the real problem
 *  3. every BLOCKING commandResult headSha equals candidateHeadSha
 *  4. no MIXED evidence — a commandResult head that disagrees is a contradiction, not a warning
 *  5. Verifier candidate head/tree equals the applicable Builder checkpoint's
 *  6. Builder and Verifier actors distinct unless the task explicitly permits otherwise
 */
export function validateCandidateBearingCheckpoint(opts: {
  task: TaskRecord;
  checkpoint: TaskCheckpoint;
  /** The actor the registry will stamp on this checkpoint (lease owner). */
  actor: string;
}): RegistryResult<true> {
  const { task, checkpoint: cp } = opts;
  if (!requiresCandidateEvidence(cp.outcome)) return { ok: true, value: true };

  const head = cp.evidence.candidateHeadSha?.trim().toLowerCase() ?? '';
  const tree = cp.evidence.candidateTreeSha?.trim().toLowerCase() ?? '';

  // ── 1 + 2. Structured identity is MANDATORY; prose is never a substitute ───────────────
  if (!hasStructuredCandidate(cp)) {
    const prose = notesClaimCandidate(cp.evidence.notes);
    const missing = [
      !head ? 'evidence.candidateHeadSha' : null,
      !tree ? 'evidence.candidateTreeSha' : null,
    ]
      .filter(Boolean)
      .join(' + ');
    return evidenceErr(
      prose
        ? `checkpoint outcome ${cp.outcome} carries candidate identity ONLY in evidence.notes prose — ` +
            `set the structured fields ${missing}. Prose in notes is never read as evidence.`
        : `checkpoint outcome ${cp.outcome} requires structured candidate evidence — missing ${missing}`,
    );
  }

  // ── 3 + 4. Command results must agree with the declared candidate ──────────────────────
  // A blocking command that ran at a DIFFERENT head proves the wrong artifact was tested;
  // a blocking command with NO head proves nothing about which artifact was tested at all.
  const specs = requiredCommandsForProfiles(task.verificationProfile);
  const blocking = new Set(specs.filter((s) => s.required && s.blocking).map((s) => s.command));
  const results = cp.evidence.commandResults ?? [];

  for (const r of results) {
    if (!blocking.has(r.command)) continue;
    const rHead = r.headSha?.trim().toLowerCase() ?? '';
    if (!rHead) {
      return evidenceErr(
        `blocking command "${r.command}" has no headSha — cannot prove it ran at candidate ${head.slice(0, 12)}`,
      );
    }
    if (rHead !== head) {
      return evidenceErr(
        `blocking command "${r.command}" ran at head ${rHead.slice(0, 12)} but candidateHeadSha is ${head.slice(0, 12)}`,
      );
    }
  }

  // MIXED evidence across ALL results (not just blocking ones): a checkpoint that declares
  // one candidate while any recorded command names another is internally inconsistent.
  const otherHeads = [
    ...new Set(
      results
        .map((r) => r.headSha?.trim().toLowerCase())
        .filter((h): h is string => !!h && h !== head),
    ),
  ];
  if (otherHeads.length > 0) {
    return evidenceErr(
      `mixed candidate evidence — commandResults head(s) ${otherHeads
        .map((h) => h.slice(0, 12))
        .join(', ')} disagree with candidateHeadSha ${head.slice(0, 12)}`,
    );
  }

  // ── 5 + 6. A Verifier must verify THE Builder's candidate, and must not be the Builder ──
  if (cp.outcome === 'verified') {
    const builderCp = findApplicableBuilderCheckpoint(task);
    if (!builderCp) {
      return evidenceErr(
        'verified checkpoint has no preceding builder ready_for_verification checkpoint to verify',
      );
    }
    const bHead = builderCp.evidence.candidateHeadSha?.trim().toLowerCase() ?? '';
    const bTree = builderCp.evidence.candidateTreeSha?.trim().toLowerCase() ?? '';
    if (!bHead || !bTree) {
      return evidenceErr(
        `builder checkpoint ${builderCp.id} lacks structured candidate evidence — cannot verify against it`,
      );
    }
    if (bHead !== head) {
      return evidenceErr(
        `verifier candidateHeadSha ${head.slice(0, 12)} !== builder ${builderCp.id} candidate ${bHead.slice(0, 12)}`,
      );
    }
    if (bTree !== tree) {
      return evidenceErr(
        `verifier candidateTreeSha ${tree.slice(0, 12)} !== builder ${builderCp.id} tree ${bTree.slice(0, 12)}`,
      );
    }
    if (builderCp.actor === opts.actor && !task.allowSameAgentVerification) {
      return {
        ok: false,
        code: 'self_verification_forbidden',
        message: `verifier ${opts.actor} is the same actor as builder of ${builderCp.id}`,
      };
    }
  }

  return { ok: true, value: true };
}

/** Latest builder ready_for_verification checkpoint — the one a new `verified` answers. */
export function findApplicableBuilderCheckpoint(task: TaskRecord): TaskCheckpoint | null {
  for (let i = task.checkpoints.length - 1; i >= 0; i--) {
    const cp = task.checkpoints[i];
    if (cp.role === 'builder' && cp.outcome === 'ready_for_verification') return cp;
  }
  return null;
}
