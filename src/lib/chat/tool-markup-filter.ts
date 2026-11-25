/**
 * Tool-call markup must never reach the customer as answer text.
 *
 * Preview, 2026-11-25: an answer model with no tools attached imitated the tool turns in its context and printed
 * raw markup (<invoke name="get_award_detail">...) as the reply. This streaming filter passes text through as it
 * arrives, except <function_calls> / <invoke> / <parameter> markup, which is held from its first '<' only until it
 * can be told apart from ordinary text, then dropped through its closing tag (an unclosed tail at the end is dropped).
 * Ordinary text, including a plain '<', passes through unchanged.
 */
const MARKUP_OPEN = ['<function_calls', '<invoke', '<parameter'];
const MARKUP_CLOSE: Record<string, string> = { '<function_calls': '</function_calls>', '<invoke': '</invoke>', '<parameter': '</parameter>' };

/**
 * Streaming filter: text passes through as it arrives, except tool-call markup, which is held from its first '<'
 * only until it can be told apart from ordinary text, then dropped through its closing tag.
 */
export function createMarkupFilter(): { push(t: string): string; end(): string } {
  let held = '';
  const drain = (final: boolean): string => {
    let out = '';
    for (;;) {
      const i = held.indexOf('<');
      if (i === -1) { out += held; held = ''; return out; }
      out += held.slice(0, i); held = held.slice(i);
      const tag = MARKUP_OPEN.find((t) => held.startsWith(t));
      if (tag) {
        const close = held.indexOf(MARKUP_CLOSE[tag]);
        if (close === -1) { if (final) held = ''; return out; } // wait for the close (or drop an unclosed tail)
        held = held.slice(close + MARKUP_CLOSE[tag].length);
        continue;
      }
      if (!final && MARKUP_OPEN.some((t) => t.startsWith(held))) return out; // could still become markup
      out += '<'; held = held.slice(1);
    }
  };
  return { push: (t: string) => { held += t; return drain(false); }, end: () => drain(true) };
}
