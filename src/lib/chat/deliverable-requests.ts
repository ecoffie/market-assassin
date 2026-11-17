/**
 * Offer-then-nothing (Agent 4 live S3, 2026-11-17): "Give me a 90-day plan as a PDF" was answered "I can draft a
 * 90-day federal contracting plan, but I can't create or attach a PDF in this chat." and then NOTHING was drafted.
 *
 * Rule: Ask Mindy never offers without delivering. When the customer asks for a deliverable (a plan, a report,
 * a checklist, a document, a file), a format the chat cannot produce (PDF, Word, a download) gets ONE line saying
 * so, and the deliverable itself is written in the chat in the same answer, grounded in this conversation's
 * results. Real files come later through the document engine (Agent 3, #2107); this does not build them.
 * Pure: detection + the instruction text. Dates are computed here (from the federal "today") so a dated plan
 * uses real calendar dates rather than ones the model guesses.
 */

/**
 * Detection is deliberately STRICT (Agent 4 review, 2026-11-17). False triggers it must never fire on:
 * "summarize the attachment I uploaded" (uploads, #2112), "export control compliance", "export-controlled items",
 * "download the solicitation documents" (Mindy returns SAM links), "check the schedule for…",
 * "give me a summary of…", "help with my strategy for DLA".
 *
 *   deliverable = a PRODUCTION verb AND a deliverable noun, where a WEAK noun (summary, schedule, strategy,
 *                 brief, timeline) also needs a file format or an N-day plan;
 *   file        = deliverable AND an explicit format ("as/in/to/into a PDF|Word|DOCX|Excel|…", or "a PDF").
 * "attach(ment)", bare "export" and bare "download" are never triggers.
 */
const PRODUCE = /\b(give\s+me|make|create|build|write|draft|put\s+together|prepare|generate|produce|send\s+me|turn\s+(?:this|that|it)\s+into|i\s+(?:need|want|'d\s+like))\b/i;
const STRONG_NOUN = /\b(plan|roadmap|road\s*map|report|checklist|one[\s-]?pager|memo|capability\s+statement|playbook)\b/i;
const WEAK_NOUN = /\b(summary|schedule|strategy|brief|timeline)\b/i;
const FORMAT_WORD = '(pdf|docx?|word(?:\\s+doc(?:ument)?)?|excel|xlsx|spreadsheet|powerpoint|pptx|slide\\s*deck)';
const FORMAT = new RegExp(`\\b(?:as|in|to|into)\\s+(?:an?\\s+)?${FORMAT_WORD}\\b|\\b(?:a|an)\\s+${FORMAT_WORD}(?:\\s+(?:file|version|copy))?\\b`, 'i');
const CONCEPT_QUESTION = /^\s*(?:what|why|how)\s+(?:is|are|does|do|should)\s+(?:a|an|the)?\s*(?:\d{2,3}[\s-]?day\s+)?(?:plan|roadmap|report|checklist|capability\s+statement|strategy)\b/i;
const DAY_PLAN = /\b(\d{2,3})[\s-]?day\s+(?:action\s+)?plan\b/i;

export type DeliverableRequest = { wantsFile: boolean; format: string | null; dayPlan: number | null };

/** null when the message does not ask Mindy to PRODUCE a deliverable. */
export function detectDeliverableRequest(text: string): DeliverableRequest | null {
  const t = String(text || '');
  // A question ABOUT a deliverable ("What is a 90-day plan?") is answered, not produced.
  if (CONCEPT_QUESTION.test(t)) return null;
  if (!PRODUCE.test(t)) return null;
  const dayPlanMatch = t.match(DAY_PLAN);
  const fm = t.match(FORMAT);
  const strong = STRONG_NOUN.test(t) || !!dayPlanMatch;
  const weak = WEAK_NOUN.test(t) && (!!fm || !!dayPlanMatch);
  if (!strong && !weak) return null;
  const word = fm ? (fm[1] ?? fm[2] ?? '') : '';
  const format = fm ? (/^word/i.test(word) ? 'WORD' : word.toUpperCase().replace(/\s+/g, ' ')) : null;
  return { wantsFile: !!fm, format, dayPlan: dayPlanMatch ? Number(dayPlanMatch[1]) : null };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The answer-step instruction for a deliverable request (null when none was asked for). */
export function deliverableNote(text: string, todayIso: string): string | null {
  const req = detectDeliverableRequest(text);
  if (!req) return null;
  const lines: string[] = ['DELIVERABLE REQUESTED — deliver it in THIS answer. Never offer without delivering.'];
  if (req.wantsFile) {
    lines.push(`- The customer asked for a ${req.format ?? 'file'}. This chat cannot create or attach files yet. Say that in ONE short line at the top (e.g. "I can't attach a ${req.format ?? 'file'} here yet, so here is the plan in full — you can copy it."), then write the complete deliverable below it. Do NOT stop after saying you can't, and do NOT ask whether they want it drafted.`);
  } else {
    lines.push('- Write the complete deliverable now. Do NOT describe what you could write or ask whether they want it.');
  }
  lines.push('- Ground it in THIS conversation: name the specific opportunities, agencies, deadlines and contacts already found (by title and solicitation number) instead of generic advice. If nothing has been found yet, run the search first, then build the deliverable on what it returned.');
  if (req.dayPlan) {
    const n = req.dayPlan;
    const marks = n >= 90 ? [30, 60, n] : n >= 60 ? [30, n] : [Math.round(n / 2), n];
    // Day 1 is today; day k is today + (k - 1). Phases are inclusive day ranges.
    const day = (k: number) => addDays(todayIso, k - 1);
    const phases = marks.map((end, i) => { const start = i === 0 ? 1 : marks[i - 1] + 1; return `${day(start)} to ${day(end)} (days ${start}–${end})`; });
    lines.push(`- It is a ${n}-day plan starting ${todayIso}. Use these dated phases: ${phases.join('; ')}. Each phase lists concrete, dated actions; tie each action to a named opportunity or contact from this conversation where one applies, and put any response deadline from those results on its real date.`);
  }
  return lines.join('\n');
}
