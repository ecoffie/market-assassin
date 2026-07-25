/**
 * buildSearchOr — the shared PostgREST `.or()` string for full-text opportunity search.
 * Searches title + SAM description body + extracted SOW/PWS scope text + department +
 * solicitation number, with word-boundary regex for code-like terms ("M7" ≠ "M776") and
 * substring ILIKE for phrases. Extracted from mi-dashboard so the Opportunity Map explorer
 * uses the IDENTICAL semantics — the two surfaces must never disagree on what a search matches.
 */
export function buildSearchOr(search: string): string {
  const term = search.trim();
  const cols = ['title', 'description', 'sow_text', 'department', 'solicitation_number'];

  // Code-like? e.g. M7, M-7, 1005, 53-1234, AN/PVS-7. Has a digit, no whitespace,
  // short, and not a plain word.
  const isCodeLike = /\d/.test(term) && !/\s/.test(term) && term.length <= 8;

  if (isCodeLike) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexible = escaped
      .replace(/[-/_. ]+/g, '[-/_. ]?')            // existing separators → optional
      .replace(/([A-Za-z])(?=\d)/g, '$1[-/_. ]?')   // letter→digit seam
      .replace(/(\d)(?=[A-Za-z])/g, '$1[-/_. ]?');  // digit→letter seam
    const pattern = `\\m${flexible}\\M`;            // \m … \M = word boundaries
    return cols.map((c) => `${c}.imatch.${pattern}`).join(',');
  }
  return cols.map((c) => `${c}.ilike.%${term}%`).join(',');
}
