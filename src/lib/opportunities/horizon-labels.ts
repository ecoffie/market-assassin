/**
 * The user-facing names of the Opportunity Map's three horizons (Mindy Learn decision 2, 2026-10-08).
 *
 *   open      → Open Now     — biddable today (SAM notices)
 *   recompete → Coming Back  — an awarded contract nearing its end (a recompete)
 *   forecast  → Coming Soon  — an agency's planned buy, not yet on SAM (a forecast)
 *
 * LABELS ONLY. The keys are the stable vocabulary of URLs (`?horizon=open,recompete,forecast`,
 * `?mode=recompete`), saved searches (`filters.horizons`), telemetry and every API. Never rename a key.
 *
 * The Map's client script (route.ts template literals, template.html) carries these as literal
 * strings because tests execute that source as text; `horizon-labels.unit.test.ts` pins that every
 * literal matches this table.
 */
export const HORIZON_LABELS = {
  open: 'Open Now',
  recompete: 'Coming Back',
  forecast: 'Coming Soon',
} as const;

export type HorizonKey = keyof typeof HORIZON_LABELS;
