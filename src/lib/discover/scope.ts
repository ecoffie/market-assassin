/**
 * "What is this contract?" — a human scope line for the Discover feeds.
 *
 * People care about the WORK, not the company (Eric). But the data is uneven:
 *   - recent_big_awards has real scope text in `description` (but no naics_code).
 *   - recompete_opportunities has only `naics_code` (description + naics_description null).
 * So: use clean scope text when we have it, else map the NAICS code to its title
 * (naics-codes.json — the authoritative 1,741-code federal map), else a plain fallback.
 */
import naicsData from '@/data/naics-codes.json';

const CODES = (naicsData as { codes: Record<string, { title?: string }> }).codes;

/** NAICS code → its federal title (exact, else the 6-digit prefix). */
export function naicsTitle(code?: string | null): string | null {
  if (!code) return null;
  const c = String(code).trim();
  return CODES[c]?.title ?? (c.length > 6 ? CODES[c.slice(0, 6)]?.title : null) ?? null;
}

interface Scopeable {
  description?: string | null;
  naics_code?: string | null;
  naics_description?: string | null;
}

/**
 * The best "what it is" for a contract. Prefers the real scope text (cleaned of the
 * common federal junk — IGF markers, "DESCRIPTION:" prefixes, contract-number strings),
 * and falls back to the NAICS category so a card is never just a company name.
 */
export function contractScope(o: Scopeable): string {
  const s = (o.description || '')
    .replace(/IGF::[A-Z]{1,3}::IGF/gi, ' ')
    .replace(/^\s*DESCRIPTION:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Accept only if it's genuinely descriptive: long enough and mostly letters (rejects
  // "CAPE KNOX-PACIFIC…-KNOX26-2009A-FY…" contract-number strings).
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  if (s.length >= 12 && letters >= s.length * 0.5) return s;
  return naicsTitle(o.naics_code) || o.naics_description || 'Federal contract';
}
