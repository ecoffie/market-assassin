/**
 * Derive search KEYWORDS from a user's NAICS codes (and business type) so their
 * search WIDENS beyond NAICS — catching opps that are misclassified or "called
 * something else" (Eric's "drone problem"). NAICS-only search misses an opp
 * filed under a NAICS the user didn't list; a keyword like "roofing" or
 * "environmental" catches it across all the NAICS that term spans.
 *
 * Keywords come from the NAICS title's meaningful nouns (e.g. 238160 "Roofing
 * Contractors" → "roofing"), with generic filler dropped.
 */
import naicsData from '@/data/naics-codes.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CODES: Record<string, { title?: string }> = (naicsData as any).codes || {};

// Words in NAICS titles that carry no search signal.
const STOP = new Set([
  'and', 'or', 'the', 'of', 'for', 'all', 'other', 'nec', 'except',
  'contractors', 'services', 'service', 'manufacturing', 'wholesalers',
  'dealers', 'stores', 'merchant', 'activities', 'related', 'general',
  'specialty', 'trade', 'operations', 'support', 'establishments', 'n.e.c.',
  'including', 'such', 'not', 'elsewhere', 'classified',
]);

function titleToKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 4 && !STOP.has(w))
    .slice(0, 3); // top few signal words per NAICS title
}

/**
 * Derive a deduped keyword list (max ~15) from NAICS codes. Each code resolves
 * to its title's signal words. Exact 6-digit codes preferred; falls back to the
 * shortest matching prefix title.
 */
export function deriveKeywordsFromNaics(naicsCodes: string[]): string[] {
  const out = new Set<string>();
  for (const raw of naicsCodes) {
    const code = (raw || '').replace(/[^0-9]/g, '');
    if (!code) continue;
    let title = CODES[code]?.title;
    if (!title) {
      // prefix fallback: find the most specific parent title
      for (let len = 5; len >= 3 && !title; len--) {
        const k = Object.keys(CODES).find(c => c.startsWith(code.slice(0, len)));
        if (k) title = CODES[k]?.title;
      }
    }
    if (title) for (const kw of titleToKeywords(title)) out.add(kw);
    if (out.size >= 15) break;
  }
  return Array.from(out).slice(0, 15);
}
