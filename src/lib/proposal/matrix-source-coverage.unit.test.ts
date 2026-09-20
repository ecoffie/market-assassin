import { describe, it, expect } from 'vitest';
import { prioritizeExtractionWindows } from '@/lib/proposal/compliance-matrix';
import { auditSourceSpecCoverage } from '@/lib/proposal/matrix-source-coverage';

describe('matrix source-spec coverage — missing requirements, not row count', () => {
  const section3 = [
    'Section 3.0 Technical Specifications',
    'The craft LOA shall be 85 to 95 feet.',
    'A flight deck is required for unmanned aircraft.',
    'The vessel shall include a SCIF.',
    'Crew berthing for 12 personnel.',
    'A magazine for small-arms storage.',
    'Refueler and fuel storage tanks.',
  ].join('\n');

  it('flags LOA, flight deck, SCIF, berthing, and magazine when they are in source but not extracted', () => {
    const coverage = auditSourceSpecCoverage(section3, [
      { requirement: 'Provide a refueler system', source_quote: 'Refueler and fuel storage tanks.' },
      { requirement: 'Provide fuel storage', source_quote: 'fuel storage tanks' },
    ]);
    expect(coverage.present_in_source).toEqual([
      'loa_range', 'flight_deck', 'scif', 'berthing', 'magazine',
    ]);
    expect(coverage.extracted).toEqual([]);
    expect(coverage.missing_from_matrix).toEqual([
      'loa_range', 'flight_deck', 'scif', 'berthing', 'magazine',
    ]);
  });

  it('does not invent a miss for a spec the source never stated', () => {
    const coverage = auditSourceSpecCoverage(
      'Section L. Offerors shall submit a technical volume.',
      [{ requirement: 'Submit a technical volume', source_quote: 'submit a technical volume' }],
    );
    expect(coverage.present_in_source).toEqual([]);
    expect(coverage.missing_from_matrix).toEqual([]);
  });

  it('treats a named spec as extracted when any row quotes it', () => {
    const coverage = auditSourceSpecCoverage(section3, [
      { requirement: 'LOA 85-95 ft', source_quote: 'The craft LOA shall be 85 to 95 feet.' },
      { requirement: 'Flight deck for UAS', source_quote: 'A flight deck is required' },
      { requirement: 'Include a SCIF', source_quote: 'The vessel shall include a SCIF.' },
      { requirement: 'Berthing for 12', source_quote: 'Crew berthing for 12 personnel.' },
      { requirement: 'Small-arms magazine', source_quote: 'A magazine for small-arms storage.' },
    ]);
    expect(coverage.missing_from_matrix).toEqual([]);
    expect(coverage.extracted).toHaveLength(5);
  });
});

describe('prioritizeExtractionWindows keeps Section 3.0 off the truncation floor', () => {
  it('keeps a late Section 3.0 window when the file exceeds the cap', () => {
    const front = 'Section L instructions\n'.repeat(4000);
    const spec = 'Section 3.0 Technical Specifications\nThe craft LOA shall be 85 feet.\nA flight deck is required.\n';
    const text = `${front}\n${spec}`;
    expect(text.length).toBeGreaterThan(50_000);
    const w = prioritizeExtractionWindows(text, 50_000);
    expect(w.truncated).toBe(true);
    expect(w.kept_section_3).toBe(true);
    expect(w.text).toMatch(/SECTION 3\.0 WINDOW/);
    expect(w.text).toMatch(/LOA/);
    expect(w.text).toMatch(/flight deck/i);
    expect(w.text.length).toBeLessThanOrEqual(50_000 + 80);
  });
});
