/**
 * Client-workspace caps for My Clients (Coach Mode). ENFORCED by src/lib/mindy/coach-access.ts (maxClients), and the
 * one source for any customer-visible "up to N client workspaces" (Eric, 2026-11-27: no hand-typed numbers).
 * Client-safe: no server imports.
 */
export const COACH_CLIENT_LIMITS = {
  /** Teams seat — the serious consultant tier. */
  team: 5,
  /** Grandfathered Pro org members keep the historical cap (predate the add-on). */
  grandfather: 10,
  /** Pro + Coach Mode add-on ($99/mo) — a small book of clients; upgrade to Teams for more. */
  coachAddon: 3,
} as const;
