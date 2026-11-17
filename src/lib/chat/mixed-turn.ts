/**
 * Mixed turns (audit A1): one tool's records were rendered as a verified list, another tool's result was not.
 *
 * Before: as soon as ANY list was rendered, the answer model was told "do not state any number, date, name…"
 * for the whole turn, and lintAnalysis then removed every non-imperative sentence and every sentence with a
 * digit. That rule exists for the RENDERED records (the list already carries every fact, so a model restating
 * them can only add errors). Applied to the whole turn it also deleted everything the model said about the
 * OTHER tools — their findings, and the sentence saying a lookup failed. Repro: "expiring contracts for 541512
 * and any open opportunities" showed the expiring list and nothing from find_opportunities.
 *
 * Now, in a mixed turn only:
 *   - the note scopes the no-facts rule to the rendered lists and names the tools whose results were NOT shown,
 *     asking for a normal grounded answer from those first, then a `NEXT STEPS:` line;
 *   - the text before the marker is kept as a normal answer, minus any sentence that restates a rendered
 *     record by its identifier (the list is authoritative for those);
 *   - only the text after the marker gets the next-step lint.
 * A turn where every result was rendered is unchanged (deterministic next steps, model closing not shown).
 */
import { lintAnalysis, type RenderedRecords } from './record-render';

export const MIXED_TURN_MARKER = 'NEXT STEPS:';

export interface UnrenderedResult { tool: string; status: string }

/** The answer-step system note for a mixed turn. */
export function mixedTurnNote(rendered: RenderedRecords[], unrendered: UnrenderedResult[]): string {
  const shownTools = [...new Set(rendered.map((r) => r.tool))].join(', ');
  const other = unrendered.map((u) => (u.status === 'success' ? u.tool : `${u.tool} (did not return data: ${u.status})`)).join(', ');
  return 'VERIFIED RECORD LIST (PARTIAL TURN): the records below, from ' + shownTools + ', were rendered from the tool data and have ALREADY been shown to the user verbatim, directly above your reply. '
    + 'Results from these other lookups were NOT shown to the user: ' + other + '. '
    + 'Write your reply in two parts. '
    + 'PART 1: answer the user from those other lookups exactly as you normally would, grounded only in their results, with their specific facts. If one of them failed, was refused or returned nothing, say so plainly; never describe an unavailable lookup as none or zero. Do not list, repeat, renumber or summarize the verified records below in part 1. '
    + `PART 2: write a line containing only "${MIXED_TURN_MARKER}" and then 1 to 3 short sentences of next-step guidance about the verified records below: what the customer should look at or do next. In part 2, state no number, date, dollar amount, name, ranking, superlative, trend or characterization; the list carries every fact, and part-2 sentences that add facts are removed before display.\n\n`
    + 'WHAT EACH LIST IS: a buying-offices list is federal government offices that buy this work (prospective customers, never partners or competitors); an expiring or past-award list is contracts with the incumbent companies holding them; a keyword list is search terms; a rate list is GSA schedule ceiling rates; a vehicle list is spending by contract vehicle; a contact list is the people the record names, with its own label of whether they are a designated small business liaison.\n\n'
    + rendered.map((r) => r.text).join('\n\n');
}

/** Split the model's mixed-turn reply at the marker. Without a marker, everything is part 1. */
export function splitMixedAnswer(text: string): { summary: string; nextSteps: string; markerFound: boolean } {
  const src = String(text || '');
  const re = /^\s*(?:\*\*)?\s*NEXT STEPS\s*:?\s*(?:\*\*)?\s*:?/im;
  const m = re.exec(src);
  if (!m) return { summary: src.trim(), nextSteps: '', markerFound: false };
  return { summary: src.slice(0, m.index).trim(), nextSteps: src.slice(m.index + m[0].length).trim(), markerFound: true };
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Remove sentences that restate a rendered record by its identifier (PIID, office code, UEI…). Short ids
 * (under 5 characters) are ignored: they collide with ordinary words.
 */
export function dropRecordRestatements(text: string, rendered: RenderedRecords[]): { text: string; dropped: string[] } {
  const ids = [...new Set(rendered.flatMap((r) => r.ids || []).filter((id) => typeof id === 'string' && id.length >= 5))];
  if (!ids.length || !text.trim()) return { text: text.trim(), dropped: [] };
  const idRe = new RegExp(`(?<![A-Za-z0-9])(?:${ids.map(escapeRe).join('|')})(?![A-Za-z0-9])`, 'i');
  const dropped: string[] = [];
  // Keep line structure (lists, headings) while splitting sentences inside each line.
  const lines = text.split('\n').map((line) => {
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((p) => {
      if (idRe.test(p)) { dropped.push(p.trim()); return false; }
      return true;
    });
    return kept.join(' ');
  });
  return { text: lines.filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim(), dropped };
}

/**
 * The text shown after the rendered lists in a mixed turn: part 1 (restatements removed), then part 2
 * (next-step lint). `fallback` is used when nothing survives.
 */
export function composeMixedAnswer(modelText: string, rendered: RenderedRecords[], fallback: string): { text: string; nextStepsText: string; dropped: string[]; markerFound: boolean } {
  const { summary, nextSteps, markerFound } = splitMixedAnswer(modelText);
  const part1 = dropRecordRestatements(summary, rendered);
  const part2 = nextSteps ? lintAnalysis(nextSteps, '') : { text: '', dropped: [] as string[] };
  const text = [part1.text, part2.text].filter(Boolean).join('\n\n');
  return { text: text || fallback, nextStepsText: part2.text, dropped: [...part1.dropped, ...part2.dropped], markerFound };
}
