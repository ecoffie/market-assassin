import { distinctiveKeywords } from '@/lib/market/keyword-sanitize';

export const ALERT_MODES = ['market_discovery', 'focused'] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

export const FOCUSED_REQUIRES_DISTINCTIVE =
  'Focused needs at least one distinctive keyword. Add a specific phrase, then choose Focused.';

export function parseAlertMode(raw: unknown): AlertMode | null {
  if (raw === 'market_discovery' || raw === 'focused') return raw;
  return null;
}

/** Legacy null / junk → Market Discovery. */
export function resolveAlertMode(raw: unknown): AlertMode {
  return parseAlertMode(raw) ?? 'market_discovery';
}

export function alertModeFromAggregated(agg: unknown): AlertMode {
  if (!agg || typeof agg !== 'object' || Array.isArray(agg)) return 'market_discovery';
  return resolveAlertMode((agg as Record<string, unknown>).alert_mode);
}

export function canSelectFocused(keywords: string[] | null | undefined):
  | { ok: true }
  | { ok: false; error: string } {
  if (distinctiveKeywords(keywords || []).length === 0) {
    return { ok: false, error: FOCUSED_REQUIRES_DISTINCTIVE };
  }
  return { ok: true };
}

export function defaultAlertModeForNewUser(keywords: string[] | null | undefined): AlertMode {
  return canSelectFocused(keywords).ok ? 'focused' : 'market_discovery';
}

export function mergeAlertModeIntoAggregated(
  existing: unknown,
  mode: AlertMode,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  base.alert_mode = mode;
  return base;
}
