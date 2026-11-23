/**
 * Shared <title> shortening for public SEO detail pages.
 *
 * Google cuts a result title off at roughly 600px (about 60-70 characters).
 * Our templates put the brand/kind suffix last ("— Federal Contracts | Mindy"),
 * so an over-long name pushed the suffix out of the visible title, and a plain
 * `slice()` cut words in half ("Hobe Sou…"). These helpers shorten only the
 * NAME part, at a word boundary, and keep the suffix whole.
 *
 * Nothing is invented: the output is always a prefix of the source name.
 */

/** Target length for a search-result <title>. */
export const MAX_SEO_TITLE = 70;

// Words that read as broken when a clipped name ends on them.
const DANGLING = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'except', 'for', 'from', 'in', 'of',
  'on', 'or', 'the', 'to', 'with', '&', '-', '–', '—',
]);

/**
 * Clip `name` to at most `room` characters (ellipsis included), cutting at a
 * word boundary and never ending on a connector word, open bracket or comma.
 * Falls back to a hard cut only when the first word alone is longer than room.
 */
export function clipAtWord(name: string, room: number): string {
  const s = name.replace(/\s+/g, ' ').trim();
  if (s.length <= room) return s;
  const max = Math.max(1, room - 1); // leave space for the ellipsis
  const words = s.split(' ');
  const kept: string[] = [];
  let len = 0;
  for (const w of words) {
    const next = len === 0 ? w.length : len + 1 + w.length;
    if (next > max) break;
    kept.push(w);
    len = next;
  }
  // Drop trailing connectors and an unclosed "(" clause.
  while (kept.length > 1) {
    const last = kept[kept.length - 1];
    const bare = last.replace(/[,;:]+$/, '').toLowerCase();
    const openParen = kept.join(' ').lastIndexOf('(') > kept.join(' ').lastIndexOf(')');
    if (DANGLING.has(bare) || openParen) {
      kept.pop();
      continue;
    }
    break;
  }
  if (kept.length === 0) return `${s.slice(0, max).trimEnd()}…`;
  const out = kept.join(' ').replace(/[\s,;:(\-–—&]+$/, '');
  return `${out}…`;
}

/**
 * /naics/<code> titles. The code is what makes each page's title unique, so it
 * is always kept, and the "— Federal Contracts | Mindy" suffix stays whole; only
 * the NAICS description is shortened. og:title keeps the full description
 * (social cards do not truncate at 600px).
 */
export function buildNaicsTitles(code: string, description: string): { title: string; ogTitle: string } {
  const name = description.replace(/\s+/g, ' ').trim();
  const prefix = `NAICS ${code}: `;
  const suffix = ' — Federal Contracts | Mindy';
  const ogTitle = `${prefix}${name}${suffix}`;
  if (ogTitle.length <= MAX_SEO_TITLE) return { title: ogTitle, ogTitle };
  const room = MAX_SEO_TITLE - prefix.length - suffix.length;
  return { title: `${prefix}${clipAtWord(name, room)}${suffix}`, ogTitle };
}
