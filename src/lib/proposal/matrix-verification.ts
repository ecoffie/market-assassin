/**
 * Compliance-matrix TRUTH GATE — deterministic, post-extraction verification.
 *
 * WHY (Poteto "Compliance Matrix Truth", 2026-09-22): the extractor is an LLM, and
 * nothing checked what it returned. On the gold-master package (VA 36C24226Q0857)
 * production returned rows that (a) cited sections the document never has — the
 * SOW numbers itself `2.15`, the model emitted `C.2.15`; clause 52.212-4's paragraph
 * `(l) Termination` came back as section `l`, which reads as "Section L" in a
 * solicitation that has no Section L — and (b) paired a real sentence with a
 * requirement it does not support (13 submittal-log rows all "quoted" the same
 * 10-day-notification sentence; one of them also carried a wrong spec section).
 * An earlier audit measured 9/72 quotes that did not exist in the source at all.
 *
 * The rule this file enforces:
 *   No customer-visible source claim survives unless it can be verified against
 *   the source text Mindy actually has.
 *
 * Verification uses ONLY the source text — never another LLM. Each candidate row is
 * classified, and only rows meeting the truth contract are promoted:
 *   requirements    — quote verified (exact / harmless normalization) in a located
 *                     document, and the quote lexically supports the requirement
 *   interpretations — the model paraphrased: the claimed "quote" is not in the
 *                     source, but one source sentence clearly carries it. Returned
 *                     with that sentence VERBATIM as evidence; never as a quote.
 *   withheld        — unverifiable / source_unavailable / source_mismatch /
 *                     no_source_quote / quote_does_not_support_requirement
 *
 * A section label is kept only when the document itself establishes it as the
 * heading enclosing the quote; otherwise it is removed from the row and reported as
 * `section_status: 'withheld_unverified'` (the requirement may still be trusted —
 * only the citation was unprovable). Pages are not claimed: the stored text carries
 * no page boundaries, so location is a character range in a named document.
 */

export interface MatrixSourceDoc {
  document_id: string;
  filename: string;
  text: string;
  role: 'notice_description' | 'attachment' | 'rfp_text';
}

export type QuoteStatus =
  | 'verified_exact'
  | 'verified_normalized'
  | 'paraphrase'
  | 'source_mismatch'
  | 'unverifiable'
  | 'source_unavailable'
  | 'no_source_quote';

export type WithheldReason =
  | 'unverifiable'
  | 'source_unavailable'
  | 'source_mismatch'
  | 'no_source_quote'
  | 'quote_does_not_support_requirement';

export interface EvidenceLocation {
  document_id: string;
  filename: string;
  role: MatrixSourceDoc['role'];
  /** Character range in that document's stored text. Pages are not available. */
  char_start: number;
  char_end: number;
}

export interface RowVerification {
  quote_status: QuoteStatus;
  /** Every document the evidence was found in (identical wage determinations etc.). */
  found_in: EvidenceLocation[];
  section_status: 'verified' | 'withheld_unverified' | 'not_claimed';
  /** The label the model claimed, kept only when it could NOT be verified. */
  section_claimed?: string;
  /** Share of the requirement's content words present in its evidence (0..1). */
  support_overlap: number;
  /** Figures/codes the requirement states that its evidence does not contain. */
  unsupported_figures?: string[];
  page: null;
}

export interface CandidateRow {
  id?: string;
  requirement?: string;
  category?: string;
  section?: string;
  source_quote?: string;
  source_doc?: string;
}

export type VerifiedRow<T> = Omit<T, 'section'> & {
  section?: string;
  source_doc?: string;
  verification: RowVerification;
};

export type InterpretedRow<T> = Omit<T, 'section' | 'source_quote'> & {
  section?: string;
  /** Verbatim source sentence carrying this requirement (sliced from the source). */
  source_evidence: string;
  /** What the model presented as a quote — NOT source language. */
  model_paraphrase: string;
  source_doc?: string;
  verification: RowVerification;
};

export type WithheldRow<T> = T & { withheld_reason: WithheldReason; verification: RowVerification };

export interface MatrixVerificationSummary {
  method: 'deterministic_source_text_match';
  candidates_total: number;
  requirements_verified: number;
  interpretations: number;
  candidates_withheld: number;
  withheld_by_reason: Partial<Record<WithheldReason, number>>;
  sections_withheld: number;
  quote_status_counts: Partial<Record<QuoteStatus, number>>;
}

export interface MatrixVerificationResult<T> {
  requirements: VerifiedRow<T>[];
  interpretations: InterpretedRow<T>[];
  withheld: WithheldRow<T>[];
  summary: MatrixVerificationSummary;
}

// ─── normalization ───────────────────────────────────────────────────────────

const CHAR_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-', '­': '',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

/**
 * Harmless normalization only: typographic quotes/dashes, whitespace runs, line
 * wraps, hyphenation broken across an extracted line, and letter case. Returns the
 * normalized string plus, for every normalized char, its index in the original — so
 * a normalized match maps back to an exact character range in the stored source.
 */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (ch in CHAR_MAP) ch = CHAR_MAP[ch];
    if (ch === '') continue;
    // "demoli-\n  tion" → "demolition" (extraction hyphenation across a line break)
    if (ch === '-' && /\w/.test(text[i - 1] || '')) {
      let j = i + 1;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
      if (text[j] === '\n' || text[j] === '\r') {
        while (j < text.length && /\s/.test(text[j])) j++;
        if (/\w/.test(text[j] || '')) { i = j - 1; continue; }
      }
    }
    if (/\s/.test(ch)) {
      if (lastSpace) continue;
      out.push(' '); map.push(i); lastSpace = true;
      continue;
    }
    out.push(ch.toLowerCase()); map.push(i); lastSpace = false;
  }
  if (out.length && out[out.length - 1] === ' ') { out.pop(); map.pop(); }
  return { norm: out.join(''), map };
}

const normalize = (s: string) => normalizeWithMap(s).norm;

/** Split a model quote on ellipses into the verbatim fragments it claims. */
function quoteSegments(quote: string): string[] {
  return quote
    .split(/\.{3,}|\u2026/)
    .map((s) => normalize(s).replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, ''))
    .filter((s) => s.length >= 12);
}

// ─── lexical support ─────────────────────────────────────────────────────────

const STOP = new Set(
  ('the a an and or of to in on for by with at from as is are be been being this that these those it its ' +
    'shall must will may should would can could all any each every such other than into upon under within ' +
    'contractor contractors offeror offerors government bidder vendor provide provides provided submit submits ' +
    'submitted ensure include includes including required requirement requirements comply compliance ' +
    'accordance per specified section sections contract work services service not no if when prior after ' +
    'before during has have had their there them they his her who which what where also only must')
    .split(/\s+/),
);

/** Crude stem: drop common suffixes, then cap at 6 chars (attend ≈ attendance). */
function stem(w: string): string {
  if (/\d/.test(w)) return w;
  return (w.replace(/(ings|ing|ied|ies|ed|es|s)$/, '') || w).slice(0, 6);
}

function contentWords(s: string): string[] {
  return (normalize(s).match(/[a-z0-9$][a-z0-9$.\-/]*[a-z0-9]|[a-z0-9]/g) || [])
    .map((w) => w.replace(/[.\-/]+$/, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stem);
}

/** Share of the requirement's content words that appear in the evidence text. */
export function supportOverlap(requirement: string, evidence: string): number {
  const req = [...new Set(contentWords(requirement))];
  if (req.length === 0) return 1;
  const ev = new Set(contentWords(evidence));
  return req.filter((w) => ev.has(w)).length / req.length;
}

/** Below this share (and fewer than 2 shared words) the quote is not evidence for the row. */
const MIN_SUPPORT = 0.3;

/**
 * Numbers, amounts, dates and clause/section codes the requirement states that its
 * evidence does not contain. A requirement may paraphrase words; it may not add a
 * figure ("within 12 days", "Section 1.5", "$35,000") its evidence does not carry.
 */
export function unsupportedFigures(requirement: string, evidence: string): string[] {
  const clean = (x: string) => x.replace(/,/g, '').replace(/[.:\-/]+$/, '');
  const ev = normalize(evidence).replace(/,/g, '');
  const evSquashed = ev.replace(/ /g, '');
  const figs = normalize(requirement).match(/\$?\d[\d,]*(?:[.:\-/][\da-z]+)*/g) || [];
  return [...new Set(figs.map(clean))].filter((f) => f && !ev.includes(f) && !evSquashed.includes(f));
}

function isSupported(requirement: string, evidence: string): { ok: boolean; overlap: number; figures?: string[] } {
  const figures = unsupportedFigures(requirement, evidence);
  if (figures.length) {
    return { ok: false, overlap: Math.round(supportOverlap(requirement, evidence) * 100) / 100, figures };
  }
  const overlap = supportOverlap(requirement, evidence);
  const reqWords = new Set(contentWords(requirement));
  const shared = [...reqWords].filter((w) => new Set(contentWords(evidence)).has(w)).length;
  return { ok: overlap >= MIN_SUPPORT || shared >= 3, overlap: Math.round(overlap * 100) / 100 };
}

// ─── locating a quote ────────────────────────────────────────────────────────

interface PreparedDoc extends MatrixSourceDoc {
  norm: string;
  map: number[];
  /** `norm` with every space removed ("10:00 EST" ≡ "10:00EST"), mapped to `norm` indices. */
  squashed: string;
  squashMap: number[];
}

function prepare(docs: MatrixSourceDoc[]): PreparedDoc[] {
  return docs.filter((d) => (d.text || '').trim()).map((d) => {
    const { norm, map } = normalizeWithMap(d.text);
    const sq: string[] = [];
    const sqMap: number[] = [];
    for (let i = 0; i < norm.length; i++) if (norm[i] !== ' ') { sq.push(norm[i]); sqMap.push(i); }
    return { ...d, norm, map, squashed: sq.join(''), squashMap: sqMap };
  });
}

/** Find the segments in order in `hay`; returns [start, endExclusive] in hay indices. */
function findInOrder(hay: string, segs: string[]): [number, number] | null {
  let cursor = 0;
  let start = -1;
  for (const s of segs) {
    const at = hay.indexOf(s, cursor);
    if (at < 0) return null;
    if (start < 0) start = at;
    cursor = at + s.length;
  }
  return [start, cursor];
}

function locate(quote: string, docs: PreparedDoc[]): { status: 'verified_exact' | 'verified_normalized' | null; hits: EvidenceLocation[] } {
  const q = quote.trim();
  const exact: EvidenceLocation[] = [];
  for (const d of docs) {
    const at = d.text.indexOf(q);
    if (q.length >= 20 && at >= 0) {
      exact.push({ document_id: d.document_id, filename: d.filename, role: d.role, char_start: at, char_end: at + q.length });
    }
  }
  if (exact.length) return { status: 'verified_exact', hits: exact };

  const segs = quoteSegments(q);
  if (!segs.length || !segs.some((s) => s.length >= 20)) return { status: null, hits: [] };
  const norm: EvidenceLocation[] = [];
  const squashedSegs = segs.map((x) => x.replace(/ /g, ''));
  for (const d of docs) {
    let range = findInOrder(d.norm, segs);
    if (!range) {
      // Whitespace-only difference (the model added/removed a space).
      const sq = findInOrder(d.squashed, squashedSegs);
      if (sq) range = [d.squashMap[sq[0]], d.squashMap[sq[1] - 1] + 1];
    }
    if (range) {
      norm.push({
        document_id: d.document_id, filename: d.filename, role: d.role,
        char_start: d.map[range[0]], char_end: d.map[range[1] - 1] + 1,
      });
    }
  }
  return norm.length ? { status: 'verified_normalized', hits: norm } : { status: null, hits: [] };
}

/** Best single source sentence for a paraphrased quote (≥60% of its content words). */
function bestParaphraseSentence(quote: string, docs: PreparedDoc[]): { loc: EvidenceLocation; sentence: string } | null {
  const qw = [...new Set(contentWords(quote))];
  if (qw.length < 4) return null;
  let best: { score: number; loc: EvidenceLocation; sentence: string } | null = null;
  for (const d of docs) {
    const re = /[^.;:\n]+(?:[.;:](?!\d)|\n|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d.text))) {
      const sentence = m[0].trim();
      if (sentence.length < 20) continue;
      const sw = new Set(contentWords(sentence));
      const score = qw.filter((w) => sw.has(w)).length / qw.length;
      if (!best || score > best.score) {
        const start = m.index + m[0].indexOf(sentence);
        best = { score, sentence, loc: { document_id: d.document_id, filename: d.filename, role: d.role, char_start: start, char_end: start + sentence.length } };
      }
    }
  }
  return best && best.score >= 0.6 ? { loc: best.loc, sentence: best.sentence } : null;
}

// ─── section verification ────────────────────────────────────────────────────

const NON_SECTIONS = /^(unknown|n\/?a|none|null|-|—|not specified|unspecified)$/i;

/** Rough "shape" of a label so a sibling heading of the same kind can be detected. */
function labelShape(label: string): string {
  return label.replace(/[A-Za-z]+/g, 'A').replace(/\d+/g, '9');
}

/**
 * A claimed section is verified only when the DOCUMENT establishes it as the heading
 * enclosing the evidence: the label occurs at the start of a line before the quote,
 * and no sibling heading of the same shape sits between it and the quote (otherwise
 * it is a table-of-contents entry or a different section).
 */
export function sectionEstablished(label: string, doc: MatrixSourceDoc, quoteStart: number): boolean {
  const l = label.trim().replace(/^section\s+/i, '');
  if (!l || NON_SECTIONS.test(l)) return false;
  const esc = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`(?:^|\\n)[ \\t]*(?:section[ \\t]+)?${esc}(?![\\w.])`, 'gi');
  const before = doc.text.slice(0, quoteStart);
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = head.exec(before))) last = m.index;
  if (last < 0) return false;
  const shape = labelShape(l);
  const between = before.slice(last + 1);
  const sibling = /(?:^|\n)[ \t]*(?:section[ \t]+)?([A-Za-z]{0,2}\.?\d+(?:\.\d+)*[A-Za-z]?|[A-Z](?=[ \t]+-))(?![\w.])/g;
  while ((m = sibling.exec(between))) {
    const cand = m[1];
    if (cand.toLowerCase() !== l.toLowerCase() && labelShape(cand) === shape) return false;
  }
  return true;
}

// ─── the gate ────────────────────────────────────────────────────────────────

export interface VerifyMatrixOptions {
  /** True when some documents were unreadable/partial — a missing quote may live there. */
  sourceIncomplete?: boolean;
}

function docMatchesClaim(claim: string, loc: EvidenceLocation): boolean {
  const c = normalize(claim).replace(/[+_]/g, ' ');
  const f = normalize(loc.filename).replace(/[+_]/g, ' ');
  return !!c && (f.includes(c) || c.includes(f) || normalize(loc.document_id) === c);
}

export function verifyComplianceMatrix<T extends CandidateRow>(
  rows: T[],
  docs: MatrixSourceDoc[],
  opts: VerifyMatrixOptions = {},
): MatrixVerificationResult<T> {
  const prepared = prepare(docs);
  const requirements: VerifiedRow<T>[] = [];
  const interpretations: InterpretedRow<T>[] = [];
  const withheld: WithheldRow<T>[] = [];
  const quoteCounts: Partial<Record<QuoteStatus, number>> = {};
  const withheldCounts: Partial<Record<WithheldReason, number>> = {};
  let sectionsWithheld = 0;

  const withhold = (row: T, reason: WithheldReason, v: RowVerification) => {
    withheld.push({ ...row, withheld_reason: reason, verification: v });
    withheldCounts[reason] = (withheldCounts[reason] ?? 0) + 1;
  };

  for (const row of rows) {
    const quote = String(row.source_quote ?? '').trim();
    const claimedSection = String(row.section ?? '').trim();
    const hasSectionClaim = !!claimedSection && !NON_SECTIONS.test(claimedSection);
    const base: RowVerification = {
      quote_status: 'no_source_quote', found_in: [], section_status: hasSectionClaim ? 'withheld_unverified' : 'not_claimed',
      ...(hasSectionClaim ? { section_claimed: claimedSection } : {}), support_overlap: 0, page: null,
    };

    if (!quote) {
      quoteCounts.no_source_quote = (quoteCounts.no_source_quote ?? 0) + 1;
      withhold(row, 'no_source_quote', base);
      continue;
    }

    const found = locate(quote, prepared);
    if (found.status) {
      // A claimed document must be the one holding the evidence.
      const claim = String(row.source_doc ?? '').trim();
      if (claim && !found.hits.some((h) => docMatchesClaim(claim, h))) {
        const v = { ...base, quote_status: 'source_mismatch' as const, found_in: found.hits };
        quoteCounts.source_mismatch = (quoteCounts.source_mismatch ?? 0) + 1;
        withhold(row, 'source_mismatch', v);
        continue;
      }
      quoteCounts[found.status] = (quoteCounts[found.status] ?? 0) + 1;
      const support = isSupported(String(row.requirement ?? ''), quote);
      const sectionOk =
        hasSectionClaim &&
        found.hits.some((h) => {
          const d = prepared.find((p) => p.document_id === h.document_id);
          return !!d && sectionEstablished(claimedSection, d, h.char_start);
        });
      const v: RowVerification = {
        ...base,
        quote_status: found.status,
        found_in: found.hits,
        support_overlap: support.overlap,
        ...(support.figures ? { unsupported_figures: support.figures } : {}),
        section_status: !hasSectionClaim ? 'not_claimed' : sectionOk ? 'verified' : 'withheld_unverified',
        ...(hasSectionClaim && !sectionOk ? { section_claimed: claimedSection } : { section_claimed: undefined }),
      };
      if (v.section_claimed === undefined) delete v.section_claimed;
      if (!support.ok) { withhold(row, 'quote_does_not_support_requirement', v); continue; }
      if (hasSectionClaim && !sectionOk) sectionsWithheld++;
      const { section: _drop, ...rest } = row;
      void _drop;
      const primary = found.hits.find((h) => h.role !== 'notice_description') ?? found.hits[0];
      requirements.push({
        ...(rest as Omit<T, 'section'>),
        ...(sectionOk ? { section: claimedSection } : {}),
        source_doc: primary.filename,
        verification: v,
      });
      continue;
    }

    // Not in the source. A paraphrase with a clearly-matching sentence becomes an
    // INTERPRETATION carrying the real sentence; anything else is withheld.
    const para = bestParaphraseSentence(quote, prepared);
    if (para) {
      const support = isSupported(String(row.requirement ?? ''), para.sentence);
      const d = prepared.find((p) => p.document_id === para.loc.document_id)!;
      const sectionOk = hasSectionClaim && sectionEstablished(claimedSection, d, para.loc.char_start);
      const v: RowVerification = {
        ...base, quote_status: 'paraphrase', found_in: [para.loc], support_overlap: support.overlap,
        ...(support.figures ? { unsupported_figures: support.figures } : {}),
        section_status: !hasSectionClaim ? 'not_claimed' : sectionOk ? 'verified' : 'withheld_unverified',
      };
      if (sectionOk) delete v.section_claimed;
      quoteCounts.paraphrase = (quoteCounts.paraphrase ?? 0) + 1;
      if (!support.ok) { withhold(row, 'quote_does_not_support_requirement', v); continue; }
      if (hasSectionClaim && !sectionOk) sectionsWithheld++;
      const { section: _s, source_quote: _q, ...rest } = row;
      void _s; void _q;
      interpretations.push({
        ...(rest as Omit<T, 'section' | 'source_quote'>),
        ...(sectionOk ? { section: claimedSection } : {}),
        source_evidence: para.sentence,
        model_paraphrase: quote,
        source_doc: para.loc.filename,
        verification: v,
      });
      continue;
    }

    const reason: WithheldReason = opts.sourceIncomplete ? 'source_unavailable' : 'unverifiable';
    quoteCounts[reason] = (quoteCounts[reason] ?? 0) + 1;
    withhold(row, reason, { ...base, quote_status: reason });
  }

  return {
    requirements,
    interpretations,
    withheld,
    summary: {
      method: 'deterministic_source_text_match',
      candidates_total: rows.length,
      requirements_verified: requirements.length,
      interpretations: interpretations.length,
      candidates_withheld: withheld.length,
      withheld_by_reason: withheldCounts,
      sections_withheld: sectionsWithheld,
      quote_status_counts: quoteCounts,
    },
  };
}
