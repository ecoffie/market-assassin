/**
 * Mindy product design tokens (Design & Output, 2026-11-22) — the bridge from the public-site system to the
 * authenticated product. Values are REUSED from src/lib/public-site/tokens.ts; nothing new is invented here.
 *
 * Primary action colour: navy #1B3A6B (provisional, approved 2026-11-22). This file does not recolour any
 * existing surface; a component opts in by reading these values. Do not grow it into a second palette:
 * add a token only when a shared component needs it.
 */
import { MP_COLORS } from '@/lib/public-site/tokens';

export const PRODUCT_TOKENS = {
  /** Primary action: buttons, links, focus rings. */
  action: MP_COLORS.navy,
  actionHover: MP_COLORS.navyHover,
  actionWash: MP_COLORS.navyWash,
  ink: MP_COLORS.ink,
  body: MP_COLORS.body,
  muted: MP_COLORS.muted,
  surface: MP_COLORS.surface,
  line: MP_COLORS.line,
  crit: MP_COLORS.crit,
  fontSans: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

export type ProductToken = keyof typeof PRODUCT_TOKENS;
