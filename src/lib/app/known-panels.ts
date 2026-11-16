import type { AppPanel } from '@/components/app/UnifiedSidebar';

// Panels that may be deep-linked via ?panel=<id>. Keep in sync with AppPanel.
export const KNOWN_PANELS = new Set<AppPanel>([
  'map', 'watchlist', 'saved',
  'chat', 'dashboard', 'alerts', 'market-intel', 'research', 'forecasts',
  'recompetes', 'contractors', 'decision-makers', 'pipeline', 'contacts',
  'team', 'settings', 'vault', 'library', 'knowledge-base', 'coach',
  'pricing', 'proposals', 'target-list', 'grants', 'dibbs', 'partner-finder',
]);

export function isKnownPanel(p: unknown): p is AppPanel {
  return typeof p === 'string' && KNOWN_PANELS.has(p as AppPanel);
}
