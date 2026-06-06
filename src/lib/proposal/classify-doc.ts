/**
 * Classify a solicitation attachment into a doc kind so Proposal Assist can
 * separate + route the right file to the right person (Eric: a combined synopsis
 * can have 10+ docs — SOW, pricing, wage det, Q&A, amendments). Source-agnostic:
 * works on any PDF/DOCX from SAM, NECO, GSA eBuy, a lab portal, a state system.
 *
 * Two-pass: filename heuristic first (fast, no cost), then a content/heading
 * heuristic for generic names ("Attachment 1.pdf"). An optional LLM classifier
 * (classifyDocLLM) handles the genuinely ambiguous ones.
 */
export type DocKind =
  | 'sow_pws'        // Statement of Work / PWS / SOO — the scope (send to subs)
  | 'pricing'        // pricing schedule / CLINs / Section B
  | 'wage_det'       // DBA/SCA wage determination
  | 'qa'             // questions & answers
  | 'amendment'      // amendment / modification
  | 'instructions'   // Section L — instructions to offerors
  | 'eval_factors'   // Section M — evaluation factors
  | 'solicitation'   // the base RFP/RFQ/synopsis document
  | 'past_perf_form' // past performance questionnaire / reference form (PPQ)
  | 'rep_certs'      // representations & certifications (FAR/VAAR clause forms)
  | 'attachment_other';

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  sow_pws: 'Statement of Work / PWS',
  pricing: 'Pricing Schedule',
  wage_det: 'Wage Determination',
  qa: 'Questions & Answers',
  amendment: 'Amendment',
  instructions: 'Instructions (Section L)',
  eval_factors: 'Evaluation Factors (Section M)',
  solicitation: 'Solicitation / RFP',
  past_perf_form: 'Past Performance Questionnaire',
  rep_certs: 'Reps & Certs',
  attachment_other: 'Attachment',
};

// Who each kind is relevant to — drives "route the right file to the right
// person" (Eric). Subs need scope + pricing + wage; the writer needs L/M/SOW.
export const DOC_KIND_AUDIENCE: Record<DocKind, string[]> = {
  sow_pws: ['subcontractors', 'estimators', 'proposal_writer'],
  pricing: ['subcontractors', 'estimators', 'pricing_lead'],
  wage_det: ['subcontractors', 'estimators', 'pricing_lead'],
  qa: ['proposal_writer', 'capture_lead'],
  amendment: ['proposal_writer', 'capture_lead'],
  instructions: ['proposal_writer'],
  eval_factors: ['proposal_writer', 'capture_lead'],
  solicitation: ['proposal_writer', 'capture_lead'],
  past_perf_form: ['proposal_writer', 'past_performance_lead'],
  rep_certs: ['contracts', 'proposal_writer'],
  attachment_other: ['proposal_writer'],
};

// --- Filename patterns (highest-confidence signal). Order = priority. ---
const FILENAME_RULES: Array<{ kind: DocKind; re: RegExp }> = [
  // Wage det FIRST (high-confidence keywords) so "DOL_Wage_Determination" wins.
  { kind: 'wage_det', re: /\b(wage[ _-]?det|wage[ _-]?determination|\bwd[ _-]?\d|davis[ _-]?bacon|\bdba[ _-]?wd|sca[ _-]?wage|service[ _-]?contract[ _-]?act|dol[ _-]?wage)\b/i },
  // PPQ + reps/certs BEFORE SOW (a "Past Performance" form isn't a SOW).
  { kind: 'past_perf_form', re: /\b(ppq|past[ _-]?performance[ _-]?(questionnaire|quest|ref|reference|form)|cpars[ _-]?form)\b/i },
  { kind: 'rep_certs', re: /\b(rep(s|resentations?)?[ _-]?(and|&)?[ _-]?cert|certification|vaar[ _-]?852|far[ _-]?52\.219|sdvosb[ _-]?cert|wosb[ _-]?cert|notice[ _-]?of[ _-]?total)\b/i },
  { kind: 'sow_pws', re: /\b(sow|pws|soo|statement[ _-]?of[ _-]?work|performance[ _-]?work|scope[ _-]?of[ _-]?work)\b/i },
  { kind: 'qa', re: /\b(q[ _-]?&?[ _-]?a|questions?[ _-]?(and|&)?[ _-]?answers?|rfi[ _-]?response|q\d+a\d+)\b/i },
  { kind: 'amendment', re: /\b(amend|amendment|modification|\bmod[ _-]?\d|\bamd[ _-]?\d|sf[ _-]?30)\b/i },
  { kind: 'instructions', re: /\b(section[ _-]?l\b|instructions?[ _-]?to[ _-]?offerors?|proposal[ _-]?instructions|52\.212-1|addendum.*instruction)\b/i },
  { kind: 'eval_factors', re: /\b(section[ _-]?m\b|evaluation[ _-]?factors?|basis[ _-]?of[ _-]?award|52\.212-2)\b/i },
  { kind: 'pricing', re: /\b(pric(e|ing)?[ _-]?(sched|schedule|sheet|form|vol|proposal)?|cost[ _-]?(sched|prop|vol|breakdown)|clin|schedule[ _-]?b|bid[ _-]?schedule|line[ _-]?item|\bbom\b)\b/i },
  // Base solicitation doc — a SAM Sol_NNN file with no amendment marker, or an
  // explicit RFP/RFQ/sources-sought announcement.
  { kind: 'solicitation', re: /\b(combined[ _-]?synopsis|sf[ _-]?1449|sources[ _-]?sought|presolicitation|^sol[ _-]?\w+(?!.*amd)|\brfp\b|\brfq\b)\b/i },
];

// --- Content/heading patterns (for generic filenames) ---
const CONTENT_RULES: Array<{ kind: DocKind; re: RegExp; weight: number }> = [
  { kind: 'sow_pws', re: /\b(statement of work|performance work statement|statement of objectives|scope of work)\b/i, weight: 3 },
  { kind: 'wage_det', re: /\b(wage determination|general decision number|davis-bacon|service contract act)\b/i, weight: 3 },
  { kind: 'pricing', re: /\b(contract line item|\bclin\b|pricing schedule|unit price|extended price|schedule of (supplies|services))\b/i, weight: 2 },
  { kind: 'qa', re: /\b(question\s*\d|answer:|q&a|questions and answers)\b/i, weight: 2 },
  { kind: 'amendment', re: /\b(amendment of solicitation|standard form 30|sf\s*30|the purpose of this (amendment|modification))\b/i, weight: 3 },
  { kind: 'instructions', re: /\b(section l\b|instructions,? conditions,? and notices|volume \w+ shall|proposal shall (be|not exceed))\b/i, weight: 2 },
  { kind: 'eval_factors', re: /\b(section m\b|evaluation factors for award|the government will evaluate|basis for award)\b/i, weight: 2 },
];

/**
 * Classify by filename + a snippet of the extracted text. Returns the kind +
 * confidence ('high' filename match, 'medium' content, 'low' fallback).
 */
export function classifyDoc(filename: string, text?: string): { kind: DocKind; confidence: 'high' | 'medium' | 'low' } {
  // Normalize separators (+, _, ., -, %20) to spaces so \b word-boundaries fire
  // on real SAM filenames like "Attachment_10_PPQ_0001.docx" / "B623+...+PWS+".
  const fn = (filename || '').replace(/[+_.%-]+|%20/g, ' ').replace(/\s+/g, ' ');
  // Amendment wins over base-solicitation when "Amd N" is present (a
  // "Sol_X_Amd_2" is an amendment, not the base sol).
  if (/\b(amd|amend|amendment|mod)\s*\d/i.test(fn)) return { kind: 'amendment', confidence: 'high' };
  // Pass 1: filename rules (order = priority).
  for (const r of FILENAME_RULES) {
    if (r.re.test(fn)) return { kind: r.kind, confidence: 'high' };
  }
  // Pass 2: content heuristics over the first ~4000 chars (headings live early).
  const head = (text || '').slice(0, 4000);
  if (head) {
    const scores = new Map<DocKind, number>();
    for (const r of CONTENT_RULES) {
      if (r.re.test(head)) scores.set(r.kind, (scores.get(r.kind) || 0) + r.weight);
    }
    if (scores.size > 0) {
      const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
      return { kind: best[0], confidence: 'medium' };
    }
  }
  return { kind: 'attachment_other', confidence: 'low' };
}
