/**
 * Pick the parts of a long solicitation most relevant to a question, within a character budget.
 *
 * Moved verbatim from Proposal Assist's chat route (2026-11-14) so the Opportunity Map card chat can use
 * the SAME excerpt selection instead of a second implementation. Behavior unchanged. Moved again to this
 * neutral path (2026-11-17) so Ask Mindy document uploads use it without importing Proposal AI code;
 * src/lib/proposal/select-relevant.ts re-exports it.
 */
/**
 * Pick the parts of a big solicitation most RELEVANT to the user's question
 * (Eric QC: asking "how many projects / dollar amount" got generic fluff because
 * the chat only saw the first 8K of a 350K doc). Splits into windows, scores
 * each by keyword overlap with the question, returns the top windows up to a
 * char budget — so specific numbers deep in the doc actually reach the model.
 */
export function selectRelevantRfp(rfpText: string, question: string, budget: number): string {
  if (rfpText.length <= budget) return rfpText;
  const WIN = 2000;
  const windows: { text: string; score: number; idx: number }[] = [];
  // Question keywords (drop short/stop words).
  const stop = new Set(['the', 'and', 'for', 'are', 'you', 'what', 'how', 'many', 'this', 'that', 'with', 'need', 'does', 'have', 'can', 'will', 'about', 'tell', 'give', 'into']);
  const terms = (question.toLowerCase().match(/[a-z0-9$]{3,}/g) || []).filter(t => !stop.has(t));
  // Always include intent keywords for common asks.
  const intent = /past[ _-]?perform|reference|project|dollar|value|amount|\$|price|deadline|due|page|submit|evaluat|award|set[ _-]?aside|naics|bond|licens|requir/i;
  for (let i = 0; i < rfpText.length; i += WIN) {
    const text = rfpText.slice(i, i + WIN + 400); // small overlap
    const low = text.toLowerCase();
    let score = 0;
    for (const t of terms) if (low.includes(t)) score += 2;
    if (intent.test(text)) score += 1;
    // Numbers/dollar figures are valuable for "how many / how much" questions.
    if (/\$[\d,]+|\b\d+\s*(projects?|years?|references?|contracts?)\b/i.test(text)) score += 2;
    windows.push({ text, score, idx: i });
  }
  // Always keep the first window (cover page / summary) + the top-scoring rest.
  const first = windows[0];
  const ranked = windows.slice(1).filter(w => w.score > 0).sort((a, b) => b.score - a.score);
  // Fill the budget in RANK order (first window, then highest score), THEN re-order by document position so it
  // reads coherently. Sorting by position before budgeting kept the earliest windows and dropped a relevant
  // passage late in a long file (connected-files acceptance 2026-11-24).
  const picked: typeof windows = [];
  let used = 0;
  for (const w of [first, ...ranked]) {
    if (used + w.text.length > budget) continue;
    picked.push(w); used += w.text.length;
  }
  return picked.sort((a, b) => a.idx - b.idx).map((w) => w.text).join('\n…\n');
}
