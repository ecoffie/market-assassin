/**
 * Compliance-matrix MERGE + DEDUPE (Poteto "Compliance Matrix Completeness").
 *
 * Runs AFTER the frozen truth gate (matrix-verification.ts), on rows that already
 * carry verified evidence locations. Identity is EVIDENCE — a character range in a
 * named document — never model text and never model ids (ids are re-issued per
 * window, so "REQ-004" from window 3 and window 7 are unrelated).
 *
 *  1. Window provenance: a trusted row's evidence must lie inside the window the
 *     model was actually reading. A quote that exists in the document but outside
 *     that window was produced from memory (FAR boilerplate is well known to
 *     models) — it is withheld as source_mismatch, never trusted.
 *  2. Same obligation ⇔ overlapping verified evidence AND the same reading.
 *     Overlapping windows rediscover a requirement; those collapse. Two rows that
 *     cite the same sentence but state different obligations (a compound "shall"
 *     split into rows) are BOTH kept. Similar wording on different evidence is
 *     never merged.
 *  3. Amendment identity: a row read from an amendment is never merged into a
 *     base-document row, even when the text is identical.
 */
import {
  supportOverlap,
  type EvidenceLocation,
  type InterpretedRow,
  type VerifiedRow,
  type WithheldRow,
} from '@/lib/proposal/matrix-verification';

export interface WindowRef {
  window_id: string;
  document_id: string;
  char_start: number;
  char_end: number;
}
type Windowed = { extraction_window?: WindowRef; requirement?: string; id?: string };

/** Rows on the same evidence state the same obligation when each reading covers the other. */
export const SAME_READING = 0.6;

const overlaps = (a: EvidenceLocation, b: EvidenceLocation) => {
  if (a.document_id !== b.document_id) return false;
  const inter = Math.min(a.char_end, b.char_end) - Math.max(a.char_start, b.char_start);
  const shorter = Math.min(a.char_end - a.char_start, b.char_end - b.char_start);
  return inter > 0 && inter >= 0.5 * shorter;
};

/** The evidence hit inside the row's own window (null → produced outside what it read). */
export function anchorInWindow(found: EvidenceLocation[], w?: WindowRef): EvidenceLocation | null {
  if (!w) return found[0] ?? null; // rows with no window (rfp recovery) anchor on first hit
  return found.find((h) => h.document_id === w.document_id && h.char_start < w.char_end && h.char_end > w.char_start) ?? null;
}

export function sameReading(a: string, b: string): boolean {
  return Math.min(supportOverlap(a, b), supportOverlap(b, a)) >= SAME_READING;
}

type Evidenced = Windowed & { verification: { found_in: EvidenceLocation[] } };

function dedupe<T extends Evidenced>(
  rows: T[],
  changeDocs: Set<string>,
): { kept: T[]; merged: number } {
  const kept: T[] = [];
  let merged = 0;
  for (const r of rows) {
    const rDoc = r.extraction_window?.document_id;
    const dup = kept.find((k) => {
      const kDoc = k.extraction_window?.document_id;
      if (kDoc !== rDoc && ((kDoc && changeDocs.has(kDoc)) || (rDoc && changeDocs.has(rDoc)))) return false;
      const shared = k.verification.found_in.some((a) => r.verification.found_in.some((b) => overlaps(a, b)));
      return shared && sameReading(String(k.requirement ?? ''), String(r.requirement ?? ''));
    });
    if (dup) merged++;
    else kept.push(r);
  }
  return { kept, merged };
}

export interface MergeSummary {
  /** Candidates collapsed because another window already produced the same obligation. */
  duplicates_merged: number;
  /** Trusted/interpreted rows withheld because their evidence lay outside the window read. */
  outside_window_withheld: number;
}

/**
 * Apply window provenance, dedupe by evidence, order rows by (document, position) and
 * re-issue stable ids. `docOrder` = document ids in package order.
 */
export function mergeVerifiedByEvidence<T extends Windowed>(
  verified: {
    requirements: VerifiedRow<T>[];
    interpretations: InterpretedRow<T>[];
    withheld: WithheldRow<T>[];
  },
  docOrder: string[],
  changeDocs: Set<string> = new Set(),
): {
  requirements: VerifiedRow<T>[];
  interpretations: InterpretedRow<T>[];
  withheld: WithheldRow<T>[];
  summary: MergeSummary;
} {
  const withheld = [...verified.withheld];
  let outside = 0;
  const keepInWindow = <R extends Evidenced>(rows: R[]): R[] =>
    rows.filter((r) => {
      if (anchorInWindow(r.verification.found_in, r.extraction_window)) return true;
      outside++;
      withheld.push({
        ...(r as unknown as T),
        withheld_reason: 'source_mismatch',
        verification: { ...(r.verification as WithheldRow<T>['verification']), quote_status: 'source_mismatch' },
      } as WithheldRow<T>);
      return false;
    });

  const pos = (r: Evidenced) => {
    const a = anchorInWindow(r.verification.found_in, r.extraction_window) ?? r.verification.found_in[0];
    const d = docOrder.indexOf(a?.document_id ?? '');
    return [d < 0 ? docOrder.length : d, a?.char_start ?? 0] as const;
  };
  const byPos = <R extends Evidenced>(rows: R[]) =>
    [...rows].sort((x, y) => { const [a, b] = pos(x); const [c, d] = pos(y); return a - c || b - d; });

  // The gate labels a row with the FIRST attachment holding its quote. An amendment that
  // reprints base language would then read as a base row — amendment identity lost. A row
  // read from an amendment/Q&A window whose evidence verifies INSIDE that window keeps the
  // amendment as its source_doc (derived from verified evidence, never the model's claim).
  const keepChangeIdentity = <R extends Evidenced & { source_doc?: string }>(rows: R[]): R[] =>
    rows.map((r) => {
      const w = r.extraction_window;
      if (!w || !changeDocs.has(w.document_id)) return r;
      const a = anchorInWindow(r.verification.found_in, w);
      return a ? { ...r, source_doc: a.filename } : r;
    });

  const req = dedupe(byPos(keepChangeIdentity(keepInWindow(verified.requirements as unknown as Evidenced[]))) as unknown as VerifiedRow<T>[] & Evidenced[], changeDocs);
  const itp = dedupe(byPos(keepChangeIdentity(keepInWindow(verified.interpretations as unknown as Evidenced[]))) as unknown as InterpretedRow<T>[] & Evidenced[], changeDocs);

  // Withheld rows have no evidence to dedupe on; collapse only exact repeats of the
  // same candidate (same quote + same reading) that overlapping windows produced.
  const seen = new Set<string>();
  const wh = withheld.filter((w) => {
    const k = `${String((w as { source_quote?: string }).source_quote ?? '').replace(/\s+/g, ' ').toLowerCase()}|${String(w.requirement ?? '').replace(/\s+/g, ' ').toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // One id sequence across all three lists, in document order, so an id is unique
  // in the response (as before) and stable for a given package + extraction.
  // A withheld row with located evidence sorts at that evidence; one with NO located
  // evidence has no position in the document, so it follows every located row.
  const whPos = (w: Windowed & { verification?: { found_in?: EvidenceLocation[] } }) => {
    const a = w.verification?.found_in?.[0];
    if (!a) {
      const d = docOrder.indexOf(w.extraction_window?.document_id ?? '');
      return [docOrder.length + 1 + (d < 0 ? docOrder.length : d), w.extraction_window?.char_start ?? 0] as const;
    }
    const d = docOrder.indexOf(a.document_id);
    return [d < 0 ? docOrder.length : d, a.char_start] as const;
  };
  const tagged = [
    ...(req.kept as VerifiedRow<T>[]).map((r) => ({ r, list: 0, p: pos(r as unknown as Evidenced) })),
    ...(itp.kept as InterpretedRow<T>[]).map((r) => ({ r, list: 1, p: pos(r as unknown as Evidenced) })),
    ...wh.map((r) => ({ r, list: 2, p: whPos(r as never) })),
  ].sort((x, y) => x.p[0] - y.p[0] || x.p[1] - y.p[1] || x.list - y.list);
  const ided = tagged.map((t, i) => ({ list: t.list, r: { ...t.r, id: `REQ-${String(i + 1).padStart(3, '0')}` } }));
  const pick = <R>(list: number) => ided.filter((t) => t.list === list).map((t) => t.r as unknown as R);
  return {
    requirements: pick<VerifiedRow<T>>(0),
    interpretations: pick<InterpretedRow<T>>(1),
    withheld: pick<WithheldRow<T>>(2),
    summary: { duplicates_merged: req.merged + itp.merged + (withheld.length - wh.length), outside_window_withheld: outside },
  };
}
