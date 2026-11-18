/**
 * Derive SAM entity registration status from expiry, not the stored flag alone.
 *
 * Measured 2026-11-18: 157,787 rows say registration_status=Active while
 * registration_expiry is already past. Readers must not present those as Active.
 */

export function deriveRegistrationStatus(
  stored: string | null | undefined,
  expiry: string | null | undefined,
  now: Date = new Date(),
): string {
  if (expiry) {
    const raw = String(expiry).trim();
    // Date-only fields are end-of-day UTC so "expires on D" stays Active through D.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms < now.getTime()) return 'Expired';
  }
  const s = (stored && String(stored).trim()) || '';
  return s || 'Unknown';
}

/** True only when derived status is an active registration (case-insensitive). */
export function isRegistrationActive(
  stored: string | null | undefined,
  expiry: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return /^active$/i.test(deriveRegistrationStatus(stored, expiry, now));
}
