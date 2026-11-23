/**
 * Federal Market Profile write-up grounding — pin award / vehicle / contact facts
 * into the create_document planner note and into validateFmpWriteup requiredSnippets.
 *
 * Structure alone is not enough: a pathways-first DocModel can still invent dollars,
 * NAICS, and contacts. The host extracts snippets from accumulated tool JSON.
 */

import type { Block, DocModel } from '@/lib/documents/model';
import { DOC_SCHEMA } from '@/lib/documents/model';
import { validateDocModel } from '@/lib/documents/validate';
import { WRITEUP_DOCTRINE } from './writeup-doctrine';
import {
  fmpDefenseBuyersAppear,
  fmpDefenseBuyersAppearFromEvidence,
  validateFmpWriteup,
} from './fmp-writeup-validate';
import { normalizeStateCode, US_STATE_NAMES } from '@/lib/utils/us-states';
import {
  extractDominantAwardNaics,
  extractProfileCompanyIdentity,
  extractSelfReportedProfileFacts,
  hasSelfReportedProfileFacts,
} from './tool-selection';

export type FmpToolContent = { tool?: string; content: string };

export interface FmpAwardRow {
  project: string;
  buyer: string;
  where: string;
  competition: string;
  obligated: string;
}

export interface FmpPathway {
  title: string;
  when?: string;
  /** Human-facing id: solicitation number when the tool gave one, else the SAM notice id. */
  noticeId?: string;
  naics?: string;
  summary?: string;
  move?: string;
  /** Buyer named on the notice (department / agency). */
  buyer?: string;
  /** Notice type text (Sources Sought, Combined Synopsis, ...). */
  noticeType?: string;
  /** Defaults to an open notice. FIND recompete rows are `recompete`, forecast rows `forecast`. */
  kind?: 'notice' | 'recompete' | 'forecast';
}

export interface FmpContactRow {
  person: string;
  why?: string;
  question?: string;
  email?: string;
  agency?: string;
}

export interface FmpBuyerSpend {
  agency: string;
  dollars: number;
}

export interface FmpCompetitor {
  firm: string;
  where?: string;
  obligated?: string;
  why?: string;
}

export interface FmpWriteupEvidence {
  dominantNaics: string | null;
  totalObligations: string | null;
  awardCount: number | null;
  vehicleTokens: string[];
  contactNames: string[];
  eightAExitYear: string | null;
  selfReportLines: string[];
  /** Raw blob used for loose scans (joined tool contents). */
  corpus: string;
  /** Every field below is empty / null when the tool JSON did not carry it. */
  awardRows?: FmpAwardRow[];
  pathways?: FmpPathway[];
  contactRows?: FmpContactRow[];
  buyerSpend?: FmpBuyerSpend[];
  competitors?: FmpCompetitor[];
  /** Only populated from explicit rank signals in tool JSON / text. */
  ranksByState?: Record<string, number>;
  /** e.g. "$470M" only when the corpus states a territory / buyer-class total. */
  marketTerritoryDollars?: string | null;
  /** search_web hits (title + snippet only), used for the buyer-pressure section. */
  webSnippets?: Array<{ title?: string; snippet: string }>;
}

const VEHICLE_TOKEN_RES: ReadonlyArray<{ re: RegExp; token: string }> = [
  { re: /\bMATOC\b/i, token: 'MATOC' },
  { re: /\bMACC\b/i, token: 'MACC' },
];
/**
 * An indefinite-delivery vehicle PIID in THIS customer's evidence: a 6-character office code, a 2-digit fiscal
 * year and the instrument letter D (IDV), then the serial. Generic: no agency or office is named in code.
 */
const IDV_PIID_RE = /\b([A-Z0-9]{6})(\d{2})D[A-Z0-9]{4,8}\b/g;

const DLA_HINT = /\bDLA\b|\bDefense Logistics\b/i;
const NOTICE_HINT = /\bnotice\b|\bPOC\b|\bpoint of contact\b|\bsolicitation\b/i;

/** Format a dollar obligation for the write-up (and as a required snippet when present). */
export function formatObligationSnippet(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
  return `$${Math.round(n)}`;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function walkStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 400) return;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) walkStrings(x, out, depth + 1);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) walkStrings(v, out, depth + 1);
  }
}

function extractObligationsAndCount(content: string): { dollars: number | null; awards: number | null } {
  let dollars: number | null = null;
  let awards: number | null = null;
  try {
    const p = JSON.parse(content) as Record<string, unknown>;
    const meta = (p._meta && typeof p._meta === 'object' ? p._meta : null) as Record<string, unknown> | null;
    const history = (p.history && typeof p.history === 'object' ? p.history : null) as Record<string, unknown> | null;
    const summary = (history?.summary && typeof history.summary === 'object' ? history.summary : null) as Record<string, unknown> | null;

    dollars =
      num(meta?.total_obligations)
      ?? num(p.total_obligations)
      ?? num(p.total_obligated)
      ?? num(summary?.totalObligations)
      ?? num(summary?.total_obligations)
      ?? null;
    awards =
      num(meta?.award_count)
      ?? num(p.award_count)
      ?? num(summary?.awardCount)
      ?? num(summary?.award_count)
      ?? null;

    // history.topNaics path — prefer largest amount when dominant NAICS not yet known from helper.
    const topNaics = history?.topNaics;
    if (Array.isArray(topNaics) && topNaics[0] && typeof topNaics[0] === 'object') {
      const amt = num((topNaics[0] as { amount?: unknown }).amount);
      if (amt != null && (dollars == null || amt > dollars)) {
        // do not replace total with a single-naics amount; only fill if missing
      }
    }
  } catch {
    const m$ = content.match(/\$\s*([\d,.]+)\s*([MB])\b/i);
    if (m$) {
      const base = Number(m$[1].replace(/,/g, ''));
      if (Number.isFinite(base)) {
        dollars = m$[2].toUpperCase() === 'B' ? base * 1_000_000_000 : base * 1_000_000;
      }
    }
    const mA = content.match(/\b(\d+)\s+awards?\b/i);
    if (mA) awards = Number(mA[1]);
  }
  return { dollars, awards };
}

function extractVehicleTokens(corpus: string): string[] {
  const found: string[] = [];
  for (const { re, token } of VEHICLE_TOKEN_RES) {
    if (re.test(corpus) && !found.includes(token)) found.push(token);
  }
  // IDV PIIDs that appear in this customer's own tool results (office code + FY + D + serial): the 6-character
  // office code is the stable token (one office, many vehicle numbers).
  for (const m of corpus.toUpperCase().matchAll(IDV_PIID_RE)) {
    const token = m[1];
    if (!found.includes(token)) found.push(token);
  }
  return found.slice(0, 6);
}

/**
 * Words that mean "organization / place / work item", never a person's name.
 * "Internal Revenue Service" is Title Case with no legal suffix, so shape alone
 * accepted it as a contact (the wrong buyer in the who-to-talk cell).
 */
const ORG_WORDS = new Set([
  'service', 'services', 'administration', 'bureau', 'commission', 'authority', 'revenue', 'internal',
  'department', 'agency', 'office', 'offices', 'corps', 'command', 'squadron', 'inc', 'llc', 'pllc', 'llp',
  'corp', 'corporation', 'company', 'federal', 'defense', 'logistics', 'government', 'treasury', 'national',
  'united', 'states', 'navy', 'army', 'force', 'air', 'division', 'directorate', 'district', 'program',
  'programs', 'contracting', 'procurement', 'small', 'business', 'engineers', 'engineering', 'association',
  'university', 'college', 'institute', 'foundation', 'council', 'committee', 'board', 'county', 'city',
  'state', 'region', 'regional', 'headquarters', 'laboratory', 'center', 'centers', 'group', 'systems',
  'solutions', 'technologies', 'holdings', 'partners', 'consulting', 'construction', 'maintenance',
  'repair', 'inspection', 'design', 'paving', 'solicitation', 'notice', 'contract', 'contracts', 'award',
  'awards', 'opportunity', 'opportunities', 'project', 'projects', 'parkway', 'highway', 'highways', 'road',
  'bridge', 'avenue', 'street', 'boulevard', 'pentagon', 'eastern', 'western', 'northern', 'southern',
  'central', 'lands', 'security', 'defence',
  // Notice-type and document labels that surface as JSON string values.
  'sources', 'sought', 'combined', 'synopsis', 'presolicitation', 'special', 'request', 'quote', 'proposal',
  'proposals', 'information', 'intent', 'justification', 'sale', 'amendment', 'modification', 'open', 'closed',
  'active', 'inactive', 'unknown', 'other', 'general', 'primary', 'secondary', 'total', 'recent',
]);

const IRS_LIKE = /\binternal revenue\b|\bIRS\b/i;

/**
 * Procurement, set-aside, competition and placeholder words. Award and notice JSON carries
 * Title Case strings like "No Range Specified" and "Sole Source" that match the person shape,
 * so shape alone is not evidence of a human. Matched as whole words, case-insensitive.
 */
const PROCUREMENT_WORDS = new Set([
  'range', 'specified', 'sole', 'source', 'sources', 'sought', 'synopsis', 'solicitation', 'aside', 'full',
  'open', 'small', 'business', 'woman', 'women', 'owned', 'veteran', 'hubzone', 'competitive', 'competed',
  'award', 'contract', 'naics', 'psc', 'dollars', 'obligations', 'amount', 'ceiling', 'idiq', 'matoc', 'macc',
  'rfq', 'rfi', 'rfp', 'combined', 'limited', 'unrestricted', 'not', 'applicable', 'tbd', 'unknown', 'none',
  // Pricing / CLIN / commodity labels that walk out of notice JSON as Title Case "people".
  'firm', 'fixed', 'price', 'pricing', 'unit', 'units', 'type', 'types', 'category', 'categories',
  'weatherproofing', 'waterproofing', 'overlay', 'asphalt', 'pavement', 'quantity', 'quantities',
  'clin', 'line', 'item', 'items', 'deliverable', 'deliverables',
]);
const PROCUREMENT_PHRASES = /\bset[-\s]?aside\b|\bn\/a\b|\bfirm\s+fixed\s+price\b|\bfixed\s+price\b/i;
/**
 * A Title Case phrase directly followed by a place or facility noun in the SAME tool result ("<Name> Parkway",
 * "<Name> Creek", "<Name> Air Force Base") names a place, not a person. Derived from the evidence, never a list of
 * places.
 */
const PLACE_NOUN_AFTER_NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:Parkway|Creek|River|Park|Memorial|Bridge|Highway|Road|Boulevard|Avenue|Street|Trail|Lake|Island|Harbor|Station|Field|Base|Air Force Base|Center|Hall|Dam|Canal|Tunnel)\b/g;
function placeNamesIn(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(PLACE_NOUN_AFTER_NAME_RE)) out.add(m[1].toLowerCase());
  return out;
}
/** Fillers that can never be a name on their own; a string made only of these is not a person. */
const NON_NAME_TOKENS = new Set(['no', 'yes', 'the', 'of', 'and', 'for', 'to', 'a', 'an', 'in', 'on', 'or', 'by', 'any', 'all']);

/**
 * True for a person-shaped contact name (2 to 4 Title Case words) with no org / place
 * / work-item / procurement word in it. Exported for tests. IRS-like names are always rejected.
 */
export function looksLikePersonContactName(s: string): boolean {
  const t = String(s ?? '').trim();
  if (t.length < 5 || t.length > 60) return false;
  if (IRS_LIKE.test(t)) return false;
  if (/^No\b/i.test(t)) return false;
  if (PROCUREMENT_PHRASES.test(t)) return false;
  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;
  const tokens: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[.,]/g, '');
    if (ORG_WORDS.has(lower)) return false;
    for (const part of lower.split('-')) {
      if (PROCUREMENT_WORDS.has(part)) return false;
      tokens.push(part);
    }
  }
  return !tokens.every((tok) => NON_NAME_TOKENS.has(tok));
}

function looksLikePersonName(s: string): boolean {
  return looksLikePersonContactName(s);
}

function collectContactNames(results: readonly FmpToolContent[]): { names: string[]; dla: Set<string> } {
  const noticeOrPoc: string[] = [];
  const other: string[] = [];
  const dla: string[] = [];

  const pushUnique = (arr: string[], name: string) => {
    if (!arr.some((n) => n.toLowerCase() === name.toLowerCase())) arr.push(name);
  };

  for (const r of results) {
    const content = String(r.content || '');
    const tool = String(r.tool || '');
    const preferNotice =
      NOTICE_HINT.test(content)
      || /search_federal_contacts|lookup_federal_osbp|find_opportunities|search_sam|lookup_solicitation/i.test(tool);
    const isDla = DLA_HINT.test(content);
    const places = placeNamesIn(content);

    const names: string[] = [];
    try {
      const p = JSON.parse(content) as unknown;
      const strings: string[] = [];
      walkPersonCandidateStrings(p, strings);
      for (const s of strings) {
        // A "name" value is walked as a plain string.
        if (looksLikePersonName(s) && !places.has(s.trim().toLowerCase())) names.push(s.trim());
      }
    } catch {
      const m = content.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+)\b/g) || [];
      for (const s of m) if (looksLikePersonName(s) && !places.has(s.trim().toLowerCase())) names.push(s.trim());
    }

    for (const name of names) {
      if (isDla) pushUnique(dla, name);
      else if (preferNotice) pushUnique(noticeOrPoc, name);
      else pushUnique(other, name);
    }
  }

  // Prefer non-DLA when notice / POC contacts exist.
  const preferred = noticeOrPoc.length ? [...noticeOrPoc, ...other] : [...noticeOrPoc, ...other, ...dla];
  const nonDla = new Set([...noticeOrPoc, ...other].map((n) => n.toLowerCase()));
  return {
    names: preferred.slice(0, 8),
    dla: new Set(dla.map((n) => n.toLowerCase()).filter((n) => !nonDla.has(n))),
  };
}

function extractEightAExit(corpus: string): string | null {
  // "exits 8(a) in 2031" / "8(a) graduation 2031" / "through 2031"
  const m =
    corpus.match(/\b8\s*\(\s*a\s*\)[^.\n]{0,40}\b(20\d{2})\b/i)
    || corpus.match(/\b(20\d{2})\b[^.\n]{0,40}\b8\s*\(\s*a\s*\)/i)
    || corpus.match(/\bexit(?:s|ing)?\b[^.\n]{0,30}\b(20\d{2})\b/i);
  if (m) {
    const y = m[1];
    if (y >= '2026' && y <= '2040') return y;
  }
  if (/\b2031\b/.test(corpus) && /\b8\s*\(\s*a\s*\)/i.test(corpus)) return '2031';
  return null;
}

function selfReportLines(customerText: string): string[] {
  const facts = extractSelfReportedProfileFacts(customerText);
  if (!hasSelfReportedProfileFacts(facts)) return [];
  const lines: string[] = [];
  if (facts.bonding) lines.push(facts.bonding);
  if (facts.equipment) lines.push(facts.equipment);
  if (facts.credentials) lines.push(facts.credentials);
  if (facts.selfPerforms) lines.push(facts.selfPerforms);
  if (facts.jointVenture) lines.push(facts.jointVenture);
  for (const o of facts.other) lines.push(o);
  return lines;
}

// ── Enrichment: structured rows parsed from tool JSON (empty when absent) ────────────────────────

function parseJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Keys whose string values describe a notice, buyer or place, never a person. A notice title like
 * "Ranger Station Cleaning" is person-shaped, so the value's KEY decides, not its shape.
 */
const NOT_A_PERSON_KEYS = new Set([
  'title', 'subject', 'description', 'summary', 'notice_type', 'noticetype', 'type', 'naics_description',
  'psc_description', 'office', 'agency', 'sub_agency', 'department', 'buyer', 'organization', 'recipient',
  'vendor', 'awardee', 'place', 'location', 'set_aside', 'set_aside_description', 'solicitation_title', 'project',
  'external_id', 'value_range', 'status',
]);
const NOTICE_ID_KEYS = ['notice_id', 'noticeid', 'solicitation_number', 'solicitationnumber'];

/** Like walkStrings, but skips values under NOT_A_PERSON_KEYS, and a notice row's `name` (FIND uses it as the title). */
function walkPersonCandidateStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 400) return;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) walkPersonCandidateStrings(x, out, depth + 1);
    return;
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const lowerKeys = Object.keys(o).map((k) => k.toLowerCase());
    const isNoticeRow = NOTICE_ID_KEYS.some((k) => lowerKeys.includes(k));
    for (const [k, v] of Object.entries(o)) {
      const lk = k.toLowerCase();
      if (typeof v === 'string' && (NOT_A_PERSON_KEYS.has(lk) || (lk === 'name' && isNoticeRow))) continue;
      walkPersonCandidateStrings(v, out, depth + 1);
    }
  }
}

function walkObjects(node: unknown, cb: (o: Record<string, unknown>, key: string | null) => void, key: string | null = null, depth = 0): void {
  if (depth > 9 || node == null) return;
  if (Array.isArray(node)) {
    for (const x of node.slice(0, 400)) walkObjects(x, cb, key, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    cb(o, key);
    for (const [k, v] of Object.entries(o)) walkObjects(v, cb, k, depth + 1);
  }
}

function firstString(o: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function firstNumber(o: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const n = num(o[k]);
    if (n != null) return n;
  }
  return null;
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}...`;
}

function extractAwardRows(results: readonly FmpToolContent[]): FmpAwardRow[] {
  const seen = new Set<string>();
  const rows: Array<FmpAwardRow & { amount: number }> = [];
  for (const r of results) {
    const p = parseJson(String(r.content || ''));
    if (!p) continue;
    walkObjects(p, (o) => {
      const list = o.recentAwards;
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const a = item as Record<string, unknown>;
        const title = firstString(a, ['title', 'description']);
        if (!title) continue;
        const amount = firstNumber(a, ['amount', 'obligated', 'total_obligation']) ?? 0;
        const id = firstString(a, ['id', 'piid']) || `${title}|${amount}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const buyer = firstString(a, ['subAgency', 'agency']) || 'Not stated';
        rows.push({
          project: clip(title, 90),
          buyer: clip(buyer, 60),
          where: firstString(a, ['state', 'pop_state']) || 'Not stated',
          competition: firstString(a, ['setAside', 'set_aside']) || 'Not stated in tool data',
          obligated: formatObligationSnippet(amount) || 'Not available',
          amount,
        });
      }
    });
  }
  return rows
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12)
    .map(({ amount: _amount, ...row }) => row);
}

const PATHWAY_TOOL_RE = /find_opportunities|search_sam_opportunities|lookup_solicitation|get_agency_forecasts/i;
/** Array keys FIND-style tools use for notice / forecast lists. */
const FIND_LIST_KEYS = new Set(['results', 'opportunities', 'items', 'open', 'coming_back', 'comingBack', 'coming_soon', 'comingSoon', 'forecasts']);
const VEHICLE_WORD_RE = /\b(MATOC|MACC|IDIQ|BPA|IDV|multiple[- ]award|task order contract|vehicle)\b/i;
const SOURCES_SOUGHT_RE = /\b(sources? sought|RFI|request for information|special notice)\b/i;

function pathwayRank(p: FmpPathway): number {
  // Pathways before open bids (writeup doctrine): vehicles → sources sought → forecasts → open RFQs → recompetes.
  if (p.kind === 'recompete') return 4;
  if (p.kind === 'forecast') return 2;
  const hay = `${p.title} ${p.noticeType ?? ''}`;
  if (VEHICLE_WORD_RE.test(hay)) return 0;
  if (SOURCES_SOUGHT_RE.test(hay)) return 1;
  return 3;
}

/**
 * A bare vehicle title ("Multiple Award Construction Contract (MACC)") says nothing about where or what. When the
 * notice's own summary is present, add its first clause so the pathway names the actual work. Generic: the words come
 * from this notice, never from code.
 */
const BARE_VEHICLE_TITLE_RE = /^\s*(?:(?:multiple[- ]award|construction|contract|indefinite[- ]delivery|indefinite[- ]quantity|task[- ]order|IDIQ|MATOC|MACC|BPA|services?|and|the|for|[()/,\s-])+)\s*$/i;
function enrichPathwayTitle(title: string, summary?: string, _noticeId?: string): string {
  if (!BARE_VEHICLE_TITLE_RE.test(title)) return title;
  const clause = String(summary || '').split(/[.;:\n]/)[0].replace(/\s+/g, ' ').trim();
  if (clause.length < 8) return title;
  return clip(`${title.trim()}: ${clause}`, 120);
}

/** Collapse Special Notice + Sources Sought twins (a solicitation id and the same id with a PLA / amendment suffix). */
function pathwayDedupeKey(p: FmpPathway): string {
  const titleKey = p.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 56);
  // Title first for vehicles / SS — FIND returns a notice UUID while search_sam returns the
  // solicitation PIID for the same MATOC; sol-first keys never collapsed those twins.
  if (VEHICLE_WORD_RE.test(p.title) || SOURCES_SOUGHT_RE.test(`${p.title} ${p.noticeType ?? ''}`)) {
    return `frame:${titleKey}`;
  }
  const sol = (p.noticeId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // PIID-style solicitation (not a 32-hex notice UUID) — stem collapses PLA/amend twins.
  if (sol.length >= 10 && !/^[A-F0-9]{32}$/.test(sol)) {
    const stem = sol.replace(/(PLA|AMEND\d*|REV\d*)$/i, '');
    return `sol:${stem.slice(0, 14)}`;
  }
  if (sol.length >= 10) {
    const stem = sol.replace(/(PLA|AMEND\d*|REV\d*)$/i, '');
    return `sol:${stem.slice(0, 14)}`;
  }
  return `title:${titleKey}|${p.naics ?? ''}`;
}

function dateOnly(s: string): string {
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s.trim();
}

function recompeteSummary(o: Record<string, unknown>): string | undefined {
  const incumbent = firstString(o, ['incumbent_name']);
  const value = firstString(o, ['value_label']);
  const parts = [
    incumbent ? `Incumbent: ${incumbent}.` : '',
    value ? `Value: ${value}.` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

function pathwayMove(p: FmpPathway): string {
  if (p.kind === 'recompete') {
    return 'Treat this as a recompete. Ask the buyer when the follow-on is planned and whether it will be set aside, then position before the solicitation posts.';
  }
  if (p.kind === 'forecast') {
    return 'Position on the forecast before a notice posts, and ask the buyer who owns the requirement.';
  }
  const hay = `${p.title} ${p.noticeType ?? ''}`;
  if (SOURCES_SOUGHT_RE.test(hay)) {
    return 'Respond to the sources sought with a short capability statement tied to your recorded award history, and ask the named point of contact what the buyer wants to see.';
  }
  if (VEHICLE_WORD_RE.test(hay)) {
    return 'Ask the named notice point of contact how small-business seats and task-order pools are being set, then position for the first task orders.';
  }
  return p.when
    ? 'Confirm set-aside fit and bonding capacity now, then decide whether to bid, team or watch before the deadline.'
    : 'Confirm set-aside fit and bonding capacity, then decide whether to bid, team or watch.';
}

/** Stop-words for pathway↔award buyer affinity (narrower than ORG_WORDS — keep highway/park/corps). */
const AFFINITY_STOP = new Set([
  'department', 'administration', 'service', 'services', 'federal', 'national',
  'agency', 'office', 'united', 'states', 'the', 'and', 'of', 'inc', 'llc', 'corp',
]);

function pathwayBuyerAffinity(
  p: Pick<FmpPathway, 'buyer' | 'title' | 'noticeId'>,
  awardRows: readonly FmpAwardRow[],
): number {
  const hay = `${p.buyer ?? ''} ${p.title} ${p.noticeId ?? ''}`.toLowerCase();
  if (!awardRows.length || !hay.trim()) return 0;
  let score = 0;
  for (const r of awardRows) {
    const b = (r.buyer || '').trim();
    if (!b || b === 'Not stated') continue;
    const bl = b.toLowerCase();
    // Exact buyer string on the notice beats token overlap (and avoids park ⊂ parkway).
    if (hay.includes(bl)) {
      score += 40;
      continue;
    }
    for (const w of bl.split(/[^a-z0-9]+/)) {
      if (w.length < 5 || AFFINITY_STOP.has(w)) continue;
      if (hay.includes(w)) score += 20;
    }
  }
  return Math.min(60, score);
}

function extractPathways(
  results: readonly FmpToolContent[],
  dominantNaics: string | null = null,
  awardRows: readonly FmpAwardRow[] = [],
): FmpPathway[] {
  const seen = new Set<string>();
  const out: FmpPathway[] = [];
  for (const r of results) {
    const toolMatches = PATHWAY_TOOL_RE.test(String(r.tool || ''));
    const p = parseJson(String(r.content || ''));
    if (!p) continue;
    walkObjects(p, (o, key) => {
      const inFindList = key != null && FIND_LIST_KEYS.has(key);
      // Other tools only count when the row sits in a FIND-style list and carries a real notice key.
      if (!toolMatches && !inFindList) return;
      // FIND (`horizons.<h>.items[]`) recompete rows carry no notice. `title` is the incumbent firm,
      // the work is in `description`, and the identity is the PIID / contract_id.
      const recompeteId = toolMatches && inFindList && firstString(o, ['contract_id', 'piid']) ? firstString(o, ['piid', 'contract_id']) : undefined;
      // get_agency_forecasts rows use `id` / `external_id` (no forecast_id); FIND coming_soon may carry forecast_id.
      const fromForecastList = key === 'forecasts' || !!firstString(o, ['forecast_id']);
      const forecastRow = toolMatches && inFindList && !recompeteId && fromForecastList
        && !firstString(o, ['notice_id', 'noticeId', 'solicitation_number', 'solicitationNumber']);
      const kind: FmpPathway['kind'] = recompeteId ? 'recompete' : forecastRow ? 'forecast' : 'notice';
      const title = recompeteId
        ? firstString(o, ['description', 'naics_description', 'title'])
        : firstString(o, ['title', 'name']);
      if (!title || title.length < 6) return;
      const solicitation = firstString(o, ['solicitation_number', 'solicitationNumber', 'solicitation']);
      const notice = recompeteId
        ?? firstString(o, ['notice_id', 'noticeId'])
        ?? (toolMatches && inFindList && kind !== 'forecast' ? firstString(o, ['id']) : undefined);
      if (!solicitation && !notice && !forecastRow) return;
      // A forecast row may carry no id at all: dedupe it by its title rather than crash (it never shows an id).
      const id = solicitation || notice || firstString(o, ['forecast_id', 'external_id', 'id'])
        || (forecastRow ? `forecast:${title}` : undefined);
      if (!id) return;
      const idKey = id.toLowerCase();
      if (seen.has(idKey)) return;
      seen.add(idKey);
      const deadline = kind === 'recompete'
        ? firstString(o, ['current_end'])
        : kind === 'forecast'
          ? firstString(o, ['award_date', 'anticipated_award_date', 'relevant_date'])
          : firstString(o, ['response_deadline', 'responseDeadline', 'deadline', 'due']);
      const naicsNum = firstNumber(o, ['naics_code', 'naics', 'naicsCode']);
      const naicsRaw = firstString(o, ['naics_code', 'naics', 'naicsCode']) ?? (naicsNum != null ? String(naicsNum) : undefined);
      const desc = kind === 'recompete'
        ? recompeteSummary(o)
        : firstString(o, ['description', 'summary']);
      const agencyObj = o.agency && typeof o.agency === 'object' ? firstString(o.agency as Record<string, unknown>, ['name']) : undefined;
      // FIND rows: `sub_agency` (FEDERAL HIGHWAY ADMINISTRATION) is the buyer; `buyer` is only its department.
      const buyer = firstString(o, ['sub_agency', 'awarding_sub_agency', 'department', 'agency', 'sub_tier', 'office', 'buyer']) ?? agencyObj;
      const noticeType = kind === 'recompete' ? 'Recompete' : kind === 'forecast' ? 'Forecast' : firstString(o, ['notice_type', 'noticeType', 'type']);
      const summary = desc && !/^https?:\/\//i.test(desc) ? clip(desc, 240) : undefined;
      const noticeIdForRow = kind === 'forecast' ? undefined : id;
      const pathway: FmpPathway = {
        title: enrichPathwayTitle(clip(title, 120), summary, noticeIdForRow),
        ...(deadline
          ? { when: `${kind === 'recompete' ? 'Contract ends' : kind === 'forecast' ? 'Award expected' : 'Due'} ${dateOnly(deadline)}` }
          : {}),
        ...(kind === 'forecast' ? {} : { noticeId: id }),
        kind,
        ...(naicsRaw && /^\d{6}$/.test(naicsRaw) ? { naics: naicsRaw } : {}),
        ...(summary ? { summary } : {}),
        ...(buyer ? { buyer: clip(buyer, 80) } : {}),
        ...(noticeType ? { noticeType: clip(noticeType, 40) } : {}),
      };
      pathway.move = pathwayMove(pathway);
      out.push(pathway);
    });
  }
  const civilDominant = !!dominantNaics && dominantNaics.startsWith('23');
  const fitFor = (p: FmpPathway): number => (dominantNaics ? pathwayNaicsFit(p, dominantNaics) : 0);
  // Hard drops only apply to a construction / civil firm; other profiles are ranked, never emptied.
  const candidates = civilDominant ? out.filter((p) => !isOffMarketForCivil(p)) : out;
  const indexed = candidates.map((p, i) => {
    const fit = fitFor(p);
    const buyer = pathwayBuyerAffinity(p, awardRows);
    return { p, i, fit, buyer, score: fit + buyer };
  });
  indexed.sort((a, b) => {
    // Pathways before open bids: vehicles → sources sought → forecasts → open bids, THEN fit to this firm's
    // award NAICS and buyers. (Ordering every notice before every forecast let open RFQs crowd out forecasts.)
    const ra = pathwayRank(a.p);
    const rb = pathwayRank(b.p);
    if (ra !== rb) return ra - rb;
    if (dominantNaics) {
      if (a.score !== b.score) return b.score - a.score;
      if (a.fit !== b.fit) return b.fit - a.fit;
    }
    const da = a.p.when ?? '\uffff';
    const db = b.p.when ?? '\uffff';
    if (da !== db) return da < db ? -1 : 1;
    return a.i - b.i;
  });
  if (civilDominant) {
    // A sibling 23x NAICS alone is not enough (an adjacent trade can outrank the firm's own). Prefer exact/prefix
    // fit to the firm's award NAICS, engineering-services lanes, the firm's own award buyers, OR vehicle /
    // sources-sought notices in the construction sector, which sector fit alone used to drop.
    const fits = indexed.filter((x) => {
      const hay = `${x.p.title} ${x.p.summary ?? ''} ${x.p.noticeType ?? ''}`;
      const inspection = (x.p.naics ?? '').startsWith('5413') && x.fit >= 40;
      const vehicleOrSs = VEHICLE_WORD_RE.test(hay) || SOURCES_SOUGHT_RE.test(hay);
      const adjacentVehicle = vehicleOrSs && x.fit >= 40;
      // Forecasts need civil wording — sector-fit alone lets gymnasium / building forecasts in.
      // Bare "deck" used to admit pier/boat-forces forecasts (deck replacement on a pier).
      const forecastCivil = !WATERFRONT_OFF_RE.test(hay)
        && (CIVIL_LEXICAL_RE.test(hay) || /parkway|bridge|highway|roadway|pavement|culvert/i.test(hay));
      if (x.p.kind === 'forecast') return forecastCivil;
      return x.fit >= 80 || x.buyer >= 30 || inspection || adjacentVehicle || (x.fit >= 40 && x.buyer > 0);
    });
    // Fewer than two on-market pathways: show none so the vehicle-token frame renders instead of junk.
    if (fits.length < 2) return [];
    // Cap open RFQs so exact-NAICS one-off bids cannot fill all six slots.
    const frame = fits.filter((x) => pathwayRank(x.p) <= 2);
    const open = fits.filter((x) => pathwayRank(x.p) === 3);
    const recompete = fits.filter((x) => pathwayRank(x.p) === 4);
    // Pathways before open bids: with three+ vehicle / sources-sought / forecast rows, open RFQs give up their
    // slots so the pathway rows stay numbered.
    const openCap = frame.length >= 3 ? 0 : frame.length >= 2 ? 1 : 2;
    const merged = [...frame, ...open.slice(0, openCap), ...recompete];
    // Drop Special Notice / Sources Sought twins of the same solicitation.
    const seenKeys = new Set<string>();
    const deduped: typeof merged = [];
    for (const x of merged) {
      const k = pathwayDedupeKey(x.p);
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      deduped.push(x);
    }
    return deduped.slice(0, 6).map((x) => x.p);
  }
  return indexed.slice(0, 8).map((x) => x.p);
}

/** Civil / heavy-construction wording. Bare "BRIDGE" is deliberately absent: it names bridge CONTRACTS (extensions).
 * Bare "deck" is also absent — pier "deck replacement" is waterfront, not highway bridge deck. */
const CIVIL_LEXICAL_RE = /\b(highway|parkway|pavement|roadway|bridge rehabilitation|bridge replacement|bridge deck|culvert|retaining wall|heavy civil|marine construction|asphalt|concrete paving)\b/i;
/** Marine dredging / harbor work — adjacent 237xxx, wrong pathway for a highway/bridge primary (237310). */
const MARINE_OFF_RE = /\b(dredg(?:e|ing)?|jetty|breakwater|harbor\b|channel maintenance|maintenance dredging|inner channel)\b/i;
/** Waterfront / boat / pier forecasts that share 23x NAICS with highway firms but are the wrong market. */
const WATERFRONT_OFF_RE = /\b(piers?|wharf|boat forces|marina|boat house|dry[\s-]?dock)\b/i;
const OFF_MARKET_TITLE_RE = /\b(software|tax|income tax)\b/i;
const IRS_BUYER_RE = /\b(Internal Revenue Service|IRS)\b/i;

/** NAICS fit of a pathway against the firm's dominant award NAICS (0 when it says nothing useful). */
export function pathwayNaicsFit(p: Pick<FmpPathway, 'naics' | 'title' | 'summary'>, dominantNaics: string): number {
  const hay = `${p.title} ${p.summary ?? ''}`;
  // Highway/bridge primary: dredging / waterfront pier notices share 237xxx but are a different market.
  if (/^2373/.test(dominantNaics) && dominantNaics !== '237990') {
    if (MARINE_OFF_RE.test(hay) || WATERFRONT_OFF_RE.test(hay)) return 0;
  }
  const n = p.naics;
  let fit = 0;
  if (n) {
    if (n === dominantNaics) fit = 100;
    else if (n.slice(0, 3) === dominantNaics.slice(0, 3)) fit = 80;
    else if (dominantNaics.startsWith('23') && n.startsWith('23')) fit = 50;
    else if (dominantNaics.startsWith('23') && n.startsWith('5413')) fit = 40;
  }
  // The lexical boost only rescues a missing / weak NAICS read, and only for a civil profile.
  if (fit < 50 && dominantNaics.startsWith('23') && CIVIL_LEXICAL_RE.test(hay)) fit += 30;
  return fit;
}

/** Hard drop for a 23x firm: IT / professional / admin-services NAICS (not 5413), tax or software work, IRS as buyer. */
function isOffMarketForCivil(p: FmpPathway): boolean {
  const n = p.naics ?? '';
  const civilNaics = n.startsWith('23') || n.startsWith('5413');
  if (/^(54|51|52|56)/.test(n) && !n.startsWith('5413')) return true;
  if (!n.startsWith('23') && OFF_MARKET_TITLE_RE.test(`${p.title} ${p.summary ?? ''}`)) return true;
  if (!civilNaics && IRS_BUYER_RE.test(p.buyer ?? '')) return true;
  return false;
}

const CONTACT_NAME_KEYS = ['name', 'full_name', 'fullName', 'contact_name', 'poc_name', 'person'] as const;

function extractStructuredContacts(results: readonly FmpToolContent[]): Map<string, FmpContactRow> {
  const map = new Map<string, FmpContactRow>();
  const upsert = (
    name: string,
    email?: string,
    agency?: string,
    role?: string,
  ) => {
    if (!name || !looksLikePersonContactName(name)) return;
    const k = name.toLowerCase();
    const prior = map.get(k);
    if (prior) {
      if (!prior.email && email) prior.email = email;
      if (!prior.agency && agency) prior.agency = agency;
      if (!prior.why && role) prior.why = role;
      return;
    }
    map.set(k, {
      person: name,
      ...(email ? { email } : {}),
      ...(agency ? { agency: clip(agency, 80) } : {}),
      ...(role ? { why: clip(role, 80) } : {}),
    });
  };
  for (const r of results) {
    const p = parseJson(String(r.content || ''));
    if (!p) continue;
    walkObjects(p, (o) => {
      // lookup_solicitation items: { contact: { name, email, phone } }
      const nested = o.contact;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const c = nested as Record<string, unknown>;
        upsert(
          firstString(c, CONTACT_NAME_KEYS) || '',
          firstString(c, ['email', 'contact_email']),
          firstString(o, ['agency', 'department', 'office', 'sub_agency', 'buyer']),
          firstString(c, ['role', 'title', 'position', 'type']),
        );
      }
      // SAM points_of_contact / pointOfContact arrays: { fullName, email, type }
      for (const key of ['points_of_contact', 'pointOfContact', 'pocs', 'contacts'] as const) {
        const list = o[key];
        if (!Array.isArray(list)) continue;
        for (const it of list) {
          if (!it || typeof it !== 'object') continue;
          const row = it as Record<string, unknown>;
          let name = firstString(row, CONTACT_NAME_KEYS);
          if (!name) {
            const f = firstString(row, ['first_name', 'firstName']);
            const l = firstString(row, ['last_name', 'lastName']);
            if (f && l) name = `${f} ${l}`;
          }
          upsert(
            name || '',
            firstString(row, ['email', 'contact_email']),
            firstString(o, ['agency', 'department', 'office', 'sub_agency']) || firstString(row, ['agency', 'office']),
            firstString(row, ['role', 'title', 'position', 'type']),
          );
        }
      }
      let name = firstString(o, CONTACT_NAME_KEYS);
      if (!name) {
        const f = firstString(o, ['first_name', 'firstName']);
        const l = firstString(o, ['last_name', 'lastName']);
        if (f && l) name = `${f} ${l}`;
      }
      if (!name) return;
      upsert(
        name,
        firstString(o, ['email', 'contact_email']),
        firstString(o, ['agency', 'department', 'office', 'office_name', 'organization', 'sub_agency']),
        firstString(o, ['role', 'title', 'position']),
      );
    });
  }
  return map;
}

/** A truncated PIID-style token expands to the full notice id when a pathway carries it. */
function fullVehicleToken(token: string, pathways: readonly FmpPathway[]): string {
  const hit = pathways.find((p) => p.noticeId && p.noticeId.toUpperCase().startsWith(token.toUpperCase()));
  return hit?.noticeId ?? token;
}

function contactQuestion(vehicleTokens: readonly string[], pathways: readonly FmpPathway[], agency?: string): string {
  const rawVeh = vehicleTokens.find((t) => /\d/.test(t)) || vehicleTokens[0];
  const veh = rawVeh ? fullVehicleToken(rawVeh, pathways) : rawVeh;
  if (veh) return `Ask how small-business seats on ${veh} and the related sources sought are being set${agency ? ` at ${agency}` : ''}.`;
  const lead = pathways[0];
  if (lead) return `Ask what the buyer wants to see in a response to "${clip(lead.title, 70)}".`;
  return `Ask which upcoming vehicles and sources sought${agency ? ` at ${agency}` : ''} are reserved for small business.`;
}

function buildContactRows(
  names: readonly string[],
  structured: ReadonlyMap<string, FmpContactRow>,
  vehicleTokens: readonly string[],
  pathways: readonly FmpPathway[],
): FmpContactRow[] {
  return names
    .filter(looksLikePersonContactName)
    .map((name) => {
      const s = structured.get(name.toLowerCase());
      const agency = s?.agency;
      return {
        person: name,
        ...(s?.email ? { email: s.email } : {}),
        ...(agency ? { agency } : {}),
        why: s?.why
          ? `${s.why}${agency ? `, ${agency}` : ''}`
          : `Named contact in this turn's tool results${agency ? ` (${agency})` : ''}`,
        question: contactQuestion(vehicleTokens, pathways, agency),
      };
    });
}

function extractBuyerSpend(results: readonly FmpToolContent[]): FmpBuyerSpend[] {
  const best = new Map<string, FmpBuyerSpend>();
  for (const r of results) {
    const p = parseJson(String(r.content || ''));
    if (!p) continue;
    walkObjects(p, (o) => {
      const list = o.top_agencies;
      if (!Array.isArray(list)) return;
      for (const it of list) {
        if (!it || typeof it !== 'object') continue;
        const a = it as Record<string, unknown>;
        const agency = firstString(a, ['name', 'agency']);
        const dollars = firstNumber(a, ['amount', 'obligated', 'total_obligated']);
        if (!agency || dollars == null || dollars <= 0) continue;
        const k = agency.toLowerCase();
        const prior = best.get(k);
        if (!prior || dollars > prior.dollars) best.set(k, { agency: clip(agency, 60), dollars });
      }
    });
  }
  return [...best.values()].sort((a, b) => b.dollars - a.dollars).slice(0, 8);
}

function extractCompetitors(results: readonly FmpToolContent[]): FmpCompetitor[] {
  const best = new Map<string, FmpCompetitor & { amount: number }>();
  for (const r of results) {
    const p = parseJson(String(r.content || ''));
    if (!p) continue;
    walkObjects(p, (o) => {
      const list = o.contractors;
      if (!Array.isArray(list)) return;
      for (const it of list) {
        if (!it || typeof it !== 'object') continue;
        const c = it as Record<string, unknown>;
        const firm = firstString(c, ['name', 'recipient_name', 'company', 'recipient']);
        if (!firm) continue;
        const amount = firstNumber(c, ['amount', 'total_obligated', 'obligated', 'total_obligations']) ?? 0;
        const k = firm.toLowerCase();
        const prior = best.get(k);
        if (prior && prior.amount >= amount) continue;
        const where = firstString(c, ['state', 'recipient_state', 'city']);
        best.set(k, {
          firm: clip(firm, 70),
          ...(where ? { where } : {}),
          ...(amount > 0 ? { obligated: formatObligationSnippet(amount) ?? undefined } : {}),
          amount,
        });
      }
    });
  }
  return [...best.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .map(({ amount: _a, ...c }) => c);
}

function extractRanksByState(results: readonly FmpToolContent[], corpus: string): Record<string, number> {
  const ranks: Record<string, number> = {};
  const put = (stateRaw: string, rankRaw: unknown) => {
    const st = normalizeStateCode(String(stateRaw));
    const rk = num(rankRaw);
    if (!st || rk == null || !Number.isInteger(rk) || rk < 1 || rk > 999) return;
    if (!(st in ranks)) ranks[st] = rk;
  };
  for (const r of results) {
    const p = parseJson(String(r.content || ''));
    if (!p) continue;
    walkObjects(p, (o) => {
      const st = firstString(o, ['state', 'state_code']);
      if (!st) return;
      const rk = firstNumber(o, ['rank', 'state_rank', 'rank_in_state']);
      if (rk != null) put(st, rk);
    });
  }
  for (const m of corpus.matchAll(/#\s?(\d{1,3})\s+in\s+([A-Z]{2})\b/g)) put(m[2], m[1]);
  for (const m of corpus.matchAll(/\b[Rr]ank(?:ed)?\s*(?:#|No\.?|number)?\s*(\d{1,3})\s+in\s+([A-Z]{2})\b/g)) put(m[2], m[1]);
  for (const m of corpus.matchAll(/\b([A-Z]{2})\b[^.\n]{0,40}?\b[Rr]ank(?:ed)?\s*(?:#|No\.?|number)?\s*(\d{1,3})\b/g)) put(m[1], m[2]);
  return ranks;
}

function extractMarketTerritoryDollars(corpus: string): string | null {
  const m =
    corpus.match(/(?:territory|buyer[- ]class)[^.\n$]{0,60}(\$\s?\d[\d,.]*\s?[MB])\b/i)
    || corpus.match(/"(?:market_territory_dollars|territory_total|buyer_class_total)"\s*:\s*"(\$[^"]+)"/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}

const PRESSURE_RE = /\b(deferred maintenance|backlog|funding|reauthori[sz]ation|extension|lapse|shortfall|GAO|CRS|appropriations?)\b/i;

/** Search-result chrome: FAQ boilerplate, nav labels and cut-off snippets are not buyer pressure. */
const SERP_CHROME_RE = /find answers to commonly asked|frequently asked questions|^\s*(?:home|search results?|skip to (?:main )?content)\b/i;
const STRONG_PRESSURE_RE = /\b(deferred maintenance|backlog|GAO|CRS|billions?)\b/i;
const MAX_WEB_BULLETS = 5;

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractWebSnippets(results: readonly FmpToolContent[]): Array<{ title?: string; snippet: string }> {
  const seen = new Set<string>();
  const cands: Array<{ title?: string; snippet: string; strong: boolean }> = [];
  for (const r of results) {
    if (!/search_web/i.test(String(r.tool || ''))) continue;
    const p = parseJson(String(r.content || ''));
    if (!p || typeof p !== 'object') continue;
    const list = (p as { results?: unknown }).results;
    if (!Array.isArray(list)) continue;
    for (const it of list) {
      if (!it || typeof it !== 'object') continue;
      const h = it as Record<string, unknown>;
      const snippet = firstString(h, ['snippet']);
      const rawTitle = typeof h.title === 'string' ? h.title.trim() : '';
      if (!snippet || !PRESSURE_RE.test(`${snippet} ${rawTitle}`)) continue;
      if (SERP_CHROME_RE.test(`${rawTitle} ${snippet}`) || /\.{4,}\s*$/.test(snippet)) continue;
      const key = normalizeTitle(rawTitle || snippet);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      cands.push({
        ...(rawTitle ? { title: clip(rawTitle, 90) } : {}),
        snippet: clip(snippet, 260),
        strong: STRONG_PRESSURE_RE.test(`${snippet} ${rawTitle}`),
      });
    }
  }
  return cands
    .map((c, i) => ({ c, i }))
    .sort((x, y) => Number(y.c.strong) - Number(x.c.strong) || x.i - y.i)
    .slice(0, MAX_WEB_BULLETS)
    .map(({ c: { strong: _strong, ...rest } }) => rest);
}

const CIVIL_SIGNAL_RE = /\b(FHWA|Federal Highway|Federal Lands|National Park Service|NPS|heavy civil|bridges?|highways?|roadways?|paving|USACE|Army Corps)\b/i;
/** Civil-works buyer families (generic). The firm's OWN award buyers are matched separately, from its evidence. */
const CIVIL_AGENCY_RE = /\b(FHWA|Federal Highway|Federal Lands|National Park|NPS|USACE|Army Corps|Corps of Engineers|Transportation|Interior)\b|@[\w.-]*(?:dot|nps|usace)\.(?:gov|mil)\b/i;
const DLA_EMAIL_RE = /@[\w.-]*dla\.mil\b/i;

function agencyWords(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !ORG_WORDS.has(w));
}

interface ContactProfileCtx {
  dominantNaics: string | null;
  customerText: string;
  awardRows: readonly FmpAwardRow[];
  pathways: readonly FmpPathway[];
  buyerSpend: readonly FmpBuyerSpend[];
}

/**
 * Who-to-talk selection for a construction / civil profile. DLA contacts are logistics buyers: for a
 * 23x firm they are the wrong office, so they are dropped (never used to fill the table). Contacts
 * whose agency or email matches a buyer in the award / pathway data (or a civil agency) rank first.
 */
function profileContacts(
  names: readonly string[],
  structured: ReadonlyMap<string, FmpContactRow>,
  dlaNames: ReadonlySet<string>,
  ctx: ContactProfileCtx,
): string[] {
  const naics23 = !!ctx.dominantNaics && ctx.dominantNaics.startsWith('23');
  const buyers = [
    ...ctx.awardRows.map((r) => r.buyer),
    ...ctx.pathways.map((p) => p.buyer ?? ''),
    ...ctx.buyerSpend.map((b) => b.agency),
  ].filter((b) => b && b !== 'Not stated');
  const civilBuyers = buyers.some((b) => CIVIL_AGENCY_RE.test(b));
  const civil = naics23
    || CIVIL_SIGNAL_RE.test([ctx.customerText, ...buyers, ...ctx.pathways.map((p) => p.title)].join(' '));
  if (!civil) return [...names];

  const isDla = (n: string): boolean => {
    const s = structured.get(n.toLowerCase());
    // The person's own agency / email beat the result-level DLA hint: one payload can mix FHWA and DLA people.
    if (s?.agency || s?.email) {
      return (!!s.agency && DLA_HINT.test(s.agency)) || (!!s.email && DLA_EMAIL_RE.test(s.email));
    }
    return dlaNames.has(n.toLowerCase());
  };
  const nonDla = names.filter((n) => !isDla(n));
  // A non-23 profile with no other contact and no civil buyer in sight may still use DLA.
  const keepDla = !naics23 && nonDla.length === 0 && !civilBuyers;
  const kept = keepDla ? [...names] : nonDla;

  const buyerWords = new Set(buyers.flatMap(agencyWords));
  const score = (n: string): number => {
    const s = structured.get(n.toLowerCase());
    const hay = `${s?.agency ?? ''} ${s?.email ?? ''}`;
    if (!hay.trim()) return 0;
    if (agencyWords(hay).some((w) => buyerWords.has(w))) return 2;
    return CIVIL_AGENCY_RE.test(hay) ? 1 : 0;
  };
  return kept
    .map((n, i) => ({ n, i, sc: score(n) }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .map((x) => x.n);
}

/**
 * Accumulate evidence from every FMP tool content string (all rounds).
 * `customerText` supplies self-report only (never treated as award proof).
 */
export function accumulateFmpEvidence(
  results: readonly FmpToolContent[],
  customerText = '',
): FmpWriteupEvidence {
  const corpus = results.map((r) => String(r.content || '')).filter(Boolean).join('\n');
  let dominantNaics: string | null = null;
  let bestDollars: number | null = null;
  let awardCount: number | null = null;

  for (const r of results) {
    const content = String(r.content || '');
    if (!content) continue;
    if (!dominantNaics) {
      // Prefer history.topNaics[0] when present (amount-ranked).
      try {
        const p = JSON.parse(content) as {
          history?: { topNaics?: Array<{ naics?: string }> };
        };
        const code = p.history?.topNaics?.[0]?.naics;
        if (typeof code === 'string' && /^\d{6}$/.test(code)) dominantNaics = code;
      } catch { /* ignore */ }
    }
    if (!dominantNaics) dominantNaics = extractDominantAwardNaics(content);

    const { dollars, awards } = extractObligationsAndCount(content);
    if (dollars != null && (bestDollars == null || dollars > bestDollars)) bestDollars = dollars;
    if (awards != null && (awardCount == null || awards > awardCount)) awardCount = awards;
  }

  const vehicleTokens = extractVehicleTokens(corpus);
  const collected = collectContactNames(results);
  const awardRows = extractAwardRows(results);
  const pathways = extractPathways(results, dominantNaics, awardRows);
  const buyerSpend = extractBuyerSpend(results);
  const structuredContacts = extractStructuredContacts(results);
  const contactNames = profileContacts(collected.names, structuredContacts, collected.dla, {
    dominantNaics, customerText, awardRows, pathways, buyerSpend,
  });
  return {
    dominantNaics,
    totalObligations: bestDollars != null ? formatObligationSnippet(bestDollars) : null,
    awardCount,
    vehicleTokens,
    contactNames,
    eightAExitYear: extractEightAExit(corpus) || (/\b2031\b/.test(customerText) ? '2031' : null),
    selfReportLines: selfReportLines(customerText),
    corpus,
    awardRows,
    pathways,
    contactRows: buildContactRows(contactNames, structuredContacts, vehicleTokens, pathways),
    buyerSpend,
    competitors: extractCompetitors(results),
    ranksByState: extractRanksByState(results, corpus),
    marketTerritoryDollars: extractMarketTerritoryDollars(corpus),
    webSnippets: extractWebSnippets(results),
  };
}

/**
 * Snippets the DocModel MUST contain (hard fail in validateFmpWriteup).
 * DSBS is already enforced by structure rules — not duplicated here.
 */
export function requiredSnippetsForWriteup(evidence: FmpWriteupEvidence): string[] {
  const out: string[] = [];
  if (evidence.dominantNaics) out.push(evidence.dominantNaics);
  if (evidence.totalObligations) out.push(evidence.totalObligations);
  if (evidence.eightAExitYear) out.push(evidence.eightAExitYear);
  if (evidence.vehicleTokens.length) {
    // Prefer a PIID-like token from this firm's evidence over a bare vehicle word (validator + host text share it).
    const piidLike = evidence.vehicleTokens.find((t) => /\d/.test(t));
    out.push(piidLike || evidence.vehicleTokens[0]);
  }
  // Dedupe while preserving order.
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * System note pinned before create_document rounds. No em dashes.
 */
export function buildFmpWriteupGroundingNote(
  evidence: FmpWriteupEvidence,
  customerText = '',
): string {
  void customerText; // self-report already folded into evidence.selfReportLines
  const lines: string[] = [
    'FMP WRITE-UP GROUNDING (server-extracted from tool JSON this turn; cite these facts; do not invent replacements):',
  ];
  if (evidence.dominantNaics) {
    lines.push(`- Primary / dominant NAICS from awards: ${evidence.dominantNaics}. Do not lead with 236220 unless awards show it dominant.`);
  } else {
    lines.push('- Dominant NAICS: not established from tool JSON. Do not invent a primary NAICS.');
  }
  if (evidence.totalObligations) {
    lines.push(
      `- Total obligations (use this scale): ${evidence.totalObligations}`
      + (evidence.awardCount != null ? ` across ${evidence.awardCount} awards.` : '.'),
    );
  } else {
    lines.push('- Total obligations: not found in tool JSON. Do not invent a firm-wide dollar total.');
  }
  if (evidence.vehicleTokens.length) {
    lines.push(`- Vehicle / IDV tokens to name when pathways discuss vehicles: ${evidence.vehicleTokens.join(', ')}.`);
  }
  if (evidence.contactNames.length) {
    lines.push(
      `- Named contacts (prefer notice / WHS POCs over DLA when both appear): ${evidence.contactNames.join('; ')}.`,
    );
  }
  if (evidence.eightAExitYear) {
    lines.push(`- 8(a) timing signal from evidence: ${evidence.eightAExitYear}. Include in pathways / readiness when discussing 8(a).`);
  }
  if (evidence.selfReportLines.length) {
    lines.push('- Self-reported (customer-stated, not federal tools):');
    for (const s of evidence.selfReportLines) lines.push(`  - ${s}`);
  }
  lines.push(
    '- PAE: when defense buyers appear, write about defense construction oversight / Navy PAE (or WHS construction oversight). FORBIDDEN expansion: "Performance Assessment Evaluation". Never invent that phrase.',
  );
  lines.push(
    '- Required literal snippets the document body must include (validator hard-fails if missing): '
    + (requiredSnippetsForWriteup(evidence).join(', ') || '(none extracted; structure rules still apply).'),
  );
  return lines.join('\n');
}

/**
 * After a successful create_document, nudge the answer model away from invented download URLs.
 */
export function buildFmpCreateDocumentAnswerNote(opts: {
  evidence: FmpWriteupEvidence;
  downloadPaths: string[];
  title?: string | null;
}): string {
  const paths = opts.downloadPaths.filter(Boolean);
  const lines: string[] = [
    'FMP ANSWER AFTER create_document (host rule):',
    'The full report is already open beside the chat (the customer reads it there). Summarize the federal market profile from the grounding facts below in plain English.',
    'Do NOT paste download URLs, download_path values, or a list of /api/app/vault/documents/download links into the answer. Export (PDF / Word / Excel / CSV) lives inside the open report pane, never in the chat text.',
    'Never invent URLs such as your-link-to-download.com or placeholder links. Do not tell the customer to go to the Vault to read the report.',
  ];
  if (opts.title) lines.push(`Document title: ${opts.title}.`);
  if (!paths.length) {
    lines.push('No files were returned for Export. Say the report is open above; do not invent a URL.');
  }
  const facts: string[] = [];
  if (opts.evidence.dominantNaics) facts.push(`NAICS ${opts.evidence.dominantNaics}`);
  if (opts.evidence.totalObligations) facts.push(`${opts.evidence.totalObligations} obligations`);
  if (opts.evidence.awardCount != null) facts.push(`${opts.evidence.awardCount} awards`);
  if (opts.evidence.vehicleTokens[0]) facts.push(`vehicle ${opts.evidence.vehicleTokens[0]}`);
  if (opts.evidence.eightAExitYear) facts.push(`8(a) ${opts.evidence.eightAExitYear}`);
  if (opts.evidence.contactNames[0]) facts.push(`contact ${opts.evidence.contactNames[0]}`);
  if (facts.length) lines.push(`Grounding facts to summarize: ${facts.join('; ')}.`);
  return lines.join('\n');
}

const REAL_DOWNLOAD_PATH_RE = /^\/api\/app\/vault\/documents\/download\?id=([0-9a-f-]{36})$/i;
const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const FAKE_DOWNLOAD_HOST_RE = /your-link-to-download\.com|example\.com\/download|placeholder.*download|bit\.ly\/|tinyurl\.com\//i;

function normalizeDownloadPath(p: string): string | null {
  const raw = String(p || '').trim();
  if (!raw) return null;
  // Allow absolute URLs that already point at our vault download route.
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (u.pathname === '/api/app/vault/documents/download' && u.searchParams.get('id')) {
        return `/api/app/vault/documents/download?id=${u.searchParams.get('id')}`;
      }
      return null;
    }
  } catch { /* fall through */ }
  const m = raw.match(REAL_DOWNLOAD_PATH_RE);
  return m ? `/api/app/vault/documents/download?id=${m[1]}` : null;
}


/**
 * Host post-process: never leave download URLs in the chat answer (Claude/ChatGPT pattern —
 * Export lives in the open report pane, not as chat bullets).
 * Fake hosts and vault download_path links are stripped; the reader uses Export on the report.
 */
export function rewriteFmpAnswerDownloadLinks(
  answer: string,
  _downloadPaths: readonly string[] = [],
): string {
  const text = String(answer || '');
  if (!text) return text;
  let out = text.replace(MD_LINK_RE, (full, label: string, url: string) => {
    const trimmed = String(url || '').trim();
    if (normalizeDownloadPath(trimmed)) return '';
    const looksFake =
      FAKE_DOWNLOAD_HOST_RE.test(trimmed)
      || (/download/i.test(trimmed) && /^https?:\/\//i.test(trimmed));
    if (looksFake) return label && !/download/i.test(label) ? label : '';
    return full;
  });

  // Bare vault download paths / absolute vault URLs (often listed as bullets).
  out = out.replace(/^\s*[-*•]\s*(?:https?:\/\/[^\s)]+)?\/?api\/app\/vault\/documents\/download\?[^\n]*$/gim, '');
  out = out.replace(/(?:https?:\/\/[^\s)]+)?\/api\/app\/vault\/documents\/download\?[^\s)]+/gi, '');
  out = out.replace(/https?:\/\/[^\s)]*your-link-to-download\.com[^\s)]*/gi, '');
  out = out.replace(/https?:\/\/[^\s)]*(?:example\.com\/download|placeholder[^\s)]*download)[^\s)]*/gi, '');

  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Planner output room when create_document is offered/forced on an FMP turn. */
export const FMP_DOC_TOOL_ROUND_MAX_TOKENS = 8192;

export function fmpPlannerMaxTokensForCreateDocument(createDocumentOffered: boolean): number | null {
  return createDocumentOffered ? FMP_DOC_TOOL_ROUND_MAX_TOKENS : null;
}

/**
 * True when create_document arguments carry a non-empty doc_model object.
 * Empty `{}` / missing doc_model is the failure mode that burned rewrite budget
 * without saving a Vault file (trace e2d3274a).
 */
export function createDocumentArgsHaveUsableDocModel(rawArgs: string): boolean {
  try {
    const a = JSON.parse(rawArgs || '{}') as { doc_model?: unknown };
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    const m = a.doc_model;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    const title = typeof (m as { title?: unknown }).title === 'string'
      ? String((m as { title: string }).title).trim()
      : '';
    const sections = (m as { sections?: unknown }).sections;
    if (!title) return false;
    if (!Array.isArray(sections) || sections.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

export type BuildFmpHostDocModelOpts = {
  customerText?: string;
  defenseBuyersAppear?: boolean;
  today?: () => string;
};

/** Civil-work terms DSBS keywords can lean on; only terms the customer or tool rows actually used are kept. */
const CIVIL_TERMS = [
  'heavy civil', 'bridge', 'highway', 'roadway', 'paving', 'pavement', 'stormwater', 'structural concrete',
  'marine', 'culvert', 'retaining wall', 'earthwork', 'rehabilitation', 'design-build', 'inspection',
] as const;

function civilTermsFrom(text: string): string[] {
  const hay = text.toLowerCase();
  return CIVIL_TERMS.filter((t) => hay.includes(t)).slice(0, 8);
}

/** State / DC names the customer typed, in order of appearance. Never inferred from tools. */
function geoFromCustomerText(text: string): string[] {
  const hits: Array<{ idx: number; label: string }> = [];
  for (const name of Object.values(US_STATE_NAMES)) {
    if (/^district of columbia$/i.test(name)) continue;
    const m = new RegExp(`(?<!West )\\b${name}\\b`, 'i').exec(text);
    if (m) hits.push({ idx: m.index, label: name });
  }
  const dc = /\bD\.?C\.?\b|\bDistrict of Columbia\b/.exec(text);
  if (dc) hits.push({ idx: dc.index, label: 'DC' });
  return hits.sort((a, b) => a.idx - b.idx).map((h) => h.label).slice(0, 6);
}

const SRC = ['s1'];

function para(id: string, text: string, claim: 'fact' | 'recommendation' = 'fact'): Block {
  return { type: 'paragraph', id, text, claim, cites: SRC };
}

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function snippetAnchor(s: string): string {
  if (/^\d{6}$/.test(s)) return `Primary award NAICS ${s}`;
  if (s.startsWith('$')) return `Award obligations ${s}`;
  if (/^20\d{2}$/.test(s)) return `8(a) timing through ${s}`;
  return `Vehicle pathway ${s}`;
}

/** Plain text of every section / block in reading order (for char counts and snippet checks). */
export function flattenDocModelText(model: DocModel): string {
  const parts: string[] = [model.title, model.subtitle ?? '', model.preparedFor ?? ''];
  for (const s of model.sections ?? []) {
    parts.push(s.heading);
    for (const b of s.blocks ?? []) {
      if (b.type === 'paragraph' || b.type === 'callout') parts.push(b.text);
      else if (b.type === 'bullets') for (const it of b.items) parts.push(it.text);
      else if (b.type === 'table') {
        if (b.caption) parts.push(b.caption);
        for (const c of b.columns) parts.push(c.label);
        for (const row of b.rows) for (const v of Object.values(row)) if (v != null) parts.push(String(v));
      } else if (b.type === 'chart') {
        if (b.caption) parts.push(b.caption);
        for (const ser of b.series) {
          parts.push(ser.name);
          for (const pt of ser.points) parts.push(`${pt.x} ${pt.y}`);
        }
      }
    }
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * Does THIS firm do construction? The defense construction-oversight (PAE) section is about how construction is
 * bought and overseen, so it belongs only in a construction firm's profile, never because an Army or Navy buyer
 * appears in a janitorial or IT firm's evidence. Evidence order: the firm's award NAICS, else its saved profile
 * NAICS, else the customer's own words. Unknown is "no": the section is not added on a guess.
 */
export function fmpFirmDoesConstruction(evidence: Pick<FmpWriteupEvidence, 'dominantNaics'>, customerText: string, companyNaics?: string | null): boolean {
  const award = String(evidence.dominantNaics ?? '').replace(/\D/g, '');
  if (award) return award.startsWith('23');
  const own = String(companyNaics ?? '').replace(/\D/g, '');
  if (own) return own.startsWith('23');
  return /\b(construction|civil works|heavy civil|general contractor|design[- ]build)\b/i.test(customerText || '');
}

/**
 * Host-built DocModel from accumulated FMP evidence. Claude-parity shell (the read, metrics,
 * pathways, proven awards, money, PAE, pressure, contacts, readiness) where EVERY row and figure
 * comes from tool JSON; a section whose evidence is absent is shorter, never invented.
 * Must pass validateFmpWriteup including requiredSnippets and the PAE gloss ban.
 */
export function buildFmpHostDocModel(
  evidence: FmpWriteupEvidence,
  opts: BuildFmpHostDocModelOpts = {},
): DocModel {
  const customerText = opts.customerText || '';
  const identity = extractProfileCompanyIdentity(customerText);
  const company = identity.legalName || 'Federal market profile';
  const firm = identity.legalName || 'The firm';
  // Name-only asks omit "defense"/"PAE" in the prompt, but defense-buyer pathways in the evidence
  // still need the PAE section. OR evidence so a false prompt flag cannot suppress DoD buyers.
  const defense = (!!opts.defenseBuyersAppear || fmpDefenseBuyersAppearFromEvidence(evidence))
    && fmpFirmDoesConstruction(evidence, customerText);
  const date = (opts.today ?? (() => new Date().toISOString().slice(0, 10)))();
  const snippets = requiredSnippetsForWriteup(evidence);
  const naics = evidence.dominantNaics || snippets.find((s) => /^\d{6}$/.test(s)) || null;
  const dollars = evidence.totalObligations;
  const exitY = evidence.eightAExitYear;
  const vehicleSnippet = (() => {
    if (!evidence.vehicleTokens.length) return null;
    return evidence.vehicleTokens.find((t) => /\d/.test(t)) || evidence.vehicleTokens[0];
  })();
  const vehicleList = evidence.vehicleTokens.length
    ? listText(evidence.vehicleTokens.map((t) => fullVehicleToken(t, evidence.pathways ?? [])))
    : null;
  const awardRows = evidence.awardRows ?? [];
  const allPathways = evidence.pathways ?? [];
  const buyerSpend = evidence.buyerSpend ?? [];
  const competitors = evidence.competitors ?? [];
  const ranks = Object.entries(evidence.ranksByState ?? {});

  // ── Subtitle: only what the customer text / evidence states ──
  const geo = geoFromCustomerText(customerText);
  const is8a = /8\s*\(\s*a\s*\)/i.test(customerText);
  const subParts = [
    naics ? `Primary award NAICS ${naics}` : null,
    is8a ? (exitY ? `8(a) firm, timing through ${exitY}` : '8(a) firm') : null,
    geo.length ? `Market: ${geo.join(', ')}` : null,
  ].filter(Boolean) as string[];
  const subtitle = subParts.length ? `Report by Mindy AI. ${subParts.join('. ')}.` : undefined;

  const sections: DocModel['sections'] = [];

  // ── 1. The read + headline metrics (heading skipped by the pathways-first rule) ──
  const readBits: string[] = [];
  if (dollars) {
    readBits.push(
      `${firm} shows ${dollars} in federal prime obligations`
      + `${evidence.awardCount != null ? ` across ${evidence.awardCount} awards` : ''}`
      + `${naics ? `, centered on NAICS ${naics}` : ''}.`,
    );
  } else if (naics) {
    readBits.push(`Award history points to NAICS ${naics} as the primary lane. No firm-wide dollar total was returned this turn.`);
  } else {
    readBits.push('Award history was thin this turn, so no firm-wide dollar total or primary NAICS is stated.');
  }
  if (allPathways.length) {
    readBits.push(`Strongest pathways right now: ${listText(allPathways.slice(0, 2).map((p) => `"${p.title}"`))}.`);
  } else if (vehicleList) {
    readBits.push(`Vehicle signals in the data: ${vehicleList}.`);
  }
  if (exitY) readBits.push(`8(a) timing runs through ${exitY}.`);

  const readBlocks: Block[] = [{
    type: 'callout',
    id: 'c-read',
    tone: 'key_finding',
    text: readBits.join(' '),
    claim: 'fact',
    cites: SRC,
  }];
  const metricRows: Array<Record<string, string>> = [];
  if (dollars) {
    metricRows.push({
      metric: 'Federal prime obligations',
      value: dollars,
      covers: 'Recorded prime awards in the award history tool result',
    });
  }
  if (evidence.awardCount != null) {
    metricRows.push({
      metric: 'Recorded prime awards',
      value: String(evidence.awardCount),
      covers: 'Award count in the same award history result',
    });
  }
  for (const [state, rank] of ranks) {
    metricRows.push({
      metric: `Rank in ${state}`,
      value: `#${rank}`,
      covers: 'Rank reported by the market tools for this firm in that state',
    });
  }
  if (evidence.marketTerritoryDollars) {
    metricRows.push({
      metric: 'Buyer-class spend in territory',
      value: evidence.marketTerritoryDollars,
      covers: 'Total reported in the market tool results',
    });
  }
  if (exitY) {
    metricRows.push({
      metric: '8(a) eligibility horizon',
      value: `Through ${exitY}`,
      covers: 'Timing signal found in the tool results or the customer message',
    });
  }
  if (metricRows.length) {
    readBlocks.push({
      type: 'table',
      id: 't-metrics',
      caption: 'Headline metrics (only figures present in this turn\'s tool results)',
      claim: 'fact',
      cites: SRC,
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value' },
        { key: 'covers', label: 'What it covers' },
      ],
      rows: metricRows,
    });
  }
  sections.push({ id: 'sec-read', heading: 'The read', blocks: readBlocks });

  // ── 2. Pathways (first body section after the read) ──
  const directBuyers = [...new Set(awardRows.map((r) => r.buyer).filter((b) => b && b !== 'Not stated'))].slice(0, 3);
  const directPathway = directBuyers.length > 0 || buyerSpend.length > 0;
  const forecastPathways = allPathways.filter((p) => p.kind === 'forecast');
  // Include forecasts in the numbered pathway list (a forecast is a pathway, not a footnote). Keep a separate
  // forecast table when extras remain.
  const noticeCap = directPathway ? 5 : 6;
  const shown = allPathways.slice(0, noticeCap);
  const totalPathways = shown.length + (directPathway ? 1 : 0);
  const pathwayHeading = shown.length > 0 && totalPathways >= 6
    ? 'Six pathways, in priority order'
    : 'Pathways in priority order';
  const pathwayBlocks: Block[] = [para(
    'p-pathways-intro',
    'Ranked by fit with the award record and by the clock: vehicles first, then sources sought, then direct 8(a) routes.',
    'recommendation',
  )];

  if (shown.length) {
    shown.forEach((pw, i) => {
      const n = i + 1;
      const idLine = pw.noticeId
        ? `${pw.kind === 'recompete' ? 'Contract' : 'Notice'} ${pw.noticeId}${pw.naics ? `, NAICS ${pw.naics}` : ''}.`
        : (pw.naics ? `NAICS ${pw.naics}.` : '');
      const text = [
        `**${n}. ${pw.title}.**`,
        pw.when ? `${pw.when}.` : '',
        pw.buyer ? `Buyer: ${pw.buyer}.` : '',
        pw.noticeType ? `Notice type: ${pw.noticeType}.` : '',
        pw.summary ?? '',
        idLine,
      ].filter(Boolean).join(' ');
      pathwayBlocks.push(para(`p-pathway-${n}`, text));
      if (pw.move) pathwayBlocks.push(para(`p-pathway-${n}-move`, `**Move:** ${pw.move}`, 'recommendation'));
    });
  } else {
    const items: Array<{ text: string; claim: 'fact' | 'recommendation'; cites: string[] }> = [];
    if (vehicleList) {
      items.push({ text: `Vehicle signals in the tool data: ${vehicleList}.`, claim: 'fact', cites: SRC });
    }
    items.push({
      text: `**Vehicles first.** Ask the holders of ${vehicleList ?? 'the multiple-award vehicles at your core buyers'} how small-business seats and task-order pools are being set.`,
      claim: 'recommendation',
      cites: SRC,
    });
    if (evidence.vehicleTokens.some((t) => /^MATOC$/i.test(t))) {
      items.push({
        text: '**MATOC.** The data names a MATOC. Treat any open on-ramp or recompete of it as your earliest entry point.',
        claim: 'recommendation',
        cites: SRC,
      });
    }
    items.push({
      text: '**Sources sought next.** Watch sources sought and RFIs at those buyers. A short capability statement tied to your recorded award history is the entry ticket.',
      claim: 'recommendation',
      cites: SRC,
    });
    items.push({
      text: `**Direct 8(a) awards.** Ask each buyer in your award record for direct 8(a) offers${exitY ? `, with 8(a) timing through ${exitY}` : ''}.`,
      claim: 'recommendation',
      cites: SRC,
    });
    items.push({
      text: '**Forecasts.** Position on agency forecasts before a notice posts and add each forecast owner to your contact list.',
      claim: 'recommendation',
      cites: SRC,
    });
    pathwayBlocks.push({ type: 'bullets', id: 'b-pathways-frame', ordered: true, items });
  }
  if (directPathway) {
    const buyerNames = directBuyers.length ? directBuyers : buyerSpend.slice(0, 3).map((b) => b.agency);
    pathwayBlocks.push(para(
      'p-pathway-direct',
      `**${shown.length + 1}. Direct 8(a) awards at the buyers already served.** Buyers in the award and market data include ${listText(buyerNames)}.`,
    ));
    pathwayBlocks.push(para(
      'p-pathway-direct-move',
      `**Move:** Ask each small-business office about direct 8(a) offers${exitY ? ` while 8(a) timing runs through ${exitY}` : ''}.`,
      'recommendation',
    ));
  }
  if (shown.length && vehicleList) {
    pathwayBlocks.push(para('p-pathway-vehicles', `Vehicle signals in the tool data: ${vehicleList}.`));
  }
  sections.push({ id: 'sec-pathways', heading: pathwayHeading, blocks: pathwayBlocks });

  // ── 3. What the firm has already proven ──
  if (awardRows.length) {
    sections.push({
      id: 'sec-proven',
      heading: 'What the firm has already proven',
      blocks: [{
        type: 'table',
        id: 't-awards',
        caption: `Recorded prime awards from the award history tool, largest first (${awardRows.length} shown${evidence.awardCount != null ? ` of ${evidence.awardCount}` : ''}). Lead capture conversations with these.`,
        claim: 'fact',
        cites: SRC,
        columns: [
          { key: 'project', label: 'Project' },
          { key: 'buyer', label: 'Buyer' },
          { key: 'where', label: 'Where' },
          { key: 'competition', label: 'Competition' },
          { key: 'obligated', label: 'Obligated', align: 'right' },
        ],
        rows: awardRows.map((r) => ({ ...r })),
      }],
    });
  }

  // ── 4. Where the money sits / who else is in the market ──
  if (buyerSpend.length) {
    sections.push({
      id: 'sec-money',
      heading: 'Where the money sits',
      blocks: [
        para(
          'p-money',
          `Top buyers by obligated dollars in the market report: ${buyerSpend.slice(0, 5).map((b) => `${b.agency} ${formatObligationSnippet(b.dollars) ?? ''}`.trim()).join('; ')}.`
          + `${evidence.marketTerritoryDollars ? ` Reported territory total: ${evidence.marketTerritoryDollars}.` : ''}`,
        ),
        {
          type: 'chart',
          id: 'c-money',
          kind: 'bar',
          xLabel: 'Buying agency',
          yLabel: 'Obligations',
          valueFormat: 'usd',
          caption: 'Obligated dollars by buyer (highest single-report figure per buyer).',
          claim: 'fact',
          cites: SRC,
          series: [{
            name: 'Obligations',
            points: buyerSpend.map((b) => ({ x: b.agency, y: b.dollars })),
          }],
        },
      ],
    });
  }
  if (competitors.length) {
    sections.push({
      id: 'sec-competitors',
      heading: 'Who else is in this market',
      blocks: [{
        type: 'table',
        id: 't-competitors',
        caption: 'Peer firms from the market report tool results.',
        claim: 'fact',
        cites: SRC,
        columns: [
          { key: 'firm', label: 'Firm' },
          { key: 'where', label: 'Where it leads' },
          { key: 'obligated', label: 'Obligated', align: 'right' },
          { key: 'why', label: 'Why it matters' },
        ],
        rows: competitors.map((c) => ({
          firm: c.firm,
          where: c.where ?? 'Not stated',
          obligated: c.obligated ?? 'Not available',
          why: c.why ?? 'Peer in the same market report; check for vehicle seats and teaming fit.',
        })),
      }],
    });
  }

  // ── Forecast work — extras not already numbered in the pathways section ──
  const shownForecastIds = new Set(
    shown.filter((p) => p.kind === 'forecast').map((p) => `${p.title}|${p.when ?? ''}`),
  );
  const extraForecasts = forecastPathways.filter(
    (p) => !shownForecastIds.has(`${p.title}|${p.when ?? ''}`),
  );
  if (extraForecasts.length) {
    sections.push({
      id: 'sec-forecasts',
      heading: 'Forecast work to position for before a notice posts',
      blocks: [{
        type: 'table',
        id: 't-forecasts',
        caption: 'Additional agency forecasts returned this turn. Position before a notice posts.',
        claim: 'fact',
        cites: SRC,
        columns: [
          { key: 'project', label: 'Project' },
          { key: 'buyer', label: 'Buyer' },
          { key: 'listed', label: 'Listed as' },
          { key: 'range', label: 'Range' },
        ],
        rows: extraForecasts.slice(0, 8).map((p) => ({
          project: p.title,
          buyer: p.buyer ?? 'Not stated',
          listed: p.when ?? p.noticeType ?? 'Forecast',
          range: p.summary ?? (p.naics ? `NAICS ${p.naics}` : 'Not stated'),
        })),
      }],
    });
  }

  // ── Where the money is moving: only when vehicle evidence exists ──
  if (evidence.vehicleTokens.length || shown.some((p) => VEHICLE_WORD_RE.test(`${p.title} ${p.noticeType ?? ''}`))) {
    const firmLabel = firm;
    sections.push({
      id: 'sec-shifts',
      heading: 'Where the money is moving',
      blocks: [
        para(
          'p-shifts-intro',
          `Three shifts that change how ${firmLabel} gets on contract — grounded in the vehicle and pathway evidence this turn.`,
          'recommendation',
        ),
        {
          type: 'bullets',
          id: 'b-shifts',
          ordered: false,
          items: [
            {
              text: `**From single projects to regional MATOCs.** Vehicle signals in this turn (${listText(evidence.vehicleTokens.map((t) => fullVehicleToken(t, allPathways)).slice(0, 4)) || 'multiple-award vehicles'}) mean seats and task-order pools matter more than one-off bids.`,
              claim: 'recommendation' as const,
              cites: SRC,
            },
            {
              text: `**From base offices to highway engineers.** Award buyers in this profile${directBuyers.length ? ` (${listText(directBuyers)})` : ''} are the offices that already know the firm's work — keep them on the vehicle and sources-sought list.`,
              claim: 'recommendation' as const,
              cites: SRC,
            },
            {
              text: '**From bid-build to design-build.** When a pathway asks for design capability, name the design partner before the response is due — do not invent a partner that was not self-reported.',
              claim: 'recommendation' as const,
              cites: SRC,
            },
          ],
        },
      ],
    });
  }

  // ── 5. PAE (defense) ──
  if (defense) {
    sections.push({
      id: 'sec-pae',
      heading: 'Who owns defense construction now: the PAE shift',
      blocks: [
        para(
          'p-pae',
          'Defense construction buying offices increasingly sit under defense construction oversight / Navy PAE '
          + '(and related WHS construction oversight). Treat PAE as that oversight shift for this profile.',
        ),
        {
          type: 'bullets',
          id: 'b-pae',
          ordered: false,
          items: [
            {
              text: '**Map the buyer.** For each defense buyer in this profile, confirm whether construction now routes through Navy PAE, WHS construction oversight or another agent before you write to it.',
              claim: 'recommendation',
              cites: SRC,
            },
            {
              text: '**Expect new points of contact.** Oversight changes can move who signs off on small-business seats. Refresh your contact list for those offices.',
              claim: 'recommendation',
              cites: SRC,
            },
            {
              text: '**Check each service on its own.** Do not assume one construction agent covers every defense buyer.',
              claim: 'recommendation',
              cites: SRC,
            },
          ],
        },
      ],
    });
  }

  // ── 6. Buyer pressure ──
  const civilTerms = civilTermsFrom(
    [customerText, ...allPathways.map((p) => p.title), ...awardRows.map((r) => r.project)].join(' '),
  );
  const web = evidence.webSnippets ?? [];
  const painBlock: Block = web.length
    ? {
      type: 'bullets',
      id: 'b-pain',
      ordered: false,
      items: web.slice(0, 5).map((w) => ({
        text: `${w.title ? `**${w.title}.** ` : ''}${w.snippet}`,
        claim: 'fact' as const,
        cites: SRC,
      })),
    }
    : {
      type: 'bullets',
      id: 'b-pain',
      ordered: false,
      items: [
        {
          text: `Deferred maintenance and aging infrastructure keep repair and rehabilitation work moving${civilTerms.length ? ` in ${listText(civilTerms.slice(0, 4))}` : ''}.`,
          claim: 'assumption' as const,
          origin: 'Standing market pressure. Web search returned no usable snippets this turn, so confirm against current GAO, CRS and agency budget documents.',
        },
        {
          text: 'Schedule pressure pushes buyers toward multiple-award vehicles and faster delivery methods.',
          claim: 'assumption' as const,
          origin: 'Standing market pressure, not retrieved from a source this turn. Confirm with each buyer.',
        },
        {
          text: 'Seats on vehicles are scarce, so buyers lean on contractors already in their award record.',
          claim: 'assumption' as const,
          origin: 'Standing market pressure, not retrieved from a source this turn. Confirm with each buyer.',
        },
      ],
    };
  sections.push({ id: 'sec-pain', heading: 'What buyers are under pressure to fix', blocks: [painBlock] });

  // ── 7. Who to talk to ──
  const contactRows: FmpContactRow[] = (evidence.contactRows?.length
    ? evidence.contactRows
    : evidence.contactNames.filter(looksLikePersonContactName).map((person) => ({ person })))
    .filter((c) => looksLikePersonContactName(personHeadOfCell(c.person)))
    .slice(0, 8);
  const whoRows = contactRows.length
    ? contactRows.map((c) => ({
      person: [c.person, c.agency, c.email].filter(Boolean).join(', '),
      why: c.why ?? `Named contact in this turn's tool results${c.agency ? ` (${c.agency})` : ''}`,
      question: c.question ?? contactQuestion(evidence.vehicleTokens, allPathways, c.agency),
    }))
    : [{
      person: 'Named notice POC on the active pathway',
      why: 'No named person came back from the contact tools this turn; read the point of contact off the notice itself.',
      question: contactQuestion(evidence.vehicleTokens, allPathways),
    }];
  sections.push({
    id: 'sec-who',
    heading: 'Who to talk to and what to say',
    blocks: [{
      type: 'table',
      id: 't-who',
      claim: 'fact',
      cites: SRC,
      columns: [
        { key: 'person', label: 'Person' },
        { key: 'why', label: 'Why they matter' },
        { key: 'question', label: 'Question to ask' },
      ],
      rows: whoRows,
    }],
  });

  // ── 8. Readiness + DSBS ──
  // Drop a self-report line that merely restates shorter lines already listed.
  const selfLines = evidence.selfReportLines.filter((line, i, all) =>
    !all.some((other, j) => j !== i && other.length < line.length && line.includes(other)));
  const readyItems: Array<{ text: string; claim: 'recommendation'; cites: string[] }> = [
    {
      text: `**DSBS keywords.** Update DSBS keywords to match the award NAICS${naics ? ` ${naics}` : ''} and ${civilTerms.length ? `these civil terms: ${civilTerms.join(', ')}` : 'the civil pathway terms in this profile'}.`,
      claim: 'recommendation',
      cites: SRC,
    },
    {
      text: awardRows.length
        ? `**Past performance.** Lead with the ${awardRows.length} recorded prime award${awardRows.length === 1 ? '' : 's'} in the past-performance table and match each to the buyer you are writing to.`
        : '**Past performance.** Pull your strongest prime and subcontract references for the pathways above.',
      claim: 'recommendation',
      cites: SRC,
    },
    ...(selfLines.length
      ? selfLines.slice(0, 5).map((line) => ({
        // recommendation + cites: dollar/count self-report must cite (validateDocModel).
        text: `**Self-reported.** Confirm this detail from the customer message before pursuit: ${line}`,
        claim: 'recommendation' as const,
        cites: SRC,
      }))
      : [{
        text: '**Bonding, equipment and credentials.** None were provided in this turn. Confirm them before pursuit.',
        claim: 'recommendation' as const,
        cites: SRC,
      }]),
    {
      text: '**Registration and fit.** Confirm your SAM registration, NAICS list and set-aside status match the pathways above before a capability statement goes out.',
      claim: 'recommendation',
      cites: SRC,
    },
    {
      text: '**Team and surge plan.** Name your design, inspection or joint-venture partner and your surge plan before the buyer asks.',
      claim: 'recommendation',
      cites: SRC,
    },
  ];
  sections.push({
    id: 'sec-ready',
    heading: 'Readiness checklist: what these buyers will ask to see',
    blocks: [{ type: 'bullets', id: 'b-ready', ordered: false, items: readyItems }],
  });

  const model: DocModel = {
    schema: DOC_SCHEMA,
    title: `${company} Federal Market Profile`,
    ...(subtitle ? { subtitle } : {}),
    date,
    preparedFor: company,
    sources: [{
      id: 's1',
      label: 'Ask Mindy FMP tool results (this turn)',
      kind: 'tool',
      retrievedAt: date,
    }],
    sections,
    theme: 'mindy',
    meta: { generatedBy: 'ask_mindy_fmp_host' },
  };

  // Required snippets that no section carried (e.g. a bare vehicle token) land in the pathways section.
  const flatLower = flattenDocModelText(model).toLowerCase();
  const missing = snippets.filter((s) => !flatLower.includes(s.toLowerCase()));
  if (missing.length) {
    model.sections[1].blocks.push(para('p-pathway-anchors', `Evidence anchors from this turn: ${missing.map(snippetAnchor).join('; ')}.`));
  }
  return model;
}

/** JSON arguments for a host-injected create_document call (never `{}`). */
export function buildFmpCreateDocumentInjectArgs(
  evidence: FmpWriteupEvidence,
  opts: BuildFmpHostDocModelOpts = {},
): string {
  return JSON.stringify({ doc_model: buildFmpHostDocModel(evidence, opts) });
}

// ── Prefer a rich planner DocModel over the host rescue model ─────────────────────────────────────

/** A planner model must carry at least this much text to beat the host model. */
export const FMP_PLANNER_MIN_CHARS = 3500;
/** ...and at least this many who-to-talk rows with a person-shaped name. */
export const FMP_PLANNER_MIN_PERSON_ROWS = 2;

export type ResolveFmpCreateDocumentOpts = BuildFmpHostDocModelOpts & {
  /** Defaults to requiredSnippetsForWriteup(evidence). */
  requiredSnippets?: string[];
};

export interface FmpDocModelRichness {
  chars: number;
  whoToTalkPersonRows: number;
  hasPathways: boolean;
}

const LEADING_TITLE_RE = /^(?:Mr|Ms|Mrs|Dr|Col|Maj|Capt|Lt|Gen|CAPT|COL|LTC|CDR)\.?\s+/;

/** The person-like head of a who-to-talk cell ("Jane Doe, Federal Highway, j@x.gov" -> "Jane Doe"). */
function personHeadOfCell(cell: unknown): string {
  const t = String(cell ?? '').replace(/\*\*|_/g, '').replace(/\S+@\S+/g, ' ').trim();
  return (t.split(/[,;(|\n]|\s-\s|\sat\s/)[0] ?? '').trim().replace(LEADING_TITLE_RE, '');
}

function whoToTalkTables(model: DocModel): Array<Extract<Block, { type: 'table' }>> {
  const out: Array<Extract<Block, { type: 'table' }>> = [];
  for (const s of model.sections ?? []) {
    const headingHit = WRITEUP_DOCTRINE.whoToTalkHeadingSynonyms.some((re) => re.test(s.heading));
    for (const b of s.blocks ?? []) {
      if (b.type !== 'table') continue;
      const hits = b.columns.filter((c) =>
        WRITEUP_DOCTRINE.whoToTalkTableColumnHints.some((re) => re.test(c.label))).length;
      if (headingHit || hits >= 2) out.push(b);
    }
  }
  return out;
}

function personColumnKey(table: Extract<Block, { type: 'table' }>): string | null {
  const col = table.columns.find((c) => /person|contact|name|who/i.test(c.label)) ?? table.columns[0];
  return col?.key ?? null;
}

/** Who-to-talk rows whose person cell does not name a person (placeholder, procurement phrase, org). */
function nonPersonWhoRows(model: DocModel): number {
  let n = 0;
  for (const table of whoToTalkTables(model)) {
    const key = personColumnKey(table);
    if (!key) continue;
    for (const row of table.rows) {
      const head = personHeadOfCell(row[key]);
      if (head && !looksLikePersonContactName(head)) n++;
    }
  }
  return n;
}

/** Rows whose person cell is an organization (IRS, an agency) instead of a person. */
function agencyAsPersonRows(model: DocModel): number {
  let n = 0;
  for (const table of whoToTalkTables(model)) {
    const key = personColumnKey(table);
    if (!key) continue;
    for (const row of table.rows) {
      const cell = String(row[key] ?? '');
      if (IRS_LIKE.test(cell)) { n++; continue; }
      const head = personHeadOfCell(cell);
      if (!head || looksLikePersonContactName(head)) continue;
      const words = head.split(/\s+/);
      if (words.length >= 2 && words.length <= 6 && words.every((w) => /^[A-Z]/.test(w)) && words.some((w) => ORG_WORDS.has(w.toLowerCase()))) n++;
    }
  }
  return n;
}

export function fmpDocModelRichness(model: DocModel): FmpDocModelRichness {
  let people = 0;
  for (const table of whoToTalkTables(model)) {
    const key = personColumnKey(table);
    if (!key) continue;
    for (const row of table.rows) {
      if (looksLikePersonContactName(personHeadOfCell(row[key]))) people++;
    }
  }
  return {
    chars: flattenDocModelText(model).length,
    whoToTalkPersonRows: people,
    hasPathways: (model.sections ?? []).some((s) =>
      WRITEUP_DOCTRINE.pathwayHeadingSynonyms.some((re) => re.test(s.heading))),
  };
}

function parsePlannerDocModel(plannerArgs: string): { parsed: Record<string, unknown>; model: DocModel } | null {
  if (!createDocumentArgsHaveUsableDocModel(plannerArgs)) return null;
  try {
    const parsed = JSON.parse(plannerArgs) as Record<string, unknown>;
    return { parsed, model: parsed.doc_model as DocModel };
  } catch {
    return null;
  }
}

/**
 * Keep the planner's DocModel only when it already beats the host rescue model on content:
 * valid shape, passes the FMP gate (structure, required snippets, bans incl. Mid CTA), is
 * dense enough, and its who-to-talk table names real people (no IRS / agency-as-person).
 */
export function shouldPreferPlannerFmpDocModel(
  plannerArgs: string,
  evidence: FmpWriteupEvidence,
  opts: ResolveFmpCreateDocumentOpts = {},
): { prefer: boolean; reason: string; model?: DocModel } {
  const planner = parsePlannerDocModel(plannerArgs);
  if (!planner) return { prefer: false, reason: 'no_usable_doc_model' };

  const shape = validateDocModel(planner.model);
  if (!shape.ok) return { prefer: false, reason: `invalid_doc_model:${shape.issues[0]?.path ?? 'unknown'}` };

  const v = validateFmpWriteup(planner.model, {
    defenseBuyersAppear: !!opts.defenseBuyersAppear
      || fmpDefenseBuyersAppear(opts.customerText || '')
      || fmpDefenseBuyersAppearFromEvidence(evidence),
    requiredSnippets: opts.requiredSnippets ?? requiredSnippetsForWriteup(evidence),
  });
  if (v.issues.some((i) => i.code === 'mid_cta_ban')) return { prefer: false, reason: 'mid_cta_ban' };
  if (!v.ok || !v.model) {
    const codes = [...new Set(v.issues.filter((i) => i.severity === 'error').map((i) => i.code))];
    return { prefer: false, reason: `fmp_writeup_invalid:${codes.join(',')}` };
  }

  const rich = fmpDocModelRichness(v.model);
  if (rich.chars < FMP_PLANNER_MIN_CHARS) return { prefer: false, reason: `too_thin:${rich.chars}` };
  if (rich.whoToTalkPersonRows < FMP_PLANNER_MIN_PERSON_ROWS) {
    return { prefer: false, reason: `who_to_talk_person_rows:${rich.whoToTalkPersonRows}` };
  }
  if (!rich.hasPathways) return { prefer: false, reason: 'no_pathways' };
  if (agencyAsPersonRows(v.model) > 0) return { prefer: false, reason: 'irs_like_contact' };
  if (nonPersonWhoRows(v.model) > 0) return { prefer: false, reason: 'non_person_contact' };
  return { prefer: true, reason: 'planner_rich_valid', model: v.model };
}

/**
 * create_document arguments for an FMP turn: the planner's rich DocModel when it clears the bar,
 * otherwise the host model. Pass plannerArgs '{}' to force the host model (empty-planner inject).
 */
export function resolveFmpCreateDocumentArgs(
  plannerArgs: string,
  evidence: FmpWriteupEvidence,
  opts: ResolveFmpCreateDocumentOpts = {},
): { args: string; source: 'planner' | 'host'; notice: string; reason: string } {
  const pick = shouldPreferPlannerFmpDocModel(plannerArgs, evidence, opts);
  if (pick.prefer && pick.model) {
    let base: Record<string, unknown> = {};
    try { base = JSON.parse(plannerArgs) as Record<string, unknown>; } catch { /* keep {} */ }
    return {
      args: JSON.stringify({ ...base, doc_model: pick.model }),
      source: 'planner',
      notice: 'fmp_create_document:planner_doc_model_kept',
      reason: pick.reason,
    };
  }
  return {
    args: buildFmpCreateDocumentInjectArgs(evidence, opts),
    source: 'host',
    notice: 'fmp_create_document:host_doc_model_forced',
    reason: pick.reason,
  };
}
