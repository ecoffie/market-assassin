/**
 * P4 Open FIND — relevance before urgency.
 *
 * Coming back already: interpret → over-fetch → classify DIRECT/RELATED → date.
 * Open now follows that shape on sam_opportunities only.
 *
 * Ranking contract:
 *   DIRECT_MATCH
 *     → RELATED_MARKET_CANDIDATE
 *     → WEAK_NON_MARKET
 *   then response_deadline ASC inside each tier.
 *
 * "it" inside solicitation/with/city/fittings/items is not IT evidence.
 * Related-market NAICS are never added to Open retrieval (do not manufacture
 * SOCOM Open). DA/DB/DJ prefixes are Open-only DIRECT evidence for IT Services;
 * they are not written onto the industry preset (Coming back unchanged).
 */
import { buildSearchOr } from '@/lib/mi-dashboard/search';
import { resolveQueryIntent } from '@/lib/search/query-intent';
import { naicsMatchConds } from '@/lib/opportunities/map-filters';
import {
  classifyRecord,
  evidenceWhy,
  type CapabilityInterpretation,
  type ClassifiableRecord,
  type EvidenceClass,
} from '@/lib/opportunities/market-interpretation';

export type OpenRelevanceClass = EvidenceClass | 'WEAK_NON_MARKET';

export interface OpenClassifiable extends ClassifiableRecord {
  solicitation_number?: string | null;
  department?: string | null;
  response_deadline?: string | null;
}

/**
 * Smallest measured cap that recovers later-deadline DIRECT records.
 * VA IT union = 357 active notices. C&P Help Desk (Oct 1, DIRECT via 541512/DA01)
 * is absent from the first 100 and first 200 deadline-ordered rows; present at
 * rank 17 when the cap covers the full 357. 100/200 already yield P@5=1.00;
 * 500 is required so Help Desk is not dropped before ranking.
 * Construction union = 371, also fully covered. Do not bump past 500.
 */
export const OPEN_FETCH_CAP = 500;

const TIER: Record<OpenRelevanceClass, number> = {
  DIRECT_MATCH: 0,
  RELATED_MARKET_CANDIDATE: 1,
  WEAK_NON_MARKET: 2,
};

/**
 * Same tiny alias table as `VOCAB_SYNONYMS` in keyword-coverage.ts.
 * Expand 2-char residue to the vocab term. Not a new synonym dictionary.
 */
const VOCAB_SYNONYMS: Record<string, string> = {
  it: 'information technology',
  'it support': 'information technology',
  'it services': 'information technology',
  'help desk': 'information technology',
  helpdesk: 'information technology',
  'service desk': 'information technology',
};

function foldPhrase(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function longestTokenLen(phrase: string): number {
  return foldPhrase(phrase)
    .split(' ')
    .reduce((m, w) => Math.max(m, w.length), 0);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundaryPhraseRe(phrase: string): RegExp {
  const inner = escapeRe(phrase.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${inner}\\b`, 'i');
}

function codeIn(list: string[], value: string | null | undefined): boolean {
  const v = String(value || '').trim();
  if (!v || !list.length) return false;
  return list.some((c) => (c.length < 6 ? v.startsWith(c) : v === c));
}

/** Open-only PSC pins. IT Services: DA/DB/DJ families. Cyber: DJ01/DJ10 already on the preset. */
export function openDirectPsc(cap: CapabilityInterpretation): string[] {
  if (cap.kind === 'industry_preset' && cap.direct.source === 'IT Services') {
    return ['DA', 'DB', 'DJ'];
  }
  return [...cap.direct.psc];
}

/** Direct NAICS only — related-market codes stay on Coming back. */
export function openRetrievalNaics(cap: CapabilityInterpretation): string[] {
  return [...cap.direct.naics];
}

export function openRetrievalPsc(cap: CapabilityInterpretation): string[] {
  return openDirectPsc(cap);
}

export function pscMatchConds(codes: string[]): string[] {
  return codes
    .map((c) => String(c).trim())
    .filter(Boolean)
    .map((c) => (c.length < 4 ? `psc_code.like.${c}%` : `psc_code.eq.${c}`));
}

/**
 * One PostgREST `.or()` : keyword recall ∪ interpreted DIRECT NAICS ∪ DIRECT PSC.
 * Must be a single `.or()` because a second `.or()` ANDs in PostgREST.
 */
export function openCandidateOrExpr(
  searchText: string,
  cap: CapabilityInterpretation,
): string | null {
  const parts: string[] = [];
  const q = String(searchText || '').trim();
  if (q) {
    const intent = resolveQueryIntent(q);
    if (intent.kind === 'keyword') {
      const kw = buildSearchOr(q);
      if (kw) parts.push(kw);
    }
  }
  parts.push(...naicsMatchConds(openRetrievalNaics(cap)));
  parts.push(...pscMatchConds(openRetrievalPsc(cap)));
  const joined = parts.filter(Boolean).join(',');
  return joined || null;
}

function openBlob(row: OpenClassifiable): string {
  return [row.title, row.description, row.naics_description, row.department, row.solicitation_number]
    .map((s) => String(s || ''))
    .join(' ');
}

/**
 * Grounded market phrases for TEXT evidence. Drops any phrase whose longest
 * token is under 3 characters so residue “it” cannot fire inside another word.
 */
export function marketTextPhrases(cap: CapabilityInterpretation): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = String(raw || '').trim();
    if (!t) return;
    if (longestTokenLen(t) < 3) return;
    const k = foldPhrase(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };

  add(cap.requested);
  for (const t of cap.direct.terms) add(t);

  const foldedReq = foldPhrase(cap.requested);
  if (foldedReq && VOCAB_SYNONYMS[foldedReq]) add(VOCAB_SYNONYMS[foldedReq]);
  // “IT services” → information technology (same vocab table, full phrase key).
  const first = foldedReq.split(' ')[0];
  if (first && VOCAB_SYNONYMS[first] && longestTokenLen(VOCAB_SYNONYMS[first]) >= 3) {
    add(VOCAB_SYNONYMS[first]);
  }

  return out;
}

export function hasStrongMarketText(row: OpenClassifiable, cap: CapabilityInterpretation): boolean {
  const text = openBlob(row);
  if (!text.trim()) return false;
  for (const phrase of marketTextPhrases(cap)) {
    if (wordBoundaryPhraseRe(phrase).test(text)) return true;
  }
  if (cap.kind === 'literal') {
    const tokens = foldPhrase(cap.requested)
      .split(' ')
      .filter((w) => w.length >= 3);
    if (tokens.length >= 2 && tokens.every((w) => wordBoundaryPhraseRe(w).test(text))) {
      return true;
    }
  }
  return false;
}

export function classifyOpenRecord(
  row: OpenClassifiable,
  cap: CapabilityInterpretation,
): OpenRelevanceClass {
  if (cap.kind === 'cyber_with_related_it') {
    const cls = classifyRecord(row, cap);
    return cls ?? 'WEAK_NON_MARKET';
  }

  if (codeIn(cap.direct.naics, row.naics_code) || codeIn(openDirectPsc(cap), row.psc_code)) {
    return 'DIRECT_MATCH';
  }
  if (hasStrongMarketText(row, cap)) return 'DIRECT_MATCH';
  if (cap.related_market && codeIn(cap.related_market.naics, row.naics_code)) {
    return 'RELATED_MARKET_CANDIDATE';
  }
  return 'WEAK_NON_MARKET';
}

function deadlineKey(row: OpenClassifiable): string {
  const d = String(row.response_deadline || '').trim();
  return d || '9999-12-31T23:59:59Z';
}

export function rankOpenRows<T extends OpenClassifiable>(
  rows: T[],
  cap: CapabilityInterpretation,
): Array<{ row: T; cls: OpenRelevanceClass }> {
  const classified = rows.map((row) => ({ row, cls: classifyOpenRecord(row, cap) }));
  classified.sort((a, b) => {
    const td = TIER[a.cls] - TIER[b.cls];
    if (td !== 0) return td;
    return deadlineKey(a.row).localeCompare(deadlineKey(b.row));
  });
  return classified;
}

export function openEvidenceWhy(cls: OpenRelevanceClass, phrase: string): string {
  if (cls === 'DIRECT_MATCH' || cls === 'RELATED_MARKET_CANDIDATE') {
    return evidenceWhy(cls, phrase);
  }
  return `Matched an open SAM notice under “${phrase}”, but the record does not establish this market.`;
}

export function openEvidenceCounts(
  classified: Array<{ cls: OpenRelevanceClass }>,
): { DIRECT_MATCH: number; RELATED_MARKET_CANDIDATE: number } {
  const evidence_counts = { DIRECT_MATCH: 0, RELATED_MARKET_CANDIDATE: 0 };
  for (const { cls } of classified) {
    if (cls === 'DIRECT_MATCH' || cls === 'RELATED_MARKET_CANDIDATE') evidence_counts[cls] += 1;
  }
  return evidence_counts;
}
