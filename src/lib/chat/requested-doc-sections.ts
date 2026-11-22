/**
 * Sections the customer asked a document to carry ("with an executive summary, risks, actions and sources").
 *
 * Defect (Claude Local production validation, 2026-11-22): those sections appeared in the CHAT answer but not in
 * the generated document. The answer is written after the document, so the chat had them and the file did not.
 *
 * Two layers, one helper:
 *   1. `requestedSectionsPlannerNote`: when create_document is offered, the planner is told which sections the
 *      customer named and that the doc_model must carry each one.
 *   2. `ensureRequestedSections`: the create_document tool's backstop. A requested section the doc_model still
 *      lacks is assembled ONLY from the document's own labeled statements, copied with their claim label, cites,
 *      origin and critical flag. No new fact, figure or source is ever written. A section with nothing to draw
 *      from is reported missing (and the answer says so); it is never padded.
 *
 * Sources: the renderer already prints a "Sources" list of every source the document CITES. A requested Sources
 * list is therefore present exactly when at least one statement cites a declared source; when none does, it is
 * reported missing rather than invented.
 */
import type { Block, BulletItem, Claim, DocModel, DocSection } from '@/lib/documents/model';
import { labeledUnits } from '@/lib/documents/model';

export type RequestedSectionKey = 'executive_summary' | 'risks' | 'actions' | 'sources';

interface SectionSpec {
  key: RequestedSectionKey;
  label: string;
  /** The customer's words name this section. */
  asked: RegExp;
  /** An existing heading already covers it. */
  heading: RegExp;
}

const SPECS: readonly SectionSpec[] = [
  {
    key: 'executive_summary', label: 'Executive summary',
    asked: /\b(?:exec(?:utive)?\.?\s+summary|exec\s+sum|bottom[-\s]line(?:\s+up\s+front)?|bluf|tl;?\s?dr)\b/i,
    heading: /(?:\bexecutive\s+summary\b|^\s*(?:\d+[.)]\s*)?summary\b|\bbottom\s+line\b|\bbluf\b|\bat\s+a\s+glance\b|\bkey\s+findings\b)/i,
  },
  {
    key: 'risks', label: 'Risks',
    asked: /\brisks?\b(?!\s+(?:tolerance|appetite)\b)/i,
    heading: /\brisks?\b/i,
  },
  {
    key: 'actions', label: 'Actions',
    // "actions" alone, "action items/plan", "next steps", "to-dos". Not award jargon ("contract actions",
    // "procurement actions", "number of actions" — a USAspending count), not "corrective/disciplinary actions".
    asked: /\b(?:action\s+(?:items?|plan|steps?)|next\s+steps?|to-?\s?dos?|(?<!(?:contract|contracting|procurement|award|obligation|modification|corrective|disciplinary|enforcement|legal|personnel|of)\s)actions\b)/i,
    heading: /\b(?:actions?|next\s+steps?|what\s+to\s+do|action\s+plan|recommended\s+moves?|next\s+\d+\s+days)\b/i,
  },
  {
    key: 'sources', label: 'Sources',
    asked: /\b(?:sources|citations?|cite\s+(?:your|the|all|every)|references|with\s+links)\b/i,
    heading: /\b(?:sources|citations|references)\b/i,
  },
];

/**
 * A section the customer asked for. The four known kinds can be completed from the document's own statements;
 * any other named section ('named': "agency analysis", "opportunity pipeline") is only ever checked for and
 * reported missing, never built.
 */
export interface RequestedSection { key: RequestedSectionKey | 'named'; label: string }

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'our', 'my', 'your', 'their', 'section', 'sections', 'full', 'detailed', 'short', 'brief', 'clear', 'key', 'recommended']);
/** "with an executive summary, agency analysis, ... and sources" after a document word, same sentence. */
const SECTION_LIST = /\b(?:report|document|doc|pdf|brief|deliverable|white\s*paper|memo|write[-\s]?up|plan|profile)\b[^.?!\n]{0,80}?\b(?:with|including|that\s+(?:has|includes|covers)|covering|containing)\s+([^.?!\n]{3,400})/i;

function namedSections(text: string): string[] {
  const m = SECTION_LIST.exec(text);
  if (!m) return [];
  return m[1]
    .split(/\s*,\s*(?:and\s+|or\s+)?|\s*;\s*|\s+and\s+|\s+plus\s+/i)
    .map((x) => x.trim().replace(/^(?:an?|the|some|all|any)\s+/i, '').replace(/\s+sections?$/i, '').replace(/[)"'\s]+$/, ''))
    .filter((x) => /^[a-z][a-z0-9&/' -]*$/i.test(x) && x.split(/\s+/).length <= 5);
}

const labelOf = (phrase: string) => phrase.charAt(0).toUpperCase() + phrase.slice(1);

/**
 * The sections the customer's own words ask the document to include. Known kinds come first in a fixed order,
 * then any other section the customer listed after "with" / "including", in their words. Nothing is guessed.
 */
export function requestedDocSections(customerWords: string): RequestedSection[] {
  const text = String(customerWords || '');
  if (!text.trim()) return [];
  const known: RequestedSection[] = SPECS.filter((s) => s.asked.test(text)).map(({ key, label }) => ({ key, label }));
  const named: RequestedSection[] = [];
  for (const phrase of namedSections(text)) {
    if (SPECS.some((s) => s.asked.test(phrase))) continue; // a known kind, already listed
    if (!significantWords(phrase).length) continue;
    if (named.some((n) => n.label.toLowerCase() === phrase.toLowerCase())) continue;
    named.push({ key: 'named', label: labelOf(phrase) });
  }
  return [...known, ...named];
}

function significantWords(phrase: string): string[] {
  return phrase.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** A heading covers a named section when it shares a significant word with it (stem match: "opportunities" ~ "opportunity"). */
function headingCovers(heading: string, label: string): boolean {
  const h = significantWords(heading).map((w) => w.slice(0, 6));
  return significantWords(label).some((w) => h.includes(w.slice(0, 6)));
}

/** Planner instruction for a create_document turn, or null when the customer named no section. */
export function requestedSectionsPlannerNote(requested: readonly RequestedSection[]): string | null {
  if (!requested.length) return null;
  const labels = requested.map((r) => r.label);
  return [
    `REQUESTED DOCUMENT SECTIONS: the customer asked the document itself to include: ${labels.join(', ')}.`,
    'If you call create_document, the doc_model MUST carry each one as its own section with that heading, built from this conversation\'s evidence and labeled like every other block (facts cite their sources). The chat answer does not count: what the customer asked for must be in the file.',
    ...(requested.some((r) => r.key === 'executive_summary') ? ['Put the Executive summary first.'] : []),
    ...(requested.some((r) => r.key === 'sources') ? ['Sources: declare every source a fact relies on and cite it from the statements it supports; the document prints its Sources list from those citations.'] : []),
    'If a requested section has no evidence behind it, include the section and say plainly what could not be established. Never fill it with a guess.',
  ].join(' ');
}

export interface EnsureRequestedSectionsResult {
  model: DocModel;
  /** Requested sections the doc_model already had (known keys; a named section by its label). */
  present: string[];
  /** Requested sections the host assembled from the document's own statements (known keys only). */
  added: RequestedSectionKey[];
  /** Requested sections that are not in the document (known keys; a named section by its label). */
  missing: string[];
}

type Unit = { claim?: Claim; cites?: string[]; critical?: boolean; origin?: string; text: string };

function unitsOf(sec: DocSection): Unit[] {
  const out: Unit[] = [];
  for (const b of sec.blocks ?? []) {
    if (b.type === 'table' || b.type === 'chart' || b.type === 'pagebreak') continue; // a caption is not a statement
    for (const u of labeledUnits(b)) if (u.text && u.text.trim()) out.push(u);
  }
  return out;
}

function toItem(u: Unit): BulletItem {
  return {
    text: u.text,
    ...(u.claim ? { claim: u.claim } : {}),
    ...(u.cites?.length ? { cites: [...u.cites] } : {}),
    ...(u.origin ? { origin: u.origin } : {}),
    ...(u.critical ? { critical: true } : {}),
  } as BulletItem;
}

function dedupe(units: Unit[], max: number): Unit[] {
  const seen = new Set<string>();
  const out: Unit[] = [];
  for (const u of units) {
    const k = u.text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

const RISK_TEXT = /\b(?:risks?|threats?|exposure|could\s+(?:lose|slip|delay|block)|may\s+not|not\s+(?:yet\s+)?(?:verified|confirmed|established|checked)|could\s+not\s+be\s+(?:checked|verified|established)|unavailable|depends\s+on|uncertain|incumbent\s+advantage)\b/i;

/**
 * Make sure every requested section is in the model. Adds only sections built from the document's own labeled
 * statements; returns the model unchanged when nothing is requested or everything is already present.
 */
export function ensureRequestedSections(model: DocModel, requested: readonly RequestedSection[]): EnsureRequestedSectionsResult {
  const result: EnsureRequestedSectionsResult = { model, present: [], added: [], missing: [] };
  if (!requested.length || !model || !Array.isArray(model.sections)) return result;

  const body = model.sections.filter((s) => s.role !== 'about');
  const hasHeading = (spec: SectionSpec) => model.sections.some((s) => spec.heading.test(String(s.heading || '')) && (s.blocks ?? []).length > 0);
  const usedIds = new Set<string>();
  for (const s of model.sections) { usedIds.add(s.id); for (const b of s.blocks ?? []) usedIds.add(b.id); }
  const uid = (base: string) => { let id = base; let n = 2; while (usedIds.has(id)) id = `${base}-${n++}`; usedIds.add(id); return id; };
  const section = (heading: string, base: string, items: BulletItem[]): DocSection => ({
    id: uid(`sec-${base}`),
    heading,
    blocks: [{ type: 'bullets', id: uid(`blk-${base}`), items } as Block],
  });

  const front: DocSection[] = [];
  const back: DocSection[] = [];
  for (const r of requested) {
    if (r.key === 'named') {
      const covered = model.sections.some((s) => (s.blocks ?? []).length > 0 && headingCovers(String(s.heading || ''), r.label));
      (covered ? result.present : result.missing).push(r.label);
      continue;
    }
    const spec = SPECS.find((s) => s.key === r.key)!;
    if (r.key === 'sources') {
      const ids = new Set((model.sources ?? []).map((s) => s.id));
      const cited = model.sections.some((s) => (s.blocks ?? []).some((b) => labeledUnits(b).some((u) => (u.cites ?? []).some((c) => ids.has(c)))));
      (cited ? result.present : result.missing).push('sources');
      continue;
    }
    if (hasHeading(spec)) { result.present.push(r.key); continue; }

    let picked: Unit[] = [];
    if (r.key === 'executive_summary') {
      // The lead statement of each body section, in document order: the document's own headline points.
      picked = dedupe(body.map((s) => unitsOf(s).find((u) => u.claim === 'fact' || u.claim === 'recommendation')).filter((u): u is Unit => !!u), 6);
    } else if (r.key === 'actions') {
      picked = dedupe(body.flatMap(unitsOf).filter((u) => u.claim === 'recommendation'), 10);
    } else if (r.key === 'risks') {
      picked = dedupe(body.flatMap(unitsOf).filter((u) => u.claim !== 'context' && (u.claim === 'assumption' || u.claim === 'unverified' || RISK_TEXT.test(u.text))), 10);
    }
    if (!picked.length) { result.missing.push(r.key); continue; }
    const sec = section(spec.label, r.key.replace(/_/g, '-'), picked.map(toItem));
    (r.key === 'executive_summary' ? front : back).push(sec);
    result.added.push(r.key);
  }
  if (!front.length && !back.length) return result;

  // Executive summary leads; Risks/Actions go after the body and before any 'about' (method/limits) section.
  const firstAbout = model.sections.findIndex((s, i) => s.role === 'about' && i > 0 && model.sections.slice(i).every((t) => t.role === 'about'));
  const sections = [...model.sections];
  const at = firstAbout === -1 ? sections.length : firstAbout;
  sections.splice(at, 0, ...back);
  result.model = { ...model, sections: [...front, ...sections] };
  return result;
}

/** One sentence for the tool result when something requested is not in the file; '' when nothing is missing. */
export function requestedSectionsMissingNote(missing: readonly string[]): string {
  if (!missing.length) return '';
  const labels = missing.map((k) => SPECS.find((s) => s.key === k)?.label ?? k);
  const sources = missing.includes('sources');
  return ` The customer asked for ${labels.join(', ')} in the document, but ${labels.length === 1 ? 'it is' : 'they are'} NOT in the saved file`
    + (sources ? ' (no statement in it cites a source, so it has no Sources list)' : '')
    + '. Say so plainly in the answer and offer a new version; do not present the chat answer as if it were in the file.';
}

/** Section headings the packaged generate_market_report always produces (its fixed template; Data Core owns it). */
export const PACKAGED_REPORT_SECTIONS = ['How this market was measured', 'Market composition', 'Who is buying', 'Who to call', 'Competitive landscape', 'Recompetes', 'Forecasts', 'Agency deep-dive'] as const;

/**
 * Requested sections the packaged market report's fixed template does not carry. Executive summary, risks,
 * actions and sources are never in it; a named section counts as carried only when a template heading covers it.
 */
export function sectionsPackagedReportLacks(requested: readonly RequestedSection[]): RequestedSection[] {
  return requested.filter((r) => r.key !== 'named' || !PACKAGED_REPORT_SECTIONS.some((h) => headingCovers(h, r.label)));
}

export type SectionedReportRoute =
  /** Build the report with create_document from this conversation's research; the packaged report is not offered. */
  | { route: 'document'; lacking: RequestedSection[] }
  /** create_document cannot run this turn: the packaged report may run, and the answer must say what it lacks. */
  | { route: 'packaged_with_gap_note'; lacking: RequestedSection[]; reason: 'no_document_tool' | 'no_prior_research' }
  | { route: 'none' };

/**
 * Routing for "a professional report with sections X, Y, Z" (Claude Local repro 2026-11-22): the packaged
 * market report has a fixed template, so it can never be presented as fulfilling a request for sections it does
 * not carry. With create_document available and research already in this conversation, the turn builds the
 * report as a document. Otherwise (Ask Mindy runs one planner round, so a first-turn ask cannot both research and
 * write the file) the packaged report may run and the answer states plainly which requested sections it lacks.
 */
export function routeSectionedReport(opts: { requested: readonly RequestedSection[]; asksForReport: boolean; createAvailable: boolean; hasPriorResearch: boolean }): SectionedReportRoute {
  if (!opts.asksForReport || !opts.requested.length) return { route: 'none' };
  const lacking = sectionsPackagedReportLacks(opts.requested);
  if (!lacking.length) return { route: 'none' };
  if (!opts.createAvailable) return { route: 'packaged_with_gap_note', lacking, reason: 'no_document_tool' };
  if (!opts.hasPriorResearch) return { route: 'packaged_with_gap_note', lacking, reason: 'no_prior_research' };
  return { route: 'document', lacking };
}

/** Answer-model note when the packaged report ran for a sectioned request it cannot fulfil. */
export function packagedReportGapNote(r: Extract<SectionedReportRoute, { route: 'packaged_with_gap_note' }>): string {
  const labels = r.lacking.map((x) => x.label).join(', ');
  return [
    `REQUESTED SECTIONS NOT IN THE PACKAGED REPORT: the customer asked for a report with ${labels}.`,
    `If you present the packaged market report, say plainly that its fixed sections (${PACKAGED_REPORT_SECTIONS.join(', ')}) do not include ${labels}; never present it as the report they asked for.`,
    r.reason === 'no_prior_research'
      ? 'Offer, as the next step, to turn this research into a document that carries every section they asked for.'
      : 'A document with those sections cannot be created here; give the requested sections in the chat answer and say they are not in the hosted report.',
  ].join(' ');
}

/** Planner note on a 'document' route turn: build the report as a file, from the research already in this chat. */
export function sectionedReportPlannerNote(requested: readonly RequestedSection[]): string {
  return [
    `SECTIONED REPORT: the customer asked for a report with these sections: ${requested.map((r) => r.label).join(', ')}.`,
    'The packaged market report has a fixed template without them, so it is not offered this turn. Call create_document ONCE and build the report from the research already in this conversation (the latest answer and earlier tool results), one section per requested item, in their order, with the Executive summary first when asked.',
    'Every figure cites a source from that research; a section the research cannot support says plainly what could not be established.',
  ].join(' ');
}
