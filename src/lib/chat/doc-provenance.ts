/**
 * Source provenance for create_document (Design & Output request, approved by Agent 4, 2026-11-23): every DocSource
 * shows when its record was read, and its link or record id, and the document's subtitle names the data date, all
 * taken from THIS conversation's tool results, never written by the model.
 *
 * Rules (each is tested):
 *   - A DocSource is matched to a tool result by its url (normalized) or its recordId (a record key, notice id or
 *     document id the tool result carried). No match means nothing is filled: nothing is constructed or guessed.
 *   - retrievedAt comes from the matched result's read time (the tool-run time, or the signed ledger entry from an
 *     earlier turn). A model-written date that disagrees with it is replaced; one with no match is left as is.
 *   - url / recordId are copied from the match only when the model left them empty, and only when the match has
 *     exactly one of them (an ambiguous match fills nothing).
 *   - The subtitle is set only when the model left it empty, from the matched results' own as-of dates
 *     ("Data as of 2026-11-20", or "Data as of 2026-09-30 to 2026-11-20" when they differ). No as-of date in the
 *     evidence → no subtitle. The source system is not inferred.
 *   - The answer text and the document's statements are never touched.
 */
import type { DocModel, DocSource } from '@/lib/documents/model';

export interface ProvenanceRecord {
  /** When the tool result was read (ISO). */
  retrievedAt: string;
  /** The data date the tool result itself reported, when it did (ISO or YYYY-MM-DD). */
  asOf?: string | null;
  /** A single canonical link for the record, when the tool result had one. */
  url?: string | null;
  /** Record keys the result carried: notice ids, PIIDs, document ids, ledger item keys. */
  recordIds?: readonly string[];
}

export interface ApplyProvenanceResult {
  model: DocModel;
  filledRetrievedAt: number;
  replacedRetrievedAt: number;
  filledUrl: number;
  filledRecordId: number;
  unmatched: number;
  subtitleSet: boolean;
}

const dateOnly = (s: string | null | undefined) => {
  const m = String(s ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
const normUrl = (u: string | null | undefined) =>
  String(u ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const normId = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function matchesFor(src: DocSource, records: readonly ProvenanceRecord[]): ProvenanceRecord[] {
  const u = normUrl(src.url);
  const id = normId(src.recordId);
  return records.filter((r) => {
    if (u && r.url && normUrl(r.url) === u) return true;
    if (id && id.length >= 4) {
      if ((r.recordIds ?? []).some((k) => normId(k) === id)) return true;
      if (r.url && normUrl(r.url).toUpperCase().replace(/[^A-Z0-9]/g, '').includes(id)) return true;
    }
    if (u && !id && (r.recordIds ?? []).some((k) => normId(k).length >= 6 && u.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(normId(k)))) return true;
    return false;
  });
}

/** Fill DocSource provenance and the data-date subtitle from tool-result records. Pure; never mutates its input. */
export function applySourceProvenance(model: DocModel, records: readonly ProvenanceRecord[]): ApplyProvenanceResult {
  const out: ApplyProvenanceResult = { model, filledRetrievedAt: 0, replacedRetrievedAt: 0, filledUrl: 0, filledRecordId: 0, unmatched: 0, subtitleSet: false };
  if (!model || !Array.isArray(model.sources) || !records.length) return out;
  const usedAsOf: string[] = [];
  const sources = model.sources.map((src) => {
    const m = matchesFor(src, records);
    if (!m.length) { out.unmatched += 1; return src; }
    const next: DocSource = { ...src };
    // Read time: the latest read among the matches (the record as the document saw it).
    const read = m.map((r) => dateOnly(r.retrievedAt)).filter((d): d is string => !!d).sort().pop() ?? null;
    if (read) {
      if (!next.retrievedAt) { next.retrievedAt = read; out.filledRetrievedAt += 1; }
      else if (dateOnly(next.retrievedAt) !== read) { next.retrievedAt = read; out.replacedRetrievedAt += 1; }
    }
    const urls = [...new Set(m.map((r) => r.url).filter((x): x is string => !!x))];
    if (!next.url && urls.length === 1) { next.url = urls[0]; out.filledUrl += 1; }
    const ids = [...new Set(m.flatMap((r) => r.recordIds ?? []).filter(Boolean))];
    if (!next.recordId && ids.length === 1) { next.recordId = ids[0]; out.filledRecordId += 1; }
    for (const r of m) { const d = dateOnly(r.asOf); if (d) usedAsOf.push(d); }
    return next;
  });
  let subtitle = model.subtitle;
  if (!subtitle?.trim() && usedAsOf.length) {
    // A range when the matched results disagree: the latest date alone would overstate how current the older data is.
    const dates = [...new Set(usedAsOf)].sort();
    subtitle = dates.length === 1 ? `Data as of ${dates[0]}` : `Data as of ${dates[0]} to ${dates[dates.length - 1]}`;
    out.subtitleSet = true;
  }
  out.model = { ...model, sources, ...(subtitle ? { subtitle } : {}) };
  return out;
}

/** Minimal shapes of a turn source and a verified ledger entry (context-sources.ts), for provenance only. */
interface TurnSourceLike { status: string; retrievedAt: string; asOf?: string | null; ref?: { url?: string; noticeId?: string; documentId?: string }; items?: ReadonlyArray<{ key: string }> }
interface LedgerEntryLike { status: string; retrievedAt: string; asOf?: string | null; items?: ReadonlyArray<{ key: string }> }

/**
 * Provenance records from THIS turn's tool results and the signed ledgers of earlier turns (already verified by
 * parseLedger). Only results that returned data count; an empty or failed result proves nothing about a record.
 */
export function provenanceRecords(turnSources: readonly TurnSourceLike[], priorLedgerEntries: readonly LedgerEntryLike[]): ProvenanceRecord[] {
  const ok = (s: string) => s === 'ok' || s === 'truncated';
  const fromTurn = turnSources.filter((s) => ok(s.status) && s.retrievedAt).map((s) => ({
    retrievedAt: s.retrievedAt,
    asOf: s.asOf ?? null,
    url: s.ref?.url ?? null,
    recordIds: [s.ref?.noticeId, s.ref?.documentId, ...(s.items ?? []).map((i) => i.key)].filter((x): x is string => !!x),
  }));
  const fromLedger = priorLedgerEntries.filter((e) => ok(e.status) && e.retrievedAt).map((e) => ({
    retrievedAt: e.retrievedAt,
    asOf: e.asOf ?? null,
    url: null,
    recordIds: (e.items ?? []).map((i) => i.key).filter(Boolean),
  }));
  return [...fromTurn, ...fromLedger];
}
