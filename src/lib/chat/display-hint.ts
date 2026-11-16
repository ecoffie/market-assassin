/**
 * How the asking surface will SHOW the answer (2026-11-16). The Map's Ask Mindy drawer is ~420px wide, so
 * it sends `display: 'narrow_panel'` and the answer prompt gets a presentation rule as a SYSTEM note.
 * It is never part of the user's message, so it is not stored as the customer's words and never reaches
 * intent detection, tool selection, NAICS interpretation or excerpt choice. Presentation only: the same
 * facts, ordered and trimmed to fit. find-completeness still appends any FIND horizon the answer omits.
 * Anything other than a known value is ignored.
 */
export type DisplayHint = 'narrow_panel';

export function parseDisplayHint(v: unknown): DisplayHint | null {
  return v === 'narrow_panel' ? v : null;
}

export const NARROW_PANEL_NOTE =
  'DISPLAY: this answer is shown in a narrow side panel (about 420px). Start with the answer in 1 to 2 sentences '
  + '(for an opportunity search, your "Where I would start" recommendation goes first), then the details: at most 5 items '
  + 'per section, one line per item or a short table with at most 3 columns; a section with nothing in it is one line. '
  + 'Keep paragraphs to 2 sentences. Link text is the solicitation title or number, never "here". Offer the rest on request. '
  + 'This changes presentation only: do not drop a section the answer would otherwise include.';

export function displayHintNote(h: DisplayHint | null): string | null {
  return h === 'narrow_panel' ? NARROW_PANEL_NOTE : null;
}
