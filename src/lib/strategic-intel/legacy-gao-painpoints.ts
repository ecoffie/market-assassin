/**
 * The 278 "(Source: GAO)" pain points in src/data/agency-pain-points.json — the
 * reproducible definition of that set, and the match back to the GovInfo rows
 * they were copied from.
 *
 * WHY THIS EXISTS (Data Core audit, 2026-11-17).
 * Every pain point in the served JSON that ends with the bare tag "(Source: GAO)"
 * traces to a GovInfo GAOREPORTS document published 1993-2000. They reached the
 * JSON through `scripts/merge-agency-intelligence.js`, which copied
 * `agency_intelligence` rows of type `gao_high_risk` (stamped fiscal_year=2026 —
 * the FETCH year, not the government's date). Some are filed under the wrong
 * agency, e.g. an NLRB strategic-plan testimony under Veterans Affairs.
 *
 * This module only DEFINES and MATCHES the set. It never edits the served JSON.
 * Retirement is a separate, approved step (Eric, 2026-11-17).
 *
 * Pure: no DB, no network, no filesystem. Scripts pass the data in.
 */
import { createHash } from 'node:crypto';

/** The exact suffix that marks a legacy GovInfo-derived pain point. */
export const LEGACY_GAO_TAG = '(Source: GAO)';

export interface LegacyTaggedPainPoint {
  /** The agency key the string is filed under in the served JSON (verbatim). */
  agency: string;
  /** The full served string, including the tag. */
  text: string;
  /** The string with the tag removed — the (possibly truncated) GAO title. */
  title: string;
}

export interface PainPointJson {
  agencies: Record<string, { painPoints?: unknown[]; priorities?: unknown[] }>;
}

/**
 * Every served pain point that ends with the bare "(Source: GAO)" tag, in file
 * order. A string with a document number ("(Source: GAO-26-107726)") is a living
 * citation and is NOT part of this set.
 */
export function extractLegacyGaoTagged(json: PainPointJson): LegacyTaggedPainPoint[] {
  const out: LegacyTaggedPainPoint[] = [];
  for (const [agency, entry] of Object.entries(json.agencies ?? {})) {
    for (const pp of entry.painPoints ?? []) {
      if (typeof pp !== 'string' || !pp.endsWith(LEGACY_GAO_TAG)) continue;
      out.push({ agency, text: pp, title: pp.slice(0, -LEGACY_GAO_TAG.length).trim() });
    }
  }
  return out;
}

/**
 * Order-independent content hash of a set of (agency, text) pairs. Duplicates
 * count: the same title filed under two agencies is two served items.
 */
export function legacySetHash(items: Array<{ agency: string; text: string }>): string {
  const lines = items.map((i) => `${i.agency}\u0000${i.text}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** One `agency_intelligence` row (gao_high_risk) — only the fields we read. */
export interface GovinfoGaoRow {
  agency_name: string | null;
  title: string | null;
  publication_date: string | null;
  source_url: string | null;
  source_document: string | null;
}

export interface GovinfoSourceRef {
  /** GovInfo package id, e.g. GAOREPORTS-T-RCED-98-12. */
  source_document: string;
  /** GAO product number derived from the package id, e.g. T-RCED-98-12. */
  gao_product_number: string | null;
  title: string;
  publication_date: string | null;
  source_url: string | null;
}

export type LegacyMatchMethod = 'exact_title' | 'title_prefix' | 'unmatched';

export interface ArchivedLegacyPainPoint {
  agency: string;
  text: string;
  match_method: LegacyMatchMethod;
  /** The chosen source (earliest-sorted package id when several share a title). */
  source: GovinfoSourceRef | null;
  /** Other distinct GovInfo documents the same title could refer to. */
  alternate_sources: GovinfoSourceRef[];
  /** Agencies the source row(s) were filed under in agency_intelligence. */
  source_row_agencies: string[];
  /** False when the served agency is not among the source rows' agencies. */
  agency_matches_source_row: boolean;
}

function productNumber(sourceDocument: string): string | null {
  const m = sourceDocument.match(/^GAOREPORTS-(.+)$/);
  return m ? m[1] : null;
}

/**
 * Match each tagged string to the GovInfo row(s) it came from. Exact title first;
 * otherwise a row whose title STARTS WITH the served (truncated) title. Several
 * rows can share one document (the upstream extractor filed one report under many
 * agencies), so sources are de-duplicated by package id.
 */
export function matchLegacyToGovinfo(
  tagged: LegacyTaggedPainPoint[],
  rows: GovinfoGaoRow[],
): ArchivedLegacyPainPoint[] {
  const clean = rows.filter((r): r is GovinfoGaoRow & { title: string; source_document: string } =>
    !!r.title && !!r.source_document);
  return tagged.map((t) => {
    let method: LegacyMatchMethod = 'exact_title';
    let hits = clean.filter((r) => r.title.trim() === t.title);
    if (hits.length === 0) {
      method = 'title_prefix';
      hits = clean.filter((r) => r.title.trim().startsWith(t.title));
    }
    if (hits.length === 0) {
      return {
        agency: t.agency, text: t.text, match_method: 'unmatched', source: null,
        alternate_sources: [], source_row_agencies: [], agency_matches_source_row: false,
      };
    }
    const byDoc = new Map<string, GovinfoSourceRef>();
    const agencies = new Set<string>();
    for (const h of hits) {
      if (h.agency_name) agencies.add(h.agency_name);
      if (!byDoc.has(h.source_document)) {
        byDoc.set(h.source_document, {
          source_document: h.source_document,
          gao_product_number: productNumber(h.source_document),
          title: h.title.trim(),
          publication_date: h.publication_date ? String(h.publication_date).slice(0, 10) : null,
          source_url: h.source_url,
        });
      }
    }
    const refs = [...byDoc.values()].sort((a, b) => a.source_document.localeCompare(b.source_document));
    const sourceAgencies = [...agencies].sort();
    return {
      agency: t.agency,
      text: t.text,
      match_method: method,
      source: refs[0],
      alternate_sources: refs.slice(1),
      source_row_agencies: sourceAgencies,
      agency_matches_source_row: sourceAgencies.includes(t.agency),
    };
  });
}
