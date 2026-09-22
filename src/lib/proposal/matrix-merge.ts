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
 *  2. Obligation identity: overlapping verified evidence forms the candidate set;
 *     the finest single window reading decides how many obligations it holds (see
 *     dedupe). Similar wording on different evidence is never merged, and no
 *     wording-similarity threshold decides identity.
 *  3. Amendment identity: a row read from an amendment is never merged into a
 *     base-document row, even when the text is identical.
 */
import {
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


type Evidenced = Windowed & { verification: { found_in: EvidenceLocation[] }; source_quote?: string };

/** Content words + normalized figures of a string (for WORDING CHOICE only, never identity). */
function facts(s: string): Set<string> {
  const figs = (s.match(/\$?\d[\d,]*(\.\d+)?%?/g) || []).map((f) => f.replace(/[$,%]/g, '').replace(/\.0+$/, ''));
  const words = (s.toLowerCase().match(/[a-z][a-z-]{2,}/g) || []).filter((w) => !STOP_WORDS.has(w));
  return new Set([...figs, ...words]);
}
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'shall', 'must', 'will', 'are', 'any', 'all', 'from', 'its', 'such', 'per']);
/** How many of the requirement's facts its own verified quote carries — the fuller faithful reading wins. */
const grounded = (r: Evidenced) => {
  const q = facts(String(r.source_quote ?? ''));
  return [...facts(String(r.requirement ?? ''))].filter((f) => q.has(f)).length;
};

export interface Provenance { document_id: string; filename: string; window_id: string; char_start: number; char_end: number }

/**
 * OBLIGATION IDENTITY (production dedupe failure, 2026-09-22).
 *
 *  1. SOURCE EVIDENCE forms the candidate set: rows whose verified ranges overlap (≥50% of the
 *     shorter span, same document) are one evidence cluster.
 *  2. The OBLIGATION COUNT of a cluster is its finest single reading: the window that emitted
 *     the MOST rows for that evidence. Splitting a compound sentence into several obligations is
 *     done inside one window (the prompt instructs it); a second window re-reading the same text
 *     adds a duplicate reading, never extra obligations. Rows from other windows fold into the
 *     survivors — their wording kept as `merged_readings`, their location as `provenance`.
 *     No wording-similarity threshold decides identity.
 *  3. Within ONE window, rows on shared evidence are the model's own split and are kept, except
 *     an exact restatement (same quote + same reading), which is a repeat, not a split.
 *  4. Cross-document: rows read from different documents fold only when one is the notice body
 *     (a representation of the package, not a separate contractual instrument) and neither is an
 *     amendment/Q&A. Two contractual documents that copy a clause stay separate.
 *  Among windows that tie on row count, the reading whose requirement carries more facts from
 *  its own verified quote is kept (a wording choice among duplicates, not an identity test).
 */
function dedupe<T extends Evidenced>(
  rows: T[],
  changeDocs: Set<string>,
  representationDocs: Set<string>,
): { kept: T[]; merged: number } {
  const winDoc = (r: T) => r.extraction_window?.document_id ?? '';
  const winId = (r: T) => r.extraction_window?.window_id ?? `row:${rows.indexOf(r)}`;
  const mayFold = (a: T, b: T) => {
    const da = winDoc(a), db = winDoc(b);
    if (da === db) return true;
    if (changeDocs.has(da) || changeDocs.has(db)) return false;
    return representationDocs.has(da) || representationDocs.has(db);
  };
  const shares = (a: T, b: T) => a.verification.found_in.some((x) => b.verification.found_in.some((y) => overlaps(x, y)));

  // 1. evidence clusters (union-find over overlapping verified ranges, subject to the doc guard)
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (winId(rows[i]) !== winId(rows[j]) && shares(rows[i], rows[j]) && mayFold(rows[i], rows[j])) parent[find(j)] = find(i);
    else if (winId(rows[i]) === winId(rows[j]) && shares(rows[i], rows[j])) parent[find(j)] = find(i);
  }
  const clusters = new Map<number, T[]>();
  rows.forEach((r, i) => { const k = find(i); clusters.set(k, [...(clusters.get(k) ?? []), r]); });

  const keep = new Set<T>();
  let merged = 0;
  for (const members of clusters.values()) {
    // 3. exact restatements inside a window are repeats
    const seen = new Set<string>();
    const distinct = members.filter((r) => {
      const k = `${winId(r)}|${String(r.source_quote ?? '').replace(/\s+/g, ' ').toLowerCase()}|${String(r.requirement ?? '').replace(/\s+/g, ' ').toLowerCase().replace(/[.\s]+$/, '')}`;
      if (seen.has(k)) { merged++; return false; }
      seen.add(k); return true;
    });
    // 2. the finest single reading
    const byWindow = new Map<string, T[]>();
    for (const r of distinct) byWindow.set(winId(r), [...(byWindow.get(winId(r)) ?? []), r]);
    const ranked = [...byWindow.values()].sort((a, b) =>
      b.length - a.length ||
      b.reduce((n, r) => n + grounded(r), 0) - a.reduce((n, r) => n + grounded(r), 0) ||
      rows.indexOf(a[0]) - rows.indexOf(b[0]));
    const [survivors, ...folded] = ranked;
    for (const r of survivors) keep.add(r);
    for (const group of folded) for (const r of group) {
      merged++;
      // fold into the survivor sharing the most evidence with it
      const target = survivors.find((s) => shares(s, r)) ?? survivors[0];
      const t = target as T & { merged_readings?: string[]; provenance?: Provenance[] };
      t.merged_readings = [...(t.merged_readings ?? []), String(r.requirement ?? '')];
      t.provenance = [...(t.provenance ?? provenanceOf(target)), ...provenanceOf(r)];
      // Preserve a section only when the gate verified it at the SAME location the survivor
      // cites (identical document + range) — never onto merely overlapping evidence.
      const [ta] = provenanceOf(target); const [ra] = provenanceOf(r);
      if (!(t as { section?: string }).section && (r as { section?: string }).section && ta && ra &&
          ta.document_id === ra.document_id && ta.char_start === ra.char_start && ta.char_end === ra.char_end) {
        (t as { section?: string }).section = (r as { section?: string }).section;
      }
    }
  }
  return { kept: rows.filter((r) => keep.has(r)), merged };
}

/** The window-anchored evidence location(s) of a row, as customer-visible provenance. */
function provenanceOf(r: Evidenced): Provenance[] {
  const w = r.extraction_window;
  const a = anchorInWindow(r.verification.found_in, w) ?? r.verification.found_in[0];
  return a ? [{ document_id: a.document_id, filename: a.filename, window_id: w?.window_id ?? '', char_start: a.char_start, char_end: a.char_end }] : [];
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
  /** Documents that REPRESENT the package (the notice body), not separate contractual instruments. */
  representationDocs: Set<string> = new Set(['notice_description', 'notice_sow']),
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

  const copy = <R>(rows: R[]) => rows.map((r) => ({ ...r }));
  const req = dedupe(copy(byPos(keepChangeIdentity(keepInWindow(verified.requirements as unknown as Evidenced[])))) as unknown as VerifiedRow<T>[] & Evidenced[], changeDocs, representationDocs);
  const itp = dedupe(copy(byPos(keepChangeIdentity(keepInWindow(verified.interpretations as unknown as Evidenced[])))) as unknown as InterpretedRow<T>[] & Evidenced[], changeDocs, representationDocs);

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
