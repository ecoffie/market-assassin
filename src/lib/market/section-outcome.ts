/**
 * Explicit outcomes for a guarded report section.
 *
 * WHY (P2, 2026-09-22): `guard()` collapsed a TIMEOUT and a genuinely empty
 * result into the same downstream shape — `value: null` / zero rows — and the
 * grounding count tested only truthiness. Measured in the investigation:
 *
 *   transient timeout -> rows=0  groundedFlag=false  degraded=true
 *   genuinely empty   -> rows=0  groundedFlag=false  degraded=false
 *
 * Both scored identically, and the publishing gate never consulted `degraded`.
 * So a report that FAILED to measure a market could publish as if the market
 * were genuinely thin — at a NEW permanent share URL, because report ids are
 * random. Two identical requests could mint two different client-facing
 * artifacts with nothing on the page saying which one was complete.
 *
 * A transient upstream failure must never be indistinguishable from "the data
 * says zero".
 */

export type SectionStatus =
  /** The query succeeded and returned usable evidence. */
  | 'ok'
  /** The query succeeded and defensibly found no rows. Zero is the ANSWER. */
  | 'empty'
  /** Timeout / upstream / query failure. The answer is UNKNOWN, never zero. */
  | 'failed'
  /** Not attempted because no defensible subject existed (P0 RC-2 rule). */
  | 'withheld_no_subject';

/** Why a section failed — for diagnostics, never for customer HTML. */
export type SectionFailureKind = 'timeout' | 'upstream_error' | 'unknown';

export interface SectionOutcome<T> {
  status: SectionStatus;
  value: T | null;
  /** Present only when status==='failed'. Diagnostic detail, not customer copy. */
  failure?: { kind: SectionFailureKind; message: string };
}

/** An error that looks like a deadline/abort rather than a query defect. */
export function classifyFailure(err: unknown): SectionFailureKind {
  const name = (err as { name?: string } | null)?.name ?? '';
  const code = (err as { code?: string } | null)?.code ?? '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'CoverageDeadlineError' ||
    code === 'deadline_exceeded' ||
    /timeout|timed out|deadline|aborted/i.test(msg)
  ) {
    return 'timeout';
  }
  if (msg) return 'upstream_error';
  return 'unknown';
}

/**
 * Decide `ok` vs `empty` for a SUCCEEDED query. Emptiness is a property of the
 * returned value, so the caller supplies how to read it; the default treats an
 * empty array / null / 0 as empty.
 */
export function classifySuccess<T>(value: T | null, hasEvidence?: (v: T) => boolean): SectionStatus {
  if (value === null || value === undefined) return 'empty';
  if (hasEvidence) return hasEvidence(value) ? 'ok' : 'empty';
  if (Array.isArray(value)) return value.length > 0 ? 'ok' : 'empty';
  if (typeof value === 'number') return value > 0 ? 'ok' : 'empty';
  return 'ok';
}

/**
 * Run a section and record WHICH of the three things happened.
 * Never throws — a section failing is a reportable state, not an exception.
 */
export async function runSection<T>(
  p: Promise<T>,
  hasEvidence?: (v: T) => boolean,
): Promise<SectionOutcome<T>> {
  try {
    const value = await p;
    return { status: classifySuccess(value, hasEvidence), value };
  } catch (err) {
    const kind = classifyFailure(err);
    return {
      status: 'failed',
      value: null,
      failure: { kind, message: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
    };
  }
}

/** A section counts toward grounding ONLY when it returned usable evidence. */
export function isGrounded(o: SectionOutcome<unknown>): boolean {
  return o.status === 'ok';
}

/** A failed section is UNKNOWN — never reported as an established zero. */
export function isFailed(o: SectionOutcome<unknown>): boolean {
  return o.status === 'failed';
}
