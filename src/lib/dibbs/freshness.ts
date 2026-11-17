/**
 * DIBBS panel freshness notice (Eric, 2026-11-14). Pure, so the panel and its test share one wording.
 * The last-update date comes from the data; when it is unknown the notice says so instead of guessing.
 */
export interface DibbsFreshness {
  paused: boolean;
  /** ISO timestamp of the newest row written by a successful sync, or null when it could not be read. */
  lastUpdatedAt: string | null;
}

/** "November 2, 2026", in UTC so the date never depends on the viewer's time zone. */
export function formatDibbsUpdateDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** The notice text, or null when the feed is not paused (no notice is shown). */
export function dibbsFreshnessNotice(f: DibbsFreshness | null | undefined): string | null {
  if (!f || !f.paused) return null;
  const date = formatDibbsUpdateDate(f.lastUpdatedAt);
  return `DIBBS updates are paused. Last successful data update: ${date ?? 'unknown'}. Listings may be outdated. Verify current status and deadlines with DIBBS.`;
}
