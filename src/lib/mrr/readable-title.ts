const SMALL_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'in', 'on', 'to', 'a', 'an', 'with']);

/** USASpending titles arrive in capitals; show them as a reader would write them. */
export function readableTitle(name: string): string {
  if (!name || name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}
