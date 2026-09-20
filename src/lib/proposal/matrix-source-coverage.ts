/**
 * Completeness of a compliance matrix is coverage of named specs that
 * exist in the SOURCE — not the row count.
 *
 * Round 2 (notice 6552b25b…): 25 extracted rows vs 28 from pasted text.
 * The gap was LOA range, flight deck, SCIF, berthing, magazine — all in
 * Section 3.0, none in the matrix. Counting 25 as "fixed" hid that miss.
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
