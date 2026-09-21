/**
 * MRR Block 4 — the grounding renderer (the legal spine).
 *
 * EVERY field reaches the document through `renderField`. Nothing else may write
 * a fact. The renderer is what makes the four states VISIBLY different on the
 * page, and what makes an unsourced value impossible to ship:
 *
 *   value      → the formatted value                 + appendix entry
 *   true_zero  → "Recorded: 0 — <label>"             + appendix entry
 *   unknown    → "Unknown / Insufficient evidence…"  + attempted queries
 *   degraded   → "Degraded — <reason>"               + all evidence + conflict
 *
 * A `value` or `true_zero` lacking complete evidence THROWS. That is deliberate:
 * a build that fails is recoverable, a signed document asserting an unsourced
 * number is not.
 *
 * Spec: WEEKEND.md "Grounding model" + Block 4; mrw-phase1-dev-spec.md §3.
 */
import type { EvidenceRef, GroundedField } from './types';

export class AssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblyError';
  }
}

/** A rendered cell: the document text plus the appendix rows it generated. */
export interface RenderedCell {
  /** The exact string that goes into the Word document. */
  text: string;
  /** Which state produced it — drives QA and the appendix grouping. */
  state: GroundedField<unknown>['state'];
  /** Evidence backing this cell (empty for `unknown` with no attempts). */
  evidence: EvidenceRef[];
  /** Present for `unknown`/`degraded`: why. */
  reason?: string;
  /** Stable label identifying the field, e.g. "§5 Primary NAICS". */
  label: string;
}

export const UNKNOWN_PREFIX = 'Unknown / Insufficient evidence';
export const DEGRADED_PREFIX = 'Degraded';

function isCompleteEvidence(e: EvidenceRef | undefined): e is EvidenceRef {
  return !!e && typeof e.source === 'string' && e.source.trim() !== ''
    && typeof e.retrievedAt === 'string' && e.retrievedAt.trim() !== ''
    && !!e.query && typeof e.query === 'object';
}

/** Assert evidence completeness or throw with the offending field named. */
function requireEvidence(label: string, e: EvidenceRef | undefined): EvidenceRef {
  if (!e) throw new AssemblyError(`value without provenance: ${label} has no evidence`);
  if (typeof e.source !== 'string' || e.source.trim() === '') {
    throw new AssemblyError(`value without provenance: ${label} has no source`);
  }
  if (typeof e.retrievedAt !== 'string' || e.retrievedAt.trim() === '') {
    throw new AssemblyError(`value without provenance: ${label} has no retrieval time`);
  }
  if (!e.query || typeof e.query !== 'object') {
    throw new AssemblyError(`value without provenance: ${label} has no query record`);
  }
  return e;
}

/**
 * The one function every field passes through.
 * @param label stable field identity used in the document and the appendix
 * @param field the grounded field
 * @param format value → display string (defaults to String())
 */
export function renderField<T>(
  label: string,
  field: GroundedField<T>,
  format: (v: T) => string = (v) => String(v),
): RenderedCell {
  switch (field.state) {
    case 'value': {
      const evidence = requireEvidence(label, field.evidence);
      if (field.value === null || field.value === undefined || field.value === '') {
        // A "value" that carries nothing is a bug in the producer, not a fact.
        throw new AssemblyError(`empty value in state 'value': ${label}`);
      }
      return { text: format(field.value), state: 'value', evidence: [evidence], label };
    }
    case 'true_zero': {
      const evidence = requireEvidence(label, field.evidence);
      if (!field.label || field.label.trim() === '') {
        throw new AssemblyError(`true_zero without a label: ${label}`);
      }
      // A measured zero must READ as measured, so a reviewer never mistakes it
      // for a blank or a missing lookup.
      return { text: `Recorded: 0 — ${field.label}`, state: 'true_zero', evidence: [evidence], label };
    }
    case 'unknown': {
      return {
        text: `${UNKNOWN_PREFIX} — ${field.reason}`,
        state: 'unknown',
        evidence: (field.attemptedEvidence ?? []).filter(isCompleteEvidence),
        reason: field.reason,
        label,
      };
    }
    case 'degraded': {
      // A degraded field may show a partial value ONLY behind the degraded label,
      // so it can never be read as an unqualified fact.
      const partial =
        field.value !== undefined && field.value !== null && field.value !== ''
          ? ` (partial: ${format(field.value as T)})`
          : '';
      return {
        text: `${DEGRADED_PREFIX} — ${field.reason}${partial}`,
        state: 'degraded',
        evidence: (field.evidence ?? []).filter(isCompleteEvidence),
        reason: field.reason,
        label,
      };
    }
    default: {
      const never: never = field;
      throw new AssemblyError(`unhandled grounding state: ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Collects every rendered cell so the appendix is generated from the SAME
 * objects the document rendered — never reconstructed from logs afterwards.
 */
export class EvidenceCollector {
  private readonly cells: RenderedCell[] = [];

  /** Render and record in one step. Use this, not renderField, in section code. */
  render<T>(label: string, field: GroundedField<T>, format?: (v: T) => string): RenderedCell {
    const cell = renderField(label, field, format);
    this.cells.push(cell);
    return cell;
  }

  all(): RenderedCell[] {
    return [...this.cells];
  }

  /** Cells that display a safe fact — each MUST have an appendix entry. */
  sourced(): RenderedCell[] {
    return this.cells.filter((c) => c.state === 'value' || c.state === 'true_zero');
  }

  byState(state: RenderedCell['state']): RenderedCell[] {
    return this.cells.filter((c) => c.state === state);
  }

  /** QA summary for the run report. */
  summary(): Record<RenderedCell['state'], number> {
    return {
      value: this.byState('value').length,
      true_zero: this.byState('true_zero').length,
      unknown: this.byState('unknown').length,
      degraded: this.byState('degraded').length,
    };
  }
}

// ---------- helpers for building grounded fields from tool results ----------

/** Build an EvidenceRef stamped at call time. */
export function evidence(source: string, query: Record<string, unknown>, url?: string): EvidenceRef {
  return { source, retrievedAt: new Date().toISOString(), query, ...(url ? { url } : {}) };
}

/** A grounded value. */
export function value<T>(v: T, e: EvidenceRef): GroundedField<T> {
  return { state: 'value', value: v, evidence: e };
}

/** A MEASURED zero — use only when the source genuinely reported zero. */
export function trueZero(label: string, e: EvidenceRef): GroundedField<number> {
  return { state: 'true_zero', value: 0, label, evidence: e };
}

/** Missing / failed / ungrounded. */
export function unknown<T>(reason: string, attempted?: EvidenceRef[]): GroundedField<T> {
  return { state: 'unknown', reason, ...(attempted && attempted.length ? { attemptedEvidence: attempted } : {}) };
}

/** Evidence exists but conflicts or is insufficient to assert. */
export function degraded<T>(reason: string, e: EvidenceRef[], partial?: T): GroundedField<T> {
  return { state: 'degraded', reason, evidence: e, ...(partial !== undefined ? { value: partial } : {}) };
}

/**
 * Turn a thrown error into `unknown` WITH provenance of the attempt.
 * A query exception must never become an empty success.
 */
export function unknownFromError<T>(err: unknown, attempted: EvidenceRef): GroundedField<T> {
  const msg = err instanceof Error ? err.message : String(err);
  return { state: 'unknown', reason: `query failed: ${msg}`, attemptedEvidence: [attempted] };
}
