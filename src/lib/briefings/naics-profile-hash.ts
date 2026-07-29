/**
 * The ONE briefing/alert NAICS-profile hash + key.
 *
 * This is the ROUTING KEY that groups users into precomputed briefing templates: the precompute
 * crons write `briefing_templates.naics_profile_hash`, the send crons look a user's template up by
 * it, and triage uses it to scope `user_dismissed_targets`. It was copy-pasted into 7 routes and had
 * already DRIFTED — six copies hashed `[...codes].sort()` while triage hashed
 * `[...codes].map(c => c.trim()).filter(Boolean).sort()`. Identical for clean 6-digit profiles (all
 * real data), so it hid — but a profile carrying a stray space or an empty '' entry would hash two
 * different ways depending on which surface ran, so a template written under one key could never be
 * found under the other. Consolidated here so producer and consumers can never disagree again.
 *
 * Canonical normalization = trim + drop empties + sort. This is the STRICTLY-more-correct form (the
 * old triage form): a NAICS array must not hash differently for whitespace. Verified against prod
 * (2026-07-28): a no-op on 1722/1724 templates (same hash); the only 2 it re-keys are junk `[""]`
 * empty-profile templates, which SHOULD stop matching and self-heal on the next precompute run.
 */
import crypto from 'crypto';

/** Canonical sorted, trimmed, empty-dropped code list — the value stored in `naics_profile`. */
export function normalizeNaicsProfileCodes(naicsCodes: string[] | null | undefined): string[] {
  return [...(naicsCodes || [])]
    .filter((c) => c != null) // a null element in a Postgres text[] would stringify to "null"
    .map((c) => String(c).trim())
    .filter(Boolean)
    .sort();
}

/** The stored `naics_profile` string (JSON of the canonical code list). */
export function naicsProfileKey(naicsCodes: string[] | null | undefined): string {
  return JSON.stringify(normalizeNaicsProfileCodes(naicsCodes));
}

/** The stored `naics_profile_hash` — md5 of the canonical profile key. THE template routing key. */
export function hashNaicsProfile(naicsCodes: string[] | null | undefined): string {
  return crypto.createHash('md5').update(naicsProfileKey(naicsCodes)).digest('hex');
}
