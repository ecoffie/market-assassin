/**
 * deriveAgenciesFromNaics — the top buying agencies for a user's NAICS codes.
 *
 * The gap this closes (Eric 2026-07-02): the slurpee/auto-setup DID scan buying
 * agencies from NAICS, but wrote them to `user_target_list` (a Pro table) — never
 * to `user_notification_settings.agencies`, which is what the alerts profile and
 * the Decision Makers directory actually read. So every account had `agencies: []`
 * despite completing setup. This helper is the single source of that derivation,
 * reused by (a) profile-save seeding and (b) the Decision Makers free teaser.
 *
 * Reuses the EXISTING public find-agencies scan (no auth, no tier gate, no new
 * infra) — the same call auto-setup uses. Returns real agency names ranked by
 * spend; empty on any failure (callers degrade gracefully). No fabricated data.
 */

interface ScanAgency {
  name?: string;
  subAgency?: string;
  parentAgency?: string;
  contractingOffice?: string;
}

/**
 * @param naicsCodes user's NAICS (we scan the top few and merge)
 * @param base absolute origin for the internal fetch (find-agencies is same-app)
 * @param limit max agency names to return
 * @returns deduped agency names ranked by the scan's spend order
 */
export async function deriveAgenciesFromNaics(
  naicsCodes: string[],
  base: string,
  limit = 10,
): Promise<string[]> {
  const codes = (naicsCodes || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 3);
  if (codes.length === 0) return [];

  // find-agencies takes ONE naicsCode, so scan the top codes and merge, preserving
  // per-scan spend order (find-agencies already sorts by spend for small business).
  const merged: string[] = [];
  const seen = new Set<string>();

  const scans = await Promise.allSettled(
    codes.map((code) =>
      fetch(`${base}/api/usaspending/find-agencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naicsCode: code }),
      }).then((r) => (r.ok ? r.json() : null)),
    ),
  );

  for (const s of scans) {
    if (s.status !== 'fulfilled' || !s.value?.agencies) continue;
    for (const a of s.value.agencies as ScanAgency[]) {
      // Prefer the operational sub-agency ("Department of the Army") over the broad
      // parent ("Department of Defense"), since the contact directory keys on the
      // operating agency. Fall back to name, then parent.
      const label = (a.subAgency || a.name || a.parentAgency || '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(label);
      if (merged.length >= limit) return merged;
    }
  }

  return merged;
}
