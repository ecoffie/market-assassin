/**
 * Pure helpers that read a job posting's text. No I/O.
 *
 * These only report what the posting SAYS. "Clearance: null" means the posting does not state
 * one, not that the role needs none.
 */

const ENTITY_SUFFIX = /\b(inc|incorporated|llc|l l c|corp|corporation|co|company|ltd|limited|lp|llp|plc|pllc|pc|group|holdings)\b/g;

/** Comparable employer key: lowercase, punctuation and company-type suffixes removed. */
export function normalizeEmployer(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(ENTITY_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Highest clearance the posting text names, or null when none is stated. */
export function detectClearance(text: string): string | null {
  const t = (text || '').toLowerCase();
  if (/\bts\s*\/\s*sci\b|\btop secret\s*\/\s*sci\b|\bsci eligib/.test(t)) return 'TS/SCI';
  if (/\btop secret\b|\bts clearance\b/.test(t)) return 'Top Secret';
  if (/\bsecret (security )?clearance\b|\bactive secret\b|\binterim secret\b|\bsecret level\b|\bdod secret\b/.test(t)) return 'Secret';
  if (/\bpublic trust\b/.test(t)) return 'Public Trust';
  return null;
}

/** True when the posting says the job depends on winning a contract. */
export function detectContingentOnAward(text: string): boolean {
  return /\bcontingent\s+(up)?on\s+(the\s+)?(contract\s+)?award|\bpending\s+(the\s+)?contract\s+award|\bupon\s+contract\s+award|\bcontingent\s+(up)?on\s+(the\s+)?(successful\s+)?(contract\s+)?(win|award)/i.test(
    text || '',
  );
}
