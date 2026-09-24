/**
 * DHS APFS forecast IDENTITY (2026-09-24). Record: tasks/dhs-forecast-identity-2026-09-24.md
 *
 * DHS prefixes `*` to the APFS number of a REPUBLISHED record ("*F2026073903" for a record first
 * published as "F2026073903"). Measured on the live feed (apfs-cloud.dhs.gov/api/forecast, 944 rows):
 *   - 185 / 185 starred rows carry previous_publish_date; 0 / 759 plain rows do,
 *   - a starred and a plain form of one number NEVER coexist in the feed,
 *   - the APFS digits equal DHS's numeric record id on 944 / 944 rows.
 * So the `*` is a publication-state flag, not identity. Keying on the raw APFS number minted a NEW Mindy
 * row (new created_at) every time DHS republished a record — 92 plain/starred twins today — which a
 * created_at newness rule would alert as a "new" Forecast.
 *
 * Canonical identity: the APFS number WITHOUT the leading `*` (== F<FY><id>). Every live DHS ingest path
 * uses this function: cron/sync-forecasts and scrapers/dhs-apfs.ts (pinned by dhs-identity.unit.test.ts).
 * scripts/import-forecasts-live.js is RETIRED ("DO NOT RUN, DO NOT FIX") and deliberately untouched.
 */
export function canonicalDhsApfsNumber(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^\*+\s*/, '').trim();
  return s ? s.toUpperCase() : null;
}

/** True when DHS marks this record as republished (the `*` flag). Informational only — never identity. */
export function isDhsRepublished(raw: unknown): boolean {
  return /^\s*\*/.test(String(raw ?? ''));
}

/** external_id for a DHS forecast row. Falls back exactly as before when no APFS number is present. */
export function canonicalDhsExternalId(apfsNumber: unknown, sourceId: unknown, title: string | null | undefined): string {
  return canonicalDhsApfsNumber(apfsNumber)
    ?? (sourceId != null && String(sourceId).trim() ? String(sourceId).trim() : null)
    ?? `DHS:${(title || '').slice(0, 60)}`;
}
