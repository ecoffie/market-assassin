export type NaicsPriorityRole = 'primary' | 'secondary';

export function parseNaicsPriorities(raw: unknown): Record<string, NaicsPriorityRole> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, NaicsPriorityRole> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const code = String(key).trim();
    if (!/^\d{6}$/.test(code)) continue;
    if (value === 'primary' || value === 'secondary') out[code] = value;
  }
  return out;
}

export function prioritiesFromAggregated(agg: unknown): Record<string, NaicsPriorityRole> {
  if (!agg || typeof agg !== 'object' || Array.isArray(agg)) return {};
  return parseNaicsPriorities((agg as Record<string, unknown>).naics_priorities);
}

export function mergePrioritiesIntoAggregated(
  existing: unknown,
  priorities: Record<string, NaicsPriorityRole>,
  storedCodes?: string[],
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const allowed = storedCodes ? new Set(storedCodes.map((c) => String(c).trim())) : null;
  const cleaned: Record<string, NaicsPriorityRole> = {};
  for (const [code, role] of Object.entries(parseNaicsPriorities(priorities))) {
    if (allowed && !allowed.has(code)) continue;
    cleaned[code] = role;
  }
  base.naics_priorities = cleaned;
  return base;
}
