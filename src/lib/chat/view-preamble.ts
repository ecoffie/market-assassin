/**
 * The Map's "ask about this view" preamble ("[Current map view — …]\n\n" at the START of a message) is
 * machine context for the model, not the customer's words. It is stored with the message so a continued
 * conversation still gives the model that view, but it is never displayed and never names a conversation.
 *
 * Client-safe (no server imports): used by the /app chat panel, the chat route and the sessions route.
 * DISPLAY/TITLE ONLY. The same pattern lives in intent-compiler.ts for the model side; view-preamble.unit.test.ts
 * asserts the two recognise the same text.
 */
const VIEW_PREAMBLE_RE = /^\s*\[Current map view [\s\S]*?\]\s*(?:\n|$)/;
const PREAMBLE_TITLE_PREFIX = '[Current map view';
const TITLE_MAX = 60;

export function splitViewPreamble(text: string): { view: string | null; rest: string } {
  const m = String(text || '').match(VIEW_PREAMBLE_RE);
  return m ? { view: m[0], rest: String(text).slice(m[0].length) } : { view: null, rest: String(text || '') };
}

/** What the customer typed: the message without a leading Map view preamble. */
export function customerText(content: string): string {
  return splitViewPreamble(content).rest;
}

/** A conversation title from the customer's typed words ('' when they typed nothing). */
export function sessionTitleFrom(userMessage: string): string {
  return customerText(userMessage).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim();
}

/** True for a title the old code cut from the preamble itself (the first 60 characters of the message). */
export function isViewPreambleTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && title.trimStart().startsWith(PREAMBLE_TITLE_PREFIX);
}
