/**
 * "How the Government Buys Now" rules knowledge base (Eric, 2026-11-27) — parser + register model.
 *
 * Source of truth: docs/knowledge/how-government-buys-now-2026-11-27.md (Eric's rules file, verbatim). This module
 * turns its 16 numbered entries into register rows. It never rewrites a claim: every text field is the file's own
 * words. What it ADDS is metadata the file states implicitly — legal status, effective date, recheck interval, and
 * whether each source URL is official or secondary — so a report can say how sure it is and when to re-check.
 *
 * Rules (docs/agents/data-integrity.md):
 *   - An entry marked [Not fully verified] is `verified: false` and keeps its caveat text word for word.
 *   - Part C is GovCon Giants practice, not law (`legal_status: 'practice'`).
 *   - A source whose official text could not be fetched is `fetch_failed`; the entry is kept, never dropped.
 *   - Recheck intervals (Eric's hardening plan, 2026-11-27): class deviations and pending guidance 60 days,
 *     EOs / OMB memos 180, statute 365; 0 = re-verify before every use.
 */

export type LegalStatus =
  | 'final_rule'
  | 'class_deviation'
  | 'proposed_rule'
  | 'statute'
  | 'withdrawn'
  | 'executive_order'
  | 'omb_memo'
  | 'agency_memo'
  | 'regulation'
  | 'practice'
  /** A verified fact about the market (a consortium is issuing calls), not a rule. Fix 1C register rows. */
  | 'operational_fact';

export type SourceKind = 'official' | 'official_mirror' | 'secondary' | 'consortium_primary';
export type RegisterStatus = 'current' | 'superseded' | 'unverified' | 'pending';

export interface RuleSource {
  url: string;
  kind: SourceKind;
  /** Filled by the fetch step (scripts/kb/fetch-rule-sources.ts). Absent until then. */
  /**
   * ok = the official text was fetched by scripts/kb/fetch-rule-sources.ts and `passage` is its own words.
   * research_note = a Fix 1C row: `passage` is the dated evidence recorded by the verification check, not quoted text.
   */
  fetch_status?: 'ok' | 'fetch_failed' | 'not_fetched_secondary' | 'research_note';
  passage?: string | null;
  fetched_at?: string | null;
  fetch_error?: string | null;
}

export interface RuleEntry {
  claim_id: string; // "KB-1" … "KB-16"
  entry_no: number;
  /** A/B/C = the rules file's parts; D = Fix 1C verification rows (consortia, 2808a). */
  part: 'A' | 'B' | 'C' | 'D';
  /** The entry heading, verbatim (minus the "[Not fully verified]" tag). One sentence a report can carry. */
  claim: string;
  change: string | null;
  source_text: string | null;
  status_text: string | null;
  affects: string | null;
  common_mistake: string | null;
  how_to_use: string | null;
  /** Part C: the numbered practice list, verbatim. */
  practice_text: string | null;
  /** Retrieval vocabulary (topic tags, the way a contractor asks) — metadata, never shown as a claim. */
  keywords: string[];
  sources: RuleSource[];
  legal_status: LegalStatus;
  effective_date: string | null; // YYYY-MM-DD
  /** false when the entry carries any [Not fully verified] tag. status is 'unverified' only for a heading-level tag. */
  verified: boolean;
  /** Every "[Not fully verified: …]" caveat, verbatim. */
  caveats: string[];
  recheck_interval_days: number;
  status: RegisterStatus;
  verified_on: string; // the file's check date
  supersedes: string | null;
  notes: string | null;
}

export const RULES_KB_CHECKED_ON = '2026-11-27';
export const RULES_KB_DOC = 'docs/knowledge/how-government-buys-now-2026-11-27.md';

/** Recheck interval by legal status (Eric's hardening plan). Final rules / regulation are treated like statute. */
export const RECHECK_DAYS: Record<LegalStatus, number> = {
  class_deviation: 60,
  proposed_rule: 60,
  agency_memo: 60, // implementing guidance still being issued
  executive_order: 180,
  omb_memo: 180,
  practice: 180,
  // Eric's Fix 1: "consortium is active and issuing calls" = re-verify before EVERY use. With interval 0, checkClaims
  // reports such a claim as stale (→ "Not currently confirmed.") unless it was re-verified the same day. Intended.
  // Follow-up (not built): a recheck job that re-verifies these rows before a report runs.
  operational_fact: 0,
  statute: 365,
  final_rule: 365,
  regulation: 365,
  withdrawn: 365,
};

/**
 * What the file states about each entry's legal footing, encoded once. `effective_date` is the date the file gives;
 * null where it gives several (notes say which). `recheck` overrides the status default where part of the entry is
 * still pending (e.g. a final rule next to a proposed one).
 */
const DOW_P19 = 'https://www.acquisition.gov/sites/default/files/page_file_uploads/DoD_RFO_Deviation_Part-19.pdf';
const VA_P19 = 'https://department.va.gov/acquisition-and-logistics/wp-content/uploads/sites/58/2026/03/deviation-far-part-19.pdf';
const NDAA26 = 'https://www.congress.gov/119/plaws/publ60/PLAW-119publ60.htm';
/** The RFO Part 19 model deviation text itself — linked from the DoW deviation memo (DARS 2026-O0037). */
const RFO_P19 = 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-19';
const GOVCONFORGE_P19 = 'https://govconforge.com/far-part-19-overhaul-small-business/';

/**
 * `also`: sources the entry cites by reference instead of by link ("link in entry 1", "FY2026 NDAA Sec. 1823",
 * "comes from GovCon Forge") — the file's own Additional sources / earlier links, so the cited text is attached.
 */
const ENTRY_META: Record<number, { legal_status: LegalStatus; effective_date: string | null; recheck?: number; notes?: string; also?: string[]; keywords?: string[] }> = {
  1: { legal_status: 'class_deviation', effective_date: null, notes: 'Agency by agency: VA effective 2025-11-19 (signed); Department of War effective 2026-02-01. Codified FAR Part 19 unchanged.', also: [RFO_P19], keywords: ['order of precedence', 'parity', 'which set-aside program', 'socioeconomic programs first', 'first consider'] },
  2: { legal_status: 'class_deviation', effective_date: null, notes: 'Same deviations as KB-1.', also: [RFO_P19, DOW_P19, VA_P19], keywords: ['rule of two', 'set-aside decision', 'sources sought', 'market research'] },
  3: { legal_status: 'class_deviation', effective_date: null, notes: 'FAR Council order-protest proposals of 2025-01-15 withdrawn 2025-06-12. 19.111-2 is class deviation text.', also: [RFO_P19, VA_P19, GOVCONFORGE_P19], keywords: ['order set-aside', 'task order set-aside', 'multiple-award contract orders', 'order protest'] },
  4: { legal_status: 'statute', effective_date: null, notes: '38 U.S.C. 8127; Kingdomware Technologies v. United States (2016).', also: [VA_P19], keywords: ['VA', 'Veterans First', 'Kingdomware', '38 U.S.C. 8127', 'VA rule of two', 'SDVOSB VOSB VA'] },
  5: { legal_status: 'class_deviation', effective_date: null, also: [RFO_P19, DOW_P19, VA_P19, GOVCONFORGE_P19], keywords: ['8(a) follow-on', 'once 8(a) always 8(a)', '8(a) release', 'competitive 8(a) order'] },
  6: { legal_status: 'final_rule', effective_date: '2025-10-01', notes: 'FAR Case 2024-001, FAC 2025-06, 90 FR 41872.', keywords: ['thresholds', 'micro-purchase threshold', 'simplified acquisition threshold', 'SAT', 'sole source limit', 'SDVOSB sole source limit', '8(a) sole source limit', 'HUBZone sole source', 'WOSB sole source', 'subcontracting plan threshold', 'cost or pricing data threshold', 'inflation adjustment'] },
  7: { legal_status: 'final_rule', effective_date: '2025-01-16', recheck: 60, notes: 'Recertification rule final (orders eligibility effective 2026-01-17). Size standards for 338 industries PROPOSED only (comments closed 2026-11-20), so recheck at 60 days.', keywords: ['size recertification', 'merger acquisition size', 'size standards proposed', '338 industries'] },
  8: { legal_status: 'class_deviation', effective_date: null, notes: 'EO 14275 (2025-04-15). Proposed RFO rules 2026-06-23 and 2026-09-18; none final.', keywords: ['FAR overhaul', 'RFO', 'Revolutionary FAR Overhaul', 'class deviation', 'EO 14275'] },
  9: { legal_status: 'executive_order', effective_date: '2025-04-15', notes: 'EO 14271; FY2026 NDAA (Pub. L. 119-60, enacted 2025-12-18) Sec. 1822.', keywords: ['commercial first', 'commercial products', 'commercial services', 'EO 14271', 'Section 1822'] },
  10: { legal_status: 'executive_order', effective_date: '2025-03-20', notes: 'EO 14240; OMB M-25-31 (2025-07-18). Category transfers phased.', keywords: ['GSA consolidation', 'M-25-31', 'EO 14240', 'governmentwide vehicle', 'Best in Class'] },
  11: { legal_status: 'agency_memo', effective_date: '2025-11-07', notes: 'Warfighting Acquisition System memo (2025-11-07); PAE role codified by FY2026 NDAA Sec. 1802. Transition within two years of the memo.', also: [NDAA26], keywords: ['Portfolio Acquisition Executive', 'PAE', 'Program Executive Officer', 'PEO', 'Warfighting Acquisition System', 'Section 1802'] },
  12: { legal_status: 'statute', effective_date: null, notes: '10 U.S.C. 3458; FY2026 NDAA Sec. 1823.', also: [NDAA26], keywords: ['Commercial Solutions Opening', 'CSO', '10 U.S.C. 3458', 'Section 1823'] },
  13: { legal_status: 'statute', effective_date: null, notes: '10 U.S.C. 4021, 4022.', keywords: ['Other Transaction', 'OTA', 'consortium', 'prototype', 'follow-on production', '10 U.S.C. 4022'] },
  14: { legal_status: 'regulation', effective_date: null, notes: 'FAR 35.016.', keywords: ['Broad Agency Announcement', 'BAA', 'FAR 35.016', 'white paper', 'research'] },
  15: { legal_status: 'statute', effective_date: '2025-12-18', notes: 'FY2026 NDAA Secs. 1826, 824, 1804, 875.', also: [NDAA26], keywords: ['nontraditional defense contractor', 'cost accounting exemption', 'Section 1826', 'Section 1804', 'certified cost or pricing data', 'past performance alternative', 'Section 875'] },
  16: { legal_status: 'practice', effective_date: null, notes: 'GovCon Giants practice, not law.', keywords: ['outreach', 'pitch', 'teaming', 'GovCon Giants practice'] },
};

const OFFICIAL_HOSTS = [
  'acquisition.gov', 'govinfo.gov', 'federalregister.gov', 'congress.gov', 'department.va.gov', 'war.gov',
  'law.cornell.edu', // LII hosts the U.S. Code text verbatim; treated as the statute text
];
const MIRROR_HOSTS = ['shared.govexec.com']; // an official document (OMB memo PDF) hosted by a news outlet

export function classifySource(url: string): SourceKind {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'secondary'; }
  if (OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'official';
  if (MIRROR_HOSTS.includes(host)) return 'official_mirror';
  return 'secondary';
}

/**
 * No freshness dates in quotable text (Eric, 2026-11-27: "apply the no date rules everywhere"). A report may quote
 * claim / change / status / affects / mistake / how-to-use, so an "as of <date>" clause there is rewritten to the
 * same fact without the date. Each rewrite is listed here (auditable) and recorded on the row's notes; the file keeps
 * Eric's original words. Document identifiers stay (EO 14275, M-25-31, "Sept 18, 2026 batch", effective dates).
 * verified_on / recheck_interval_days stay internal.
 */
export const QUOTABLE_REWRITES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'As of Nov 20, 2026, no Part 19 rule had been proposed.', to: 'No Part 19 rule has been proposed yet.' },
  { from: 'Services announced their PAEs through 2026.', to: 'The services are announcing their PAEs.' },
];

/** A freshness phrase a report must not carry ("as of <date>", "through 2026", "checked on <date>"). */
export const FRESHNESS_PHRASE = /\bas of\b|\bthrough 20\d\d\b|\bchecked (?:on|against sources on)\b/i;

function dequote(text: string | null, applied: string[]): string | null {
  if (!text) return text;
  let out = text;
  for (const r of QUOTABLE_REWRITES) {
    if (out.includes(r.from)) { out = out.replace(r.from, r.to); applied.push(`"${r.from}" → "${r.to}"`); }
  }
  return out;
}

const NOT_VERIFIED = /\[Not fully verified(?::\s*([^\]]*))?\]/g;
const URL_RE = /https?:\/\/[^\s;)]+/g;

function field(block: string, label: string): string | null {
  // "- Change: …" or "- Change (old → new): …" up to the next "- Label:" line.
  const re = new RegExp(`^- ${label}(?: \\([^)]*\\))?:\\s*([\\s\\S]*?)(?=^- [A-Z][A-Za-z ]+(?: \\([^)]*\\))?:|(?![\\s\\S]))`, 'm');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

/** Parse the rules file into 16 register rows. Throws if the file's shape changed (never a silent partial parse). */
export function parseRulesKb(markdown: string): RuleEntry[] {
  const parts: Array<{ part: 'A' | 'B' | 'C'; body: string }> = [];
  const partRe = /^## PART ([ABC])\.[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;
  for (const m of markdown.matchAll(partRe)) parts.push({ part: m[1] as 'A' | 'B' | 'C', body: m[2] });
  if (parts.length !== 3) throw new Error(`rules KB: expected PART A, B, C; found ${parts.length}`);

  const out: RuleEntry[] = [];
  for (const { part, body } of parts) {
    for (const m of body.matchAll(/^### (\d+)\. ([^\n]+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)) {
      const n = Number(m[1]);
      const headingRaw = m[2].trim();
      const block = m[3];
      const meta = ENTRY_META[n];
      if (!meta) throw new Error(`rules KB: no metadata for entry ${n}`);
      const all = `${headingRaw}\n${block}`;
      const caveats = [...all.matchAll(NOT_VERIFIED)].map((c) => c[0]);
      // The whole entry is unverified only when its HEADING carries the tag (entry 5). A field-level caveat (a detail
      // not confirmed) keeps the entry usable: verified=false, caveats travel with every use.
      const headingUnverified = new RegExp(NOT_VERIFIED.source).test(headingRaw);
      const urls = [...new Set([...[...block.matchAll(URL_RE)].map((u) => u[0].replace(/[.,]$/, '')), ...(meta.also ?? [])])];
      const isPractice = part === 'C';
      const legal = meta.legal_status;
      const rewrites: string[] = [];
      const q = (t: string | null) => dequote(t, rewrites);
      out.push({
        claim_id: `KB-${n}`,
        entry_no: n,
        part,
        claim: headingRaw.replace(NOT_VERIFIED, '').trim(),
        change: q(isPractice ? null : field(block, 'Change')),
        source_text: isPractice ? null : field(block, 'Source'),
        status_text: q(isPractice ? null : field(block, 'Status')),
        affects: q(isPractice ? null : field(block, 'Affects')),
        common_mistake: q(isPractice ? null : field(block, 'Common mistake')),
        how_to_use: q(isPractice ? null : field(block, 'How to use it')),
        practice_text: isPractice ? q(block.trim()) : null,
        keywords: meta.keywords ?? [],
        sources: urls.map((url) => ({ url, kind: classifySource(url) })),
        legal_status: legal,
        effective_date: meta.effective_date,
        verified: caveats.length === 0,
        caveats,
        recheck_interval_days: meta.recheck ?? RECHECK_DAYS[legal],
        status: headingUnverified ? 'unverified' : 'current',
        verified_on: RULES_KB_CHECKED_ON,
        supersedes: null,
        notes: [meta.notes, rewrites.length ? `Quotable text rewritten without a freshness date (no-date rule): ${rewrites.join('; ')}` : null].filter(Boolean).join(' ') || null,
      });
    }
  }
  out.sort((a, b) => a.entry_no - b.entry_no);
  const nums = out.map((e) => e.entry_no).join(',');
  if (nums !== Array.from({ length: 16 }, (_, i) => i + 1).join(',')) throw new Error(`rules KB: expected entries 1..16, got ${nums}`);
  return out;
}

// ── Pre-ship check (Fix 1B) ───────────────────────────────────────────────────────────────────

export type ClaimCheck =
  /** ok/stale carry the entry's field-level caveats: a report quoting the claim must carry them too. */
  | { claim_id: string; state: 'ok'; verified_on: string; recheck_due: string; caveats: string[] }
  | { claim_id: string; state: 'stale'; verified_on: string; recheck_due: string; caveats: string[] }
  | { claim_id: string; state: 'superseded'; superseded_by: string | null }
  | { claim_id: string; state: 'unverified'; caveats: string[] }
  | { claim_id: string; state: 'pending' }
  | { claim_id: string; state: 'unknown_claim' };

/** Plain language a report must use instead of a stale, superseded or unverified claim — never a softened version. */
export const NOT_CURRENTLY_CONFIRMED = 'Not currently confirmed.';

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which claims a report may use as-is TODAY. stale = verified_on + recheck interval is before today (an interval of 0
 * is stale unless verified today). Unknown ids are reported, never assumed fine.
 */
export function checkClaims(
  ids: string[],
  register: Array<Pick<RuleEntry, 'claim_id' | 'verified_on' | 'recheck_interval_days' | 'status' | 'caveats'> & { superseded_by?: string | null }>,
  today: string,
): ClaimCheck[] {
  const byId = new Map(register.map((r) => [r.claim_id, r]));
  return ids.map((id) => {
    const r = byId.get(id);
    if (!r) return { claim_id: id, state: 'unknown_claim' as const };
    if (r.status === 'superseded') return { claim_id: id, state: 'superseded' as const, superseded_by: r.superseded_by ?? null };
    if (r.status === 'pending') return { claim_id: id, state: 'pending' as const };
    if (r.status === 'unverified') return { claim_id: id, state: 'unverified' as const, caveats: r.caveats };
    const due = addDays(r.verified_on, r.recheck_interval_days);
    const stale = r.recheck_interval_days === 0 ? r.verified_on < today : due < today;
    return { claim_id: id, state: stale ? 'stale' as const : 'ok' as const, verified_on: r.verified_on, recheck_due: due, caveats: r.caveats };
  });
}

// ── Register rows (what the ingest writes) ────────────────────────────────────────────────────

export interface SourcesSnapshot {
  doc: string;
  checked_on: string;
  fetched_at: string;
  sources: Record<string, { fetched_from: string; http_status: number | null; content_type: string | null; sha256: string | null; error: string | null }>;
  passages: Record<string, Record<string, { fetch_status: 'ok' | 'fetch_failed' | 'not_fetched_secondary'; passage: string | null; fetch_error: string | null; absent_phrases?: Record<string, number> }>>;
}

export interface RegisterRow extends Omit<RuleEntry, 'sources'> {
  kb_doc: string;
  sources: Array<RuleSource & { fetched_from: string | null; absent_phrases?: Record<string, number> }>;
  superseded_by: string | null;
  search_text: string;
}

/**
 * Merge the parsed entries with the fetched snapshot. A source the snapshot does not cover is `fetch_failed`
 * ("not in snapshot") — never silently treated as fetched; the entry is always kept.
 */
export function buildRegisterRows(entries: RuleEntry[], snapshot: SourcesSnapshot): RegisterRow[] {
  return entries.map((e) => {
    const sources = e.sources.map((s) => {
      const p = snapshot.passages[e.claim_id]?.[s.url];
      const meta = snapshot.sources[s.url];
      if (!p) {
        return { ...s, fetch_status: s.kind === 'secondary' ? 'not_fetched_secondary' as const : 'fetch_failed' as const, passage: null, fetched_from: null, fetched_at: null, fetch_error: s.kind === 'secondary' ? null : 'not in the fetched snapshot' };
      }
      return {
        ...s,
        fetch_status: p.fetch_status,
        passage: p.passage,
        fetched_from: meta?.fetched_from ?? null,
        fetched_at: p.fetch_status === 'ok' ? snapshot.fetched_at : null,
        fetch_error: p.fetch_error,
        ...(p.absent_phrases ? { absent_phrases: p.absent_phrases } : {}),
      };
    });
    const search_text = [
      e.claim_id, e.claim, e.keywords.join('; '), e.change, e.status_text, e.affects, e.common_mistake, e.how_to_use, e.practice_text, e.notes,
      ...sources.map((s) => s.passage),
    ].filter(Boolean).join('\n');
    return { ...e, kb_doc: RULES_KB_DOC, sources, superseded_by: null, search_text };
  });
}

// ── Retrieval ─────────────────────────────────────────────────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'for', 'on', 'is', 'what', 'how', 'does', 'do', 'vs', 'v']);
const terms = (q: string) => q.toLowerCase().split(/[^a-z0-9()]+/).filter((t) => t && !STOP.has(t));

type Rankable = Pick<RegisterRow, 'claim_id' | 'claim' | 'search_text'> & Partial<Pick<RegisterRow, 'keywords'>> &
  Partial<Pick<RegisterRow, 'change' | 'status_text' | 'affects' | 'common_mistake' | 'how_to_use' | 'practice_text' | 'notes' | 'sources'>>;

/**
 * In-memory ranking over register rows (the same text the DB indexes). Used by tests and as the fallback when the DB
 * read fails. The entry's OWN words weigh most (heading 3, fields 2); official passages only 0.5, since they are long
 * and shared across entries. Each term is weighted by rarity across entries (idf), so a distinctive word
 * ("Kingdomware", "SDVOSB") decides more than a common one ("set-aside").
 */
export function rankRuleClaims<T extends Rankable>(query: string, rows: T[], limit = 3): T[] {
  const q = terms(query);
  if (!q.length || !rows.length) return [];
  const own = (r: T) => [r.claim, r.change, r.status_text, r.affects, r.common_mistake, r.how_to_use, r.practice_text, r.notes]
    .filter(Boolean).join('\n').toLowerCase();
  const docs = rows.map((r) => ({
    r, head: r.claim.toLowerCase(), kw: (r.keywords ?? []).map((k) => k.toLowerCase()),
    own: own(r) || r.search_text.toLowerCase(), all: r.search_text.toLowerCase(),
  }));
  // Whole-word match (so "order" does not hit "orders" by accident inside another word's meaning).
  const has = (text: string, t: string) => new RegExp(`(^|[^a-z0-9])${t.replace(/[()]/g, '\\$&')}s?([^a-z0-9]|$)`).test(text);
  const qNorm = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const idf = new Map(q.map((t) => {
    const df = docs.filter((d) => has(d.all, t)).length;
    return [t, Math.log(1 + rows.length / (1 + df))];
  }));
  const phrase = q.join(' ');
  const scored = docs.map((d) => {
    let score = 0;
    let covered = 0;
    for (const t of q) {
      const w = idf.get(t)!;
      if (d.kw.some((k) => has(k, t))) score += 3 * w;
      if (has(d.head, t)) score += 2 * w;
      if (has(d.own, t)) score += 1.5 * w;
      else if (has(d.all, t)) score += 0.5 * w;
      if (has(d.all, t)) covered += 1;
    }
    // A keyword the query contains whole (e.g. "order of precedence", "sole source limit") is strong evidence.
    for (const k of d.kw) if (k.includes(' ') && qNorm.includes(k)) score += 6;
    if (q.length > 1 && d.own.includes(phrase)) score += 2;
    return { r: d.r, score, covered };
  });
  return scored
    .filter((s) => s.covered >= Math.ceil(q.length / 2))
    .sort((a, b) => b.score - a.score || a.r.claim_id.localeCompare(b.r.claim_id))
    .slice(0, limit)
    .map((s) => s.r);
}

// ── Fix 1C verification rows (consortia, 2808a) ──────────────────────────────────────────────

export interface VerificationFile {
  doc: string;
  checked_on: string;
  method: string;
  rows: Array<{
    claim_id: string; short: string; name: string; claim: string;
    status: RegisterStatus; verified: boolean; interval?: number;
    sources: Array<{ url: string; kind: SourceKind; evidence: string; exact_url: boolean }>;
    notes: string | null; supersedes: string | null;
  }>;
}

/**
 * Register rows from the verification file (docs/knowledge/consortia-status-2026-11-27.json). Conditions (Agent 4
 * review): verified=true only where a primary page was opened; changed-sponsor claims name the CURRENT sponsor and
 * the old one goes to supersedes; not-established rows say "No confirmed active calls for …" and are unverified —
 * never "dead". Evidence dates live in sources, never in the claim text.
 */
export function buildVerificationRows(file: VerificationFile): RegisterRow[] {
  return file.rows.map((v, i) => {
    const sources = v.sources.map((s) => ({
      url: s.url, kind: s.kind,
      fetch_status: 'research_note' as const,
      passage: s.evidence,
      fetched_from: s.url, fetched_at: file.checked_on, fetch_error: null,
    }));
    const legal: LegalStatus = v.claim_id.startsWith('KB-X') ? 'agency_memo' : 'operational_fact';
    return {
      claim_id: v.claim_id,
      entry_no: 100 + i + 1,
      part: 'D' as const,
      claim: v.claim,
      change: null, source_text: null, status_text: null, affects: null, common_mistake: null, how_to_use: null,
      practice_text: null,
      keywords: [v.short, v.name],
      sources,
      legal_status: legal,
      effective_date: null,
      verified: v.verified,
      caveats: v.verified ? [] : ['[Not fully verified: backed by a secondary source, or a primary page was not opened.]'],
      recheck_interval_days: v.interval ?? RECHECK_DAYS[legal],
      status: v.status,
      verified_on: file.checked_on,
      supersedes: v.supersedes,
      superseded_by: null,
      notes: v.notes,
      kb_doc: file.doc,
      search_text: [v.claim_id, v.claim, v.name, v.short, v.notes, ...v.sources.map((s) => s.evidence)].filter(Boolean).join('\n'),
    };
  });
}
