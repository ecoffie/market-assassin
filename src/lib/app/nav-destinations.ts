/**
 * Ask Mindy "take me to…" (Phase A of tasks/ask-mindy-operates-mindy-plan.md, Eric 2026-11-28).
 *
 * The server proposes `{ type: 'action', id, name: 'app.navigate', args: { destination } }`. The model names a
 * DESTINATION from a fixed list; it never sends a panel id, section, URL or selector. This table is the only place a
 * destination becomes a place in the app, so an unknown destination goes nowhere (the card renders nothing).
 *
 * The registry's destination enum (src/lib/chat/app-actions/registry.ts) must equal NAV_DESTINATION_KEYS; the parity
 * test fails CI if they drift.
 */
import type { AppPanel } from '@/components/app/UnifiedSidebar';

export interface NavDestination {
  panel: AppPanel;
  /** Panel context (the same channel the sidebar and deep links use), e.g. a Settings or Vault section. */
  context?: Record<string, string>;
  /** Where it is, in the app's own words. */
  label: string;
}

export const NAV_DESTINATIONS = {
  my_documents: { panel: 'vault', context: { section: 'documents' }, label: 'My Documents' },
  my_pursuits: { panel: 'pipeline', label: 'My Pursuits' },
  alert_settings: { panel: 'settings', context: { section: 'alerts' }, label: 'Settings → Alerts & matching' },
  billing: { panel: 'settings', context: { section: 'billing' }, label: 'Settings → Billing & credits' },
} as const satisfies Record<string, NavDestination>;

export type NavDestinationKey = keyof typeof NAV_DESTINATIONS;
export const NAV_DESTINATION_KEYS = Object.keys(NAV_DESTINATIONS) as NavDestinationKey[];

export interface NavAction {
  id: string;
  destination: NavDestinationKey;
  target: NavDestination;
}

/**
 * Client-side check of one stream event (the server already validated it; the client never trusts the wire).
 * Anything that is not exactly an app.navigate to a known destination returns null and renders nothing.
 */
export function parseNavAction(evt: unknown): NavAction | null {
  if (!evt || typeof evt !== 'object') return null;
  const e = evt as { type?: unknown; id?: unknown; name?: unknown; args?: unknown };
  if (e.type !== 'action' || e.name !== 'app.navigate') return null;
  if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(e.id)) return null;
  if (!e.args || typeof e.args !== 'object' || Array.isArray(e.args)) return null;
  const args = e.args as Record<string, unknown>;
  if (Object.keys(args).some((k) => k !== 'destination')) return null;
  const d = args.destination;
  if (typeof d !== 'string' || !Object.prototype.hasOwnProperty.call(NAV_DESTINATIONS, d)) return null;
  const destination = d as NavDestinationKey;
  return { id: e.id, destination, target: NAV_DESTINATIONS[destination] };
}
