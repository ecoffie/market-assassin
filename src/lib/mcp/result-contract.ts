/**
 * Shared tool result contract (Ask Mindy Phase 1, P1-1).
 *
 * The defect this closes: a tool used to return the same `grounded:false, count:0` for
 * "verified: nothing matches" and for "your filter could not be applied" (an array dropped by
 * a `typeof === 'string'` guard, an unknown argument, an unrecognized state name). A model, or a
 * person, reads both as "none". Every tool result that passes through `runMcpTool` now carries:
 *
 *   _meta.result_state  — what the result means, from the tool's own signals:
 *       'results'            rows returned, every argument applied
 *       'none_found'         the query ran with every argument applied and matched nothing (a verified zero)
 *       'filter_not_applied' at least one argument was not applied and nothing was returned
 *       'partial'            rows returned, but at least one argument was not applied, or the
 *                            tool reports its result is incomplete
 *       'unavailable'        the source errored (degraded) — NOT a zero
 *       'not_reported'       the tool reports neither grounded nor degraded; nothing is inferred
 *   _meta.ignored_args  — every argument that did not shape the query, with a reason. Never silent.
 *
 * Tools may set `result_state`, `ignored_args`, `applied_filters`, `as_of`, `lag_note` and
 * `incomplete_reason` themselves (they know their own semantics best); this module merges the
 * schema-level findings on top and only derives `result_state` when the tool did not set one.
 * Additive only: no existing field is renamed or removed.
 */

export type ResultState =
  | 'results'
  | 'none_found'
  | 'filter_not_applied'
  | 'partial'
  | 'unavailable'
  | 'not_reported';

export const RESULT_STATES: readonly ResultState[] = [
  'results', 'none_found', 'filter_not_applied', 'partial', 'unavailable', 'not_reported',
];

export type IgnoredReason =
  | 'unknown_argument'   // not a parameter of this tool
  | 'wrong_type'         // e.g. an array where the tool only reads a string
  | 'invalid_value'      // not one of the schema enum values / not recognizable
  | 'unsupported_value'; // recognized, but this tool/source cannot filter on it

export interface IgnoredArg {
  arg: string;
  /** Short display of the value (truncated). Never used to re-run anything. */
  value: string;
  reason: IgnoredReason;
  detail?: string;
}

export interface ResultContractMeta {
  result_state: ResultState;
  ignored_args: IgnoredArg[];
  applied_filters?: Record<string, unknown>;
  as_of?: string | null;
  lag_note?: string;
  incomplete_reason?: string;
}

type JsonSchemaProp = { type?: string | string[]; enum?: unknown[]; items?: { type?: string } };
type JsonSchemaParams = { properties?: Record<string, JsonSchemaProp> };

/** Arguments the runtime itself adds or strips; never reported as ignored. */
const RUNTIME_ARGS = new Set(['confirm']);

function displayValue(v: unknown): string {
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number':
    case 'integer': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    default: return true; // unknown schema type: do not claim a mismatch
  }
}

/**
 * Compare call arguments to the tool's declared JSON schema. Reports arguments the dispatcher
 * cannot have applied: names that are not parameters, values of the wrong JSON type, and values
 * outside a declared enum. Null/undefined values are treated as "not provided".
 */
export function schemaArgIssues(
  args: Record<string, unknown> | null | undefined,
  parameters: JsonSchemaParams | null | undefined,
  applied: ReadonlySet<string> = new Set(),
): IgnoredArg[] {
  const out: IgnoredArg[] = [];
  if (!args || typeof args !== 'object') return out;
  const props = parameters?.properties;
  if (!props) return out; // no schema to compare against: report nothing rather than guess
  for (const [arg, value] of Object.entries(args)) {
    if (value === undefined || value === null || RUNTIME_ARGS.has(arg)) continue;
    const prop = props[arg];
    if (!prop) {
      out.push({ arg, value: displayValue(value), reason: 'unknown_argument', detail: 'not a parameter of this tool' });
      continue;
    }
    const types = Array.isArray(prop.type) ? prop.type : prop.type ? [prop.type] : [];
    if (types.length && !types.some((t) => typeMatches(value, t))) {
      out.push({ arg, value: displayValue(value), reason: 'wrong_type', detail: `expected ${types.join(' or ')}` });
      continue;
    }
    if (Array.isArray(prop.enum) && prop.enum.length && typeof value !== 'object' && !prop.enum.includes(value)
      && !applied.has(arg)) {
      out.push({ arg, value: displayValue(value), reason: 'invalid_value', detail: `allowed: ${prop.enum.join(', ')}` });
    }
  }
  return out;
}

/** Names of arguments the tool itself reports as applied (either contract shape). */
function appliedNames(result: Record<string, unknown>, meta: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const metaApplied = meta.applied_filters;
  if (metaApplied && typeof metaApplied === 'object' && !Array.isArray(metaApplied)) {
    for (const k of Object.keys(metaApplied)) names.add(k);
  }
  // Pre-existing top-level shape (vehicle task-order search): [{ filter, value }].
  const top = result.applied_filters;
  if (Array.isArray(top)) {
    for (const f of top) {
      if (f && typeof f === 'object' && typeof (f as { filter?: unknown }).filter === 'string') {
        names.add((f as { filter: string }).filter);
      }
    }
  }
  return names;
}

function isIgnoredArg(x: unknown): x is IgnoredArg {
  return !!x && typeof x === 'object' && typeof (x as IgnoredArg).arg === 'string' && typeof (x as IgnoredArg).reason === 'string';
}

/**
 * Derive the state from the tool's own signals. Never upgrades an error to a zero, and never
 * calls a result complete when an argument was dropped.
 */
export function deriveResultState(meta: {
  grounded?: unknown;
  degraded?: unknown;
  ignoredCount: number;
  incomplete?: boolean;
}): ResultState {
  if (meta.degraded === true) return 'unavailable';
  const grounded = meta.grounded;
  if (grounded !== true && grounded !== false) return 'not_reported';
  if (grounded) return meta.ignoredCount > 0 || meta.incomplete ? 'partial' : 'results';
  return meta.ignoredCount > 0 ? 'filter_not_applied' : 'none_found';
}

/**
 * Attach the contract to a tool result (mutates and returns it). Non-object results are
 * returned unchanged. A tool-set `result_state` is kept unless it contradicts a dropped argument
 * (a tool cannot claim a verified zero when an argument it was given was not applied).
 */
export function annotateResultContract<T>(
  result: T,
  args: Record<string, unknown> | null | undefined,
  parameters: JsonSchemaParams | null | undefined,
): T {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const r = result as unknown as Record<string, unknown>;
  const existing = r._meta;
  const meta: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};

  const applied = appliedNames(r, meta);
  const toolIgnored = Array.isArray(meta.ignored_args) ? meta.ignored_args.filter(isIgnoredArg) : [];
  const schemaIgnored = schemaArgIssues(args, parameters, applied).filter(
    // The tool coerced it (e.g. accepted an array for a string field) and says so.
    (i) => !(i.reason === 'wrong_type' && applied.has(i.arg)),
  );
  const seen = new Set(toolIgnored.map((i) => i.arg));
  const ignored = [...toolIgnored, ...schemaIgnored.filter((i) => !seen.has(i.arg))];

  // Mirror the billing/outcome classifier (call-outcome.ts) so the contract never disagrees with it:
  //  - billable_candidate: candidates came back but are not corroborated (grounded=false there
  //    means "not corroborated", not "nothing came back") -> results exist, flagged incomplete;
  //  - Tier-1/Tier-2 tools carry no _meta.grounded but return a structured `count`.
  let grounded: unknown = meta.grounded;
  let incompleteReason = typeof meta.incomplete_reason === 'string' && meta.incomplete_reason ? meta.incomplete_reason : '';
  if (meta.billing_outcome === 'billable_candidate') {
    grounded = true;
    if (!incompleteReason) incompleteReason = 'candidates returned but not corroborated';
  } else if (typeof grounded !== 'boolean' && typeof r.count === 'number' && Number.isFinite(r.count)) {
    grounded = r.count > 0;
  }
  const incomplete = incompleteReason.length > 0;
  const derived = deriveResultState({ grounded, degraded: meta.degraded, ignoredCount: ignored.length, incomplete });
  const toolState = RESULT_STATES.includes(meta.result_state as ResultState) ? (meta.result_state as ResultState) : null;
  let state: ResultState = toolState ?? derived;
  if (ignored.length > 0 && (state === 'none_found' || state === 'results')) {
    state = state === 'none_found' ? 'filter_not_applied' : 'partial';
  }

  r._meta = { ...meta, result_state: state, ignored_args: ignored, ...(incompleteReason && !meta.incomplete_reason ? { incomplete_reason: incompleteReason } : {}) };
  return result;
}

/** True only for a verified zero: the query ran, every argument applied, nothing matched. */
export function isVerifiedNone(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Partial<ResultContractMeta>;
  return m.result_state === 'none_found' && Array.isArray(m.ignored_args) && m.ignored_args.length === 0;
}
