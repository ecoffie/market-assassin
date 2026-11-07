/**
 * Argument names a tool does not declare.
 *
 * The MCP SDK validates arguments against the tool's zod object, and a plain z.object STRIPS
 * unknown keys, so `company_name` reached the handler as `{}` and the caller was told only that
 * "company or uei is required" while holding what they believed was exactly that. The transports
 * now register a loose schema, split the raw arguments here, hand the tool ONLY its declared
 * keys (what it always received), and report the rest by name.
 */
import { z, type ZodRawShape } from 'zod';

export interface UnrecognizedParam {
  name: string;
  /** The closest declared parameter, or null when nothing is plausibly close. */
  did_you_mean: string | null;
}

/** The tool's input schema with unknown keys kept, so the handler can name them. */
export function looseInputSchema(shape: ZodRawShape) {
  return z.object(shape).loose();
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Closest declared key: containment ("company_name"/"company") first, then a small typo distance. */
export function closestParam(name: string, declared: readonly string[]): string | null {
  const n = norm(name);
  if (!n) return null;
  let best: { key: string; score: number } | null = null;
  for (const key of declared) {
    const k = norm(key);
    if (!k) continue;
    const contained = k.length >= 3 && n.length >= 3 && (n.includes(k) || k.includes(n));
    const dist = editDistance(n, k);
    const longest = Math.max(n.length, k.length);
    const typoLimit = longest >= 5 ? Math.max(2, Math.floor(longest / 4)) : 1; // a swapped pair costs 2
    if (!contained && dist > typoLimit) continue;
    // A contained match always outranks a typo match; among equals the nearer spelling wins.
    const score = (contained ? 0 : 1000) + dist;
    if (!best || score < best.score) best = { key, score };
  }
  return best?.key ?? null;
}

export function partitionToolArgs(
  args: Record<string, unknown> | null | undefined,
  declared: readonly string[],
): { known: Record<string, unknown>; unrecognized: UnrecognizedParam[] } {
  const allowed = new Set(declared);
  const known: Record<string, unknown> = {};
  const unrecognized: UnrecognizedParam[] = [];
  for (const [key, value] of Object.entries(args ?? {})) {
    if (allowed.has(key)) known[key] = value;
    else unrecognized.push({ name: key, did_you_mean: closestParam(key, declared) });
  }
  return { known, unrecognized };
}

/** "Unrecognized parameter company_name. Did you mean company?" */
export function describeUnrecognized(params: readonly UnrecognizedParam[]): string {
  return params
    .map((p) => `Unrecognized parameter ${p.name}.${p.did_you_mean ? ` Did you mean ${p.did_you_mean}?` : ''}`)
    .join(' ');
}

/**
 * A call that still ran without these keys says so in `_meta`: a misspelled optional filter is
 * otherwise a silently broader search that looks like the one the caller asked for.
 */
export function annotateIgnoredParams(
  result: Record<string, unknown>,
  params: readonly UnrecognizedParam[],
): Record<string, unknown> {
  if (!params.length) return result;
  const meta = (result._meta && typeof result._meta === 'object' ? result._meta : {}) as Record<string, unknown>;
  return { ...result, _meta: { ...meta, ignored_parameters: params.map((p) => ({ ...p })) } };
}
