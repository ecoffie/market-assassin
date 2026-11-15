/**
 * Bounded tool results for the Ask Mindy answer model (B2).
 *
 * Why: a tool result went into the answer call verbatim. One oversized result (an
 * expiring-contracts page with full descriptions) pushed a turn past the model's context
 * window and the customer got a provider error instead of an answer.
 *
 * Contract:
 *  - The FULL result is still what the deterministic record renderers read. Only the copy the
 *    model sees is bounded, so the verified record list on screen never loses a record.
 *  - Shortening is structural, never a blind byte cut while the result is JSON: long free-text
 *    strings are clipped first, then the largest lists keep their FIRST items (tool results are
 *    already ranked). Every shortened list is reported as { path, shown, total } so the model
 *    can say "10 of 240", never "these are all the results".
 *  - Provenance is never trimmed: keys in PROTECTED_KEYS (sources, citations, _meta, as-of
 *    dates, evidence classes, coverage notes) keep every element and full text.
 *  - A non-JSON result that is still too large is cut with an explicit marker.
 */

export const DEFAULT_TURN_BUDGET_CHARS = 60_000;   // ~15K tokens of tool evidence per turn
export const MIN_PER_RESULT_CHARS = 4_000;
export const LONG_STRING_CHARS = 500;

const PROTECTED_KEYS = new Set([
  '_meta', 'meta', 'sources', 'source', 'citations', 'citation', 'provenance', 'evidence',
  'evidence_class', 'evidence_classification', 'classification', 'as_of', 'data_as_of',
  'coverage', 'coverage_note', 'caveats', 'warnings', 'notes', 'note', 'url', 'source_url',
  'error_category', 'message', 'state', 'ok', '_truncation',
]);

export interface TruncatedList { path: string; shown: number; total: number }

export interface BoundedToolResult {
  content: string;
  truncated: boolean;
  originalChars: number;
  lists: TruncatedList[];
  clippedStrings: number;
}

export const TRUNCATION_NOTE =
  'This result was shortened to fit. Each list in `lists` shows only its first `shown` of `total` items. '
  + 'Do not describe the shown items as all of the results; state how many were shown out of how many. '
  + 'Do not infer anything about items that are not shown.';

/** Per-result character cap for a turn with `count` tool results. */
export function perResultBudget(count: number, turnBudget = DEFAULT_TURN_BUDGET_CHARS): number {
  if (count <= 0) return turnBudget;
  return Math.max(MIN_PER_RESULT_CHARS, Math.floor(turnBudget / count));
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function size(v: unknown): number {
  try { return JSON.stringify(v)?.length ?? 0; } catch { return 0; }
}

function clipStrings(v: Json, protectedPath: boolean, counter: { n: number }): Json {
  if (typeof v === 'string') {
    if (protectedPath || v.length <= LONG_STRING_CHARS) return v;
    counter.n++;
    return `${v.slice(0, LONG_STRING_CHARS)}… [+${v.length - LONG_STRING_CHARS} chars not shown]`;
  }
  if (Array.isArray(v)) return v.map((x) => clipStrings(x, protectedPath, counter));
  if (v && typeof v === 'object') {
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) out[k] = clipStrings(x, protectedPath || PROTECTED_KEYS.has(k), counter);
    return out;
  }
  return v;
}

/** Every trimmable array (not under a protected key), with its path and parent reference. */
// Never trimmed even as a last resort: the machine-readable result meta and our own report.
const NEVER_TRIM = new Set(['_meta', 'meta', '_truncation']);

function findArrays(v: Json, path: string, acc: Array<{ path: string; arr: Json[] }>, includeProtected = false) {
  if (Array.isArray(v)) {
    acc.push({ path: path || '$', arr: v });
    v.forEach((x, i) => findArrays(x, `${path || '$'}[${i}]`, acc, includeProtected));
    return;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (NEVER_TRIM.has(k) || (!includeProtected && PROTECTED_KEYS.has(k))) continue;
      findArrays(x, path ? `${path}.${k}` : k, acc, includeProtected);
    }
  }
}

function hardCut(content: string, maxChars: number): BoundedToolResult {
  const marker = `\n[RESULT SHORTENED: showing the first ${Math.max(0, maxChars - 200)} of ${content.length} characters. The rest is not visible; do not treat this result as complete.]`;
  return {
    content: content.slice(0, Math.max(0, maxChars - 200)) + marker,
    truncated: true, originalChars: content.length, lists: [], clippedStrings: 0,
  };
}

export function boundToolResult(content: string, maxChars: number): BoundedToolResult {
  const originalChars = content.length;
  if (originalChars <= maxChars) return { content, truncated: false, originalChars, lists: [], clippedStrings: 0 };

  let parsed: Json;
  try { parsed = JSON.parse(content) as Json; } catch { return hardCut(content, maxChars); }
  if (parsed === null || typeof parsed !== 'object') return hardCut(content, maxChars);

  // Root arrays are wrapped so the truncation report has somewhere to live.
  let root: { [k: string]: Json } = Array.isArray(parsed) ? { items: parsed } : { ...parsed };
  const counter = { n: 0 };
  root = clipStrings(root, false, counter) as { [k: string]: Json };

  // Original totals per path, so repeated halving reports the true total, not the last length.
  const totals = new Map<string, number>();
  const reserve = 700; // room for the _truncation block itself
  // Pass 1 trims ordinary lists only. Pass 2 (last resort, before any blind cut) may also trim
  // provenance lists such as sources — still first-N with a shown-of-total report.
  let includeProtected = false;
  for (let guard = 0; guard < 400 && size(root) + reserve > maxChars; guard++) {
    const arrays: Array<{ path: string; arr: Json[] }> = [];
    findArrays(root, '', arrays, includeProtected);
    const candidates = arrays.filter((a) => a.arr.length > 1).sort((a, b) => size(b.arr) - size(a.arr));
    const target = candidates[0];
    if (!target) {
      if (includeProtected) break;
      includeProtected = true;
      continue;
    }
    if (!totals.has(target.path)) totals.set(target.path, target.arr.length);
    target.arr.splice(Math.max(1, Math.floor(target.arr.length / 2)));
  }

  const lists: TruncatedList[] = [];
  if (totals.size) {
    const arrays: Array<{ path: string; arr: Json[] }> = [];
    findArrays(root, '', arrays, true);
    for (const [path, total] of totals) {
      const now = arrays.find((a) => a.path === path);
      if (now) lists.push({ path, shown: now.arr.length, total });
    }
  }
  root._truncation = {
    note: TRUNCATION_NOTE,
    original_chars: originalChars,
    lists: lists.map((l) => ({ path: l.path, shown: l.shown, total: l.total })),
    clipped_text_fields: counter.n,
  };
  const out = JSON.stringify(root);
  if (out.length > maxChars) {
    // Structural shortening could not get under the cap (e.g. one huge protected block).
    const cut = hardCut(out, maxChars);
    return { ...cut, originalChars, lists, clippedStrings: counter.n };
  }
  return { content: out, truncated: true, originalChars, lists, clippedStrings: counter.n };
}
