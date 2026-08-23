/**
 * PRODUCT SURFACE REGISTRY — the source of truth for "can Mindy observe this feature?"
 *
 * Eric, 2026-08-23, after the classifier fix exposed that `opportunity_map` (7,546 views /
 * 611 users) had been invisible to feature analytics for its entire life:
 *
 *   "The issue isn't that Mindy needs richer claim objects everywhere. The issue is that you
 *    still don't know whether five real product surfaces are being used at all… Today those
 *    last two can collapse into the same `0`, which recreates the exact integrity problem
 *    you've spent all this time eliminating."
 *
 * THREE STATES THAT MUST NEVER COLLAPSE:
 *   measured_used    instrumented, and we observe real usage
 *   measured_unused  instrumented correctly, genuinely 0 users — a PRODUCT fact
 *   not_measured     no valid emitter — a MEASUREMENT fact. A 0 here means "we cannot see
 *                    it", never "nobody uses it"
 *
 * WHY THIS EXISTS AT ALL (INT-004 at its source): one emitter called the map `opportunity_map`
 * while feature analytics looked for `metadata.path` containing `opportunity-map`. Nothing
 * errored; the biggest surface in the product simply never appeared. A shared vocabulary,
 * declared once, is what prevents that.
 *
 * ⚠️ `lastVerified` counts are MEASURED against the live DB, never typed from memory. They are
 * a snapshot for review, not a live figure — the live figure comes from
 * `scripts/audit-instrumentation.mjs`, which re-derives everything from `user_engagement`.
 */

export type SurfaceState = 'measured_used' | 'measured_unused' | 'not_measured';

export interface ProductSurface {
  /** The canonical vocabulary token. Emitters MUST use exactly this. */
  id: string;
  display: string;
  /** Where the token appears in user_engagement. */
  emittedAs: Array<'metadata.surface' | 'metadata.panel' | 'event_source'>;
  /** What behaviour proves the feature is genuinely being USED — not merely opened. */
  provesUse: string;
  state: SurfaceState;
  /** Why, when not measured. Required — an undocumented blind spot is the bug. */
  reason?: string;
  /** Snapshot from the last live measurement (2026-08-23). */
  lastVerified?: { events: number; users: number; on: string };
}

export const PRODUCT_SURFACES: ProductSurface[] = [
  // ── measured + used ───────────────────────────────────────────────────────
  { id: 'opportunity_map', display: 'Opportunity Map', emittedAs: ['metadata.surface', 'event_source'],
    provesUse: 'map_view / cards_shown, then a pin or listing open',
    state: 'measured_used', lastVerified: { events: 17976, users: 22, on: '2026-08-23' } },
  { id: 'alerts', display: 'Daily Alerts', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'panel open + an opportunity opened from the list',
    state: 'measured_used', lastVerified: { events: 5725, users: 96, on: '2026-08-23' } },
  { id: 'dashboard', display: "Today's Intel", emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'panel open', state: 'measured_used', lastVerified: { events: 10992, users: 18, on: '2026-08-23' } },
  { id: 'research', display: 'Market Research', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a research run completing — opening the panel is not use',
    state: 'measured_used', lastVerified: { events: 3014, users: 48, on: '2026-08-23' } },
  { id: 'vault', display: 'Profile Vault', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a vault record created or edited',
    state: 'measured_used', lastVerified: { events: 1901, users: 123, on: '2026-08-23' } },
  { id: 'settings', display: 'Settings', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a saved change', state: 'measured_used', lastVerified: { events: 4891, users: 79, on: '2026-08-23' } },
  { id: 'pipeline', display: 'My Pursuits', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a pursuit added or advanced a stage',
    state: 'measured_used', lastVerified: { events: 5347, users: 38, on: '2026-08-23' } },
  { id: 'contacts', display: 'Contacts / CRM', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a contact opened or exported', state: 'measured_used', lastVerified: { events: 411, users: 40, on: '2026-08-23' } },
  { id: 'forecasts', display: 'Forecasts', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a forecast opened', state: 'measured_used', lastVerified: { events: 1893, users: 43, on: '2026-08-23' } },
  { id: 'recompetes', display: 'Recompetes', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'an expiring contract opened', state: 'measured_used', lastVerified: { events: 1690, users: 57, on: '2026-08-23' } },
  { id: 'contractors', display: 'Contractor Database', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a contractor profile opened', state: 'measured_used', lastVerified: { events: 1187, users: 97, on: '2026-08-23' } },
  { id: 'sbir', display: 'SBIR / STTR', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a solicitation opened', state: 'measured_used', lastVerified: { events: 246, users: 39, on: '2026-08-23' } },
  { id: 'grants', display: 'Grants', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a grant opened', state: 'measured_used', lastVerified: { events: 701, users: 53, on: '2026-08-23' } },
  { id: 'planner', display: 'Action Planner', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'a task completed', state: 'measured_used', lastVerified: { events: 111, users: 22, on: '2026-08-23' } },
  { id: 'content', display: 'Content Reaper', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'content generated', state: 'measured_used', lastVerified: { events: 124, users: 23, on: '2026-08-23' } },
  { id: 'market_intel', display: 'Market Intelligence', emittedAs: ['metadata.surface', 'event_source'],
    provesUse: 'a briefing opened', state: 'measured_used', lastVerified: { events: 518, users: 121, on: '2026-08-23' } },
  { id: 'proposal', display: 'Proposal Assist', emittedAs: ['metadata.surface', 'metadata.panel'],
    provesUse: 'opened → section_drafted → exported (opening alone is NOT use)',
    state: 'measured_used', lastVerified: { events: 72, users: 8, on: '2026-08-23' } },

  // ── NOT MEASURED — the routes exist and emit nothing ──────────────────────
  // Measured 2026-08-23: 0 events under metadata.surface, metadata.panel AND event_source.
  // These are the five blind spots. Their 0 in Feature Usage means "we cannot observe it".
  { id: 'market-assassin', display: 'Federal Market Assassin', emittedAs: [],
    provesUse: 'a report generated (not merely the form opened)',
    state: 'not_measured', reason: 'standalone route src/app/market-assassin emits no engagement events' },
  { id: 'content-generator', display: 'Content Generator (standalone)', emittedAs: [],
    provesUse: 'posts generated / exported',
    state: 'not_measured', reason: 'standalone route emits no engagement events' },
  { id: 'opportunity-hunter', display: 'Opportunity Hunter', emittedAs: [],
    provesUse: 'a search run, then an agency opened',
    state: 'not_measured', reason: 'standalone route emits no engagement events' },
  { id: 'bd-assist', display: 'BD Assist', emittedAs: [],
    provesUse: 'a market scan completed',
    state: 'not_measured', reason: 'standalone route emits no engagement events' },
  { id: 'contractor-database', display: 'Contractor DB (standalone)', emittedAs: [],
    provesUse: 'a contractor opened or exported',
    state: 'not_measured', reason: 'standalone route emits no engagement events' },
];

export interface InstrumentationCoverage {
  expected: number;
  measuredUsed: number;
  measuredUnused: number;
  notMeasured: number;
  notMeasuredIds: string[];
  /** The line Mission Control should render ABOVE any usage figure. */
  caveat: string;
}

/**
 * Coverage, derived from the registry — never hand-entered.
 *
 * The `caveat` exists because a usage conclusion that silently excludes unmeasurable surfaces
 * is the same error as a population count over a truncated read.
 */
export function instrumentationCoverage(surfaces: ProductSurface[] = PRODUCT_SURFACES): InstrumentationCoverage {
  const measuredUsed = surfaces.filter((s) => s.state === 'measured_used').length;
  const measuredUnused = surfaces.filter((s) => s.state === 'measured_unused').length;
  const notMeasured = surfaces.filter((s) => s.state === 'not_measured');
  const measurable = measuredUsed + measuredUnused;
  return {
    expected: surfaces.length,
    measuredUsed,
    measuredUnused,
    notMeasured: notMeasured.length,
    notMeasuredIds: notMeasured.map((s) => s.id),
    caveat: notMeasured.length === 0
      ? `All ${surfaces.length} first-class product surfaces are measurable.`
      : `${measurable} of ${surfaces.length} first-class product surfaces are currently measurable. `
        + `${notMeasured.length} have insufficient instrumentation — usage conclusions exclude them, `
        + `and a 0 for those means "not observable", not "unused".`,
  };
}

/** A surface's canonical id, so emitters and classifiers cannot drift apart (INT-004). */
export function surfaceById(id: string): ProductSurface | undefined {
  return PRODUCT_SURFACES.find((s) => s.id === id);
}
