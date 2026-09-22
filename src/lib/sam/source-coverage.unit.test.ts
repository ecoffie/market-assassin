/**
 * A derived artifact must disclose what its SOURCE was missing.
 *
 * THE DEFECT this guards: `extract_compliance_matrix` returned a matrix built
 * from a partially-read solicitation with no signal that whole sections were
 * never in the input. Observed downstream: requirement rows citing a
 * "Section L.3.2" and a 25-page Past Performance volume on DLA SPE60525R0222 —
 * a FAR Part 12 commercial-item buy that HAS no Section L. Given truncated
 * input and no coverage signal, the model supplied plausible federal boilerplate.
 *
 * The invariant: when coverage is incomplete, the caveat must state that the
 * unread portions are UNKNOWN rather than absent.
 */
import { describe, it, expect } from 'vitest';
import { summarizeSourceCoverage, coverageCaveat } from './source-coverage';
import type { SolicitationDocumentsResult } from './solicitation-documents';

function doc(id: string, filename: string, availability: string) {
  return {
    filename,
    document_id: id,
    text_availability: availability,
    doc_kind: null, mime_type: null, page_count: null, char_count: 10,
    extracted_text: '', extracted_text_truncated: false, extraction_capped: false,
    extraction_quality: 'ok', text_readable_ratio: 1,
    download_url: null, download_source: null,
    text_window: { offset: 0, returned_chars: 10, total_chars: 10, next_offset: null, has_more: false, coverage_of_stored_text: 1 },
  };
}
const result = (docs: unknown[]) => ({ documents: docs } as unknown as SolicitationDocumentsResult);

describe('source coverage', () => {
  it('all-complete reports complete and emits NO caveat', () => {
    const c = summarizeSourceCoverage(result([doc('a', 'RFP.pdf', 'complete')]));
    expect(c.complete).toBe(true);
    expect(coverageCaveat(c)).toBeNull();
  });

  it('a partial read is disclosed as UNKNOWN, not absent', () => {
    const c = summarizeSourceCoverage(result([doc('a', 'RFP.pdf', 'partial'), doc('b', 'X.pdf', 'complete')]));
    expect(c.complete).toBe(false);
    expect(c.documents_partial).toBe(1);
    const caveat = coverageCaveat(c)!;
    expect(caveat).toMatch(/UNKNOWN, not absent/);
    expect(caveat).toContain('RFP.pdf');
  });

  it('unusable text counts as a gap, never as delivered content', () => {
    // A portfolio stub and mojibake are NON-EMPTY but are not the document.
    const c = summarizeSourceCoverage(
      result([doc('a', 'CQAP.pdf', 'container_stub'), doc('b', 'Amd0003.pdf', 'unreadable_encoding')]),
    );
    expect(c.documents_unreadable).toBe(2);
    expect(c.complete).toBe(false);
    expect(coverageCaveat(c)).toContain('no usable text');
  });

  it('capped extraction is a gap — paging cannot recover the file tail', () => {
    const c = summarizeSourceCoverage(result([doc('a', 'Schedule.pdf', 'extraction_capped')]));
    expect(c.complete).toBe(false);
    expect(c.documents_partial).toBe(1);
  });

  it('an empty document list is not "complete" — nothing was read', () => {
    const c = summarizeSourceCoverage(result([]));
    expect(c.complete).toBe(false);
  });
});
