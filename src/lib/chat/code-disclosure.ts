/**
 * Industry-code disclosure for Ask Mindy (ported from fix/ask-mindy-release-hardening, 2026-11-14).
 *
 * When Mindy (not the customer) chose the NAICS codes a search was limited to, the customer is told
 * which codes and that work filed under other codes is not included.
 *
 * Evidence rules, tighter than the original:
 *  - Only tools whose `naics` is a strict record filter (STRICT_NAICS_FILTER_TOOLS) can say "results
 *    are limited to these codes". A keyword tool also matches by words, so the line would be false
 *    there (acceptance R6).
 *  - The codes come from the tool's own `_meta.applied_filters.naics` in a SUCCESSFUL result — what was
 *    actually applied — never from the planner's arguments. A tool that dropped or rewrote a code is
 *    therefore described by what it did.
 *  - Codes the customer typed are not "chosen by Mindy" and are not listed.
 */
export const STRICT_NAICS_FILTER_TOOLS: ReadonlySet<string> = new Set([
  'get_expiring_contracts', 'search_past_contracts', 'get_buying_offices', 'get_vehicle_spend_mix',
]);

function codesOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return raw.map((x) => String(x).trim()).filter((c) => /^\d{2,6}$/.test(c));
}

export function inferredCodeDisclosure(
  executed: Array<{ name: string; status: string; content: string }>,
  typedCodes: string[],
  titleOf: (code: string) => string | null,
): string | null {
  const codes: string[] = [];
  for (const r of executed) {
    if (r.status !== 'success' || !STRICT_NAICS_FILTER_TOOLS.has(r.name)) continue;
    let applied: unknown;
    try {
      const parsed = JSON.parse(r.content || '{}') as { _meta?: { applied_filters?: { naics?: unknown } } };
      applied = parsed?._meta?.applied_filters?.naics;
    } catch { continue; }
    for (const c of codesOf(applied)) if (!codes.includes(c)) codes.push(c);
  }
  const chosen = codes.filter((c) => !typedCodes.includes(c));
  if (!chosen.length) return null;
  const items = chosen.map((c) => {
    const t = titleOf(c);
    return t ? `${c} ${t}` : c.length < 6 ? `${c} (all codes starting ${c})` : c;
  });
  return `Industry codes chosen by Mindy for the work you described (you did not give ${typedCodes.length ? 'these' : 'any'}): ${items.join('; ')}. Results are limited to these codes, so work filed under other codes is not included`;
}
