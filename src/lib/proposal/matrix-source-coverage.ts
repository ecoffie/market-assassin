/**
 * Completeness of a compliance matrix is coverage of named specs that
 * exist in the SOURCE — not the row count.
 *
 * Round 2 (notice 6552b25b…): 25 extracted rows vs 28 from pasted text.
 * The gap was LOA range, flight deck, SCIF, berthing, magazine — all in
 * Section 3.0, none in the matrix. Counting 25 as "fixed" hid that miss.
 *
 * SCIF omission (2026-09-20): the RFI states "Notional 750 sq ft SCIF"
 * without shall/must. The LLM skips notional capability lines. Recovery
 * injects a technical row from the source sentence so coverage is not
 * luck-dependent.
 */

export interface SourceSpecAnchor {
  id: string;
  label: string;
  patterns: RegExp[];
}

/** Distinctive Section 3.0 technical specs. Only scored when present in source. */
export const SOURCE_SPEC_ANCHORS: SourceSpecAnchor[] = [
  { id: 'loa_range', label: 'LOA range', patterns: [/\bLOA\b/, /length overall/i] },
  { id: 'flight_deck', label: 'flight deck', patterns: [/flight\s*decks?/i] },
  { id: 'scif', label: 'SCIF', patterns: [/\bSCIF\b/i] },
  { id: 'berthing', label: 'berthing', patterns: [/\bberthing\b/i] },
  { id: 'magazine', label: 'magazine', patterns: [/\bmagazines?\b/i] },
];

export interface SourceSpecCoverage {
  present_in_source: string[];
  extracted: string[];
  missing_from_matrix: string[];
}

export function auditSourceSpecCoverage(
  sourceText: string,
  requirements: Array<{ requirement?: string; source_quote?: string }>,
  anchors: SourceSpecAnchor[] = SOURCE_SPEC_ANCHORS,
): SourceSpecCoverage {
  const blob = requirements
    .map((r) => `${r.requirement || ''} ${r.source_quote || ''}`)
    .join('\n');
  const present_in_source: string[] = [];
  const extracted: string[] = [];
  const missing_from_matrix: string[] = [];
  for (const a of anchors) {
    if (!a.patterns.some((p) => p.test(sourceText))) continue;
    present_in_source.push(a.id);
    if (a.patterns.some((p) => p.test(blob))) extracted.push(a.id);
    else missing_from_matrix.push(a.id);
  }
  return { present_in_source, extracted, missing_from_matrix };
}

/** Pull the sentence/clause that mentions an anchor from the source text. */
export function extractAnchorSentence(sourceText: string, anchor: SourceSpecAnchor): string | null {
  const text = sourceText || '';
  let bestIdx = -1;
  for (const p of anchor.patterns) {
    const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`);
    const m = re.exec(text);
    if (m && m.index !== undefined && (bestIdx < 0 || m.index < bestIdx)) bestIdx = m.index;
  }
  if (bestIdx < 0) return null;

  // Prefer the line / bullet the match sits on (RFIs are often newline-separated).
  const lineStart = text.lastIndexOf('\n', bestIdx) + 1;
  const lineEndRaw = text.indexOf('\n', bestIdx);
  const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
  let sentence = text.slice(lineStart, lineEnd).replace(/\s+/g, ' ').trim();

  // If the line is a bare heading, widen to nearby context.
  if (sentence.length < 24 || !anchor.patterns.some((p) => p.test(sentence))) {
    const start = Math.max(0, bestIdx - 120);
    const end = Math.min(text.length, bestIdx + 180);
    sentence = text.slice(start, end).replace(/\s+/g, ' ').trim();
  }
  // Strip HTML entities left in SAM bodies.
  sentence = sentence
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  if (!anchor.patterns.some((p) => p.test(sentence))) return null;
  return sentence.slice(0, 280);
}

export interface RecoveredSourceSpec {
  id: string;
  requirement: string;
  category: 'technical';
  section: string;
  source_quote: string;
  recovered_from_source: true;
}

/**
 * Deterministic fill for named specs the LLM skipped. Uses the source sentence
 * as evidence — never invents a facility the RFP did not mention.
 */
export function recoverMissingSourceSpecs<
  T extends { requirement?: string; source_quote?: string; id?: string; category?: string; section?: string },
>(
  sourceText: string,
  requirements: T[],
  anchors: SourceSpecAnchor[] = SOURCE_SPEC_ANCHORS,
): { requirements: Array<T | RecoveredSourceSpec>; recovered_ids: string[] } {
  const coverage = auditSourceSpecCoverage(sourceText, requirements, anchors);
  if (coverage.missing_from_matrix.length === 0) {
    return { requirements, recovered_ids: [] };
  }

  const out: Array<T | RecoveredSourceSpec> = [...requirements];
  const recovered_ids: string[] = [];
  for (const id of coverage.missing_from_matrix) {
    const anchor = anchors.find((a) => a.id === id);
    if (!anchor) continue;
    const sentence = extractAnchorSentence(sourceText, anchor);
    if (!sentence) continue;
    recovered_ids.push(id);
    out.push({
      id: `RECOVERED-${id}`,
      requirement: `Address the ${anchor.label} capability stated in the solicitation: ${sentence}`,
      category: 'technical',
      section: '3.0',
      source_quote: sentence,
      recovered_from_source: true,
    });
  }
  return { requirements: out, recovered_ids };
}
