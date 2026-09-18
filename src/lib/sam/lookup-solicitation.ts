/**
 * Historical solicitation lookup — corpus + caller history, not FIND.
 *
 * Closed ≠ gone. Does not scan sow_text. Does not call external APIs.
 * Reuses #1557 resolveCanonicalSolicitation for identifiers and family upgrade.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { canonicalListingKey } from '@/lib/opportunities/canonical-listing';
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';
import { extractNoticePoc } from '@/lib/proposal/notice-poc';
import {
  classifySolicitationIntent,
  extractIdentifierTokens,
  namedProgramTokens,
  type SolicitationIntent,
} from '@/lib/sam/solicitation-intent';
import {
  deriveSolicitationStatus,
  extractAmendmentLabel,
  isNoticeUuid,
  normalizeNoticeUuid,
  resolveCanonicalSolicitation,
  selectCanonicalVersion,
  type CanonicalSolicitation,
  type SolicitationStatus,
  type SolicitationVersionRow,
} from '@/lib/sam/resolve-solicitation';

export const LOOKUP_CANDIDATE_CAP = 50;
export const LOOKUP_HISTORY_CAP = 200;

const LOOKUP_COLS =
  'notice_id,solicitation_number,title,department,sub_tier,office,naics_code,psc_code,set_aside_description,notice_type,posted_date,response_deadline,archive_date,active,description,ui_link,agency_hierarchy,office_address,points_of_contact';

export type LookupKind = 'RESOLVED_SOLICITATION' | 'MATCHED_CANDIDATE';
export type AwardStatus = 'AWARD_KNOWN' | 'AWARD_NOT_ESTABLISHED';
export type WhyMatched =
  | 'user_pursuit'
  | 'exact_identifier'
  | 'exact_title'
  | 'program_acronym'
  | 'buyer_capability_date'
  | 'strong_title'
  | 'weaker_token'
  | 'filename';

export type LookupDb = Pick<SupabaseClient, 'from'>;

export interface LookupSolicitationInput {
  query: string;
  /** Session identity — never a model-supplied email. */
  userEmail?: string | null;
  /** After "yes that's the one" — UUID or solicitation token. */
  confirm_notice_id?: string | null;
  client?: LookupDb;
  now?: Date;
}

export interface LookupContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface LookupItem {
  kind: LookupKind;
  title: string | null;
  identifiers: string[];
  status: SolicitationStatus;
  award_status: AwardStatus;
  latest_amendment: string | null;
  response_deadline: string | null;
  posted_date: string | null;
  archive_date: string | null;
  buyer: string | null;
  office_dodaac: string | null;
  naics: string | null;
  psc: string | null;
  contact: LookupContact | null;
  notice_id: string;
  why_matched: WhyMatched[];
  provenance: string;
  not_biddable: boolean;
  version_count: number;
}

export interface LookupSolicitationResult {
  intent: SolicitationIntent;
  query: string;
  items: LookupItem[];
  next_prompt: string | null;
  host_rules: string[];
  _meta: {
    grounded: boolean;
    candidate_count: number;
    collapsed_count: number;
    history_matches: number;
    corpus_matches: number;
    rows_before_collapse: number;
    db_ms: number;
    sow_text_used: false;
    external_api: false;
  };
}

type LookupRow = SolicitationVersionRow & {
  agency_hierarchy?: string | null;
  office_address?: unknown;
  points_of_contact?: unknown;
};

const STOP = new Set([
  'the', 'and', 'or', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'with', 'is', 'are',
  'that', 'this', 'i', 'we', 'my', 'our', 'me', 'can', 'you', 'find', 'it', 'at',
  'bid', 'submitted', 'proposal', 'recently', 'last', 'month', 'week', 'old',
  'previous', 'happened', 'what', 'show', 'solicitation', 'opportunities',
  'opportunity', 'navy', 'want', 'work', 'sell', 'available',
]);

const CAPABILITY_HINTS = [
  'manufacturing', 'construction', 'cyber', 'cybersecurity', 'roofing', 'janitorial',
  'hvac', 'staffing', 'logistics', 'engineering', 'software',
];

function dbFromEnv(): LookupDb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function escapeIlike(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function dateMs(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

export interface LookupNeedles {
  identifiers: string[];
  acronyms: string[];
  capability: string[];
  buyerGeo: string[];
  buyerOrg: string[];
  recentlyDays: number | null;
  tokens: string[];
}

export function parseLookupQuery(raw: string, _now: Date = new Date()): LookupNeedles {
  const q = String(raw || '').trim();
  const identifiers = extractIdentifierTokens(q);
  const acronyms = namedProgramTokens(q);
  const buyerGeo: string[] = [];
  if (/indian\s+head/i.test(q)) buyerGeo.push('Indian Head');
  const atPlace = q.match(/\bat\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\b/);
  if (atPlace && !/indian\s+head/i.test(atPlace[1])) buyerGeo.push(atPlace[1]);
  const buyerOrg: string[] = [];
  if (/\bnavy\b/i.test(q)) buyerOrg.push('NAVY');
  if (/\bnswc\b/i.test(q)) buyerOrg.push('NSWC');
  if (/\bnavsea\b/i.test(q)) buyerOrg.push('NAVSEA');
  const capability = CAPABILITY_HINTS.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(q));
  let recentlyDays: number | null = null;
  if (/\blast month\b|\blast week\b/i.test(q)) recentlyDays = 45;
  else if (/\brecently\b|\brecent\b/i.test(q)) recentlyDays = 120;
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const rawTok of q.split(/[\s,;/]+/)) {
    const w = rawTok.trim().toLowerCase().replace(/[^a-z0-9&-]/g, '');
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    tokens.push(w);
    if (tokens.length >= 8) break;
  }
  return { identifiers, acronyms, capability, buyerGeo, buyerOrg, recentlyDays, tokens };
}

function officeCity(row: LookupRow): string {
  const addr = row.office_address;
  if (!addr || typeof addr !== 'object') return '';
  return String((addr as { city?: string }).city || '');
}

function dodaacFromSol(sol: string | null): string | null {
  const t = String(sol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = t.slice(0, 6);
  return isValidDodaac(prefix) ? prefix : null;
}

function awardStatusFor(row: LookupRow): AwardStatus {
  const nt = String(row.notice_type || '');
  if (/\baward\b/i.test(nt) && !/\bsolicitation\b/i.test(nt)) return 'AWARD_KNOWN';
  return 'AWARD_NOT_ESTABLISHED';
}

function contactFor(row: LookupRow): LookupContact | null {
  const poc = extractNoticePoc({ pointOfContact: row.points_of_contact });
  const p = poc.primary;
  if (!p || (!p.fullName && !p.email)) return null;
  return { name: p.fullName, email: p.email, phone: p.phone };
}

function identifiersFor(query: string, row: LookupRow, extra: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = String(v || '').trim();
    if (!t) return;
    const key = t.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  add(query);
  add(row.solicitation_number);
  add(row.notice_id);
  for (const x of extra) add(x);
  const rfp = row.description?.match(/\bN\d{5,}[A-Z0-9]*\b/i);
  if (rfp) add(rfp[0]);
  return out.filter((id) => id !== query || extractIdentifierTokens(query).length > 0 || isNoticeUuid(query));
}

export function whyMatchedFor(
  row: LookupRow,
  needles: LookupNeedles,
  flags: { fromHistory: boolean; fromFilename: boolean },
): WhyMatched[] {
  const why: WhyMatched[] = [];
  if (flags.fromHistory) why.push('user_pursuit');
  if (flags.fromFilename) why.push('filename');
  const title = (row.title || '').toUpperCase();
  const sol = (row.solicitation_number || '').toUpperCase();
  const desc = (row.description || '').toUpperCase();
  for (const id of needles.identifiers) {
    const u = id.toUpperCase();
    if (sol.includes(u) || desc.includes(u) || normalizeNoticeUuid(row.notice_id) === normalizeNoticeUuid(id)) {
      why.push('exact_identifier');
      break;
    }
  }
  for (const ac of needles.acronyms) {
    const token = `(${ac})`;
    if (title.includes(token.toUpperCase()) || new RegExp(`\\b${ac}\\b`, 'i').test(row.title || '')) {
      why.push('program_acronym');
      why.push('exact_title');
      break;
    }
  }
  const hier = String(row.agency_hierarchy || '');
  const geoHit = needles.buyerGeo.some((g) =>
    hier.toLowerCase().includes(g.toLowerCase()) || officeCity(row).toLowerCase().includes(g.toLowerCase()),
  );
  const capHit = needles.capability.some((c) => (row.title || '').toLowerCase().includes(c));
  if (geoHit && capHit) why.push('buyer_capability_date');
  else if (capHit) why.push('strong_title');
  if (!why.length) why.push('weaker_token');
  return [...new Set(why)];
}

export function rankScore(why: WhyMatched[], posted: string | null, now: Date): number {
  let score = 0;
  if (why.includes('user_pursuit')) score += 1000;
  if (why.includes('exact_identifier')) score += 800;
  if (why.includes('exact_title') || why.includes('program_acronym')) score += 600;
  if (why.includes('filename')) score += 550;
  if (why.includes('buyer_capability_date')) score += 400;
  if (why.includes('strong_title')) score += 200;
  if (why.includes('weaker_token') && score === 0) score += 50;
  const postedMs = dateMs(posted);
  if (Number.isFinite(postedMs) && postedMs > 0) {
    const ageDays = Math.max(0, (now.getTime() - postedMs) / 86400000);
    score += Math.max(0, 20 - ageDays / 30);
  }
  return score;
}

export function collapseLookupRows(rows: LookupRow[]): LookupRow[] {
  const byKey = new Map<string, LookupRow[]>();
  for (const r of rows) {
    const key = canonicalListingKey(r);
    if (!key) continue;
    const cur = byKey.get(key) || [];
    cur.push(r);
    byKey.set(key, cur);
  }
  const out: LookupRow[] = [];
  for (const group of byKey.values()) {
    const canonical = selectCanonicalVersion(group);
    if (canonical) out.push(canonical);
  }
  out.sort((a, b) => dateMs(b.posted_date) - dateMs(a.posted_date));
  return out;
}

function toItem(
  row: LookupRow,
  kind: LookupKind,
  why: WhyMatched[],
  provenance: string,
  extraIds: string[],
  query: string,
  now: Date,
  versionCount: number,
): LookupItem {
  const status = deriveSolicitationStatus(row, now);
  const buyerLeaf = String(row.agency_hierarchy || '').split('.').filter(Boolean).pop()
    || row.sub_tier
    || row.department
    || null;
  return {
    kind,
    title: row.title,
    identifiers: identifiersFor(query, row, extraIds),
    status,
    award_status: awardStatusFor(row),
    latest_amendment: extractAmendmentLabel(row.description),
    response_deadline: row.response_deadline,
    posted_date: row.posted_date,
    archive_date: row.archive_date,
    buyer: buyerLeaf,
    office_dodaac: dodaacFromSol(row.solicitation_number),
    naics: row.naics_code,
    psc: row.psc_code,
    contact: contactFor(row),
    notice_id: row.notice_id,
    why_matched: why,
    provenance,
    not_biddable: status !== 'open',
    version_count: versionCount,
  };
}

export function pickHandoff(items: LookupItem[], historyOlder: boolean): string | null {
  const resolved = items.find((i) => i.kind === 'RESOLVED_SOLICITATION') ?? (items.length === 1 ? items[0] : null);
  if (!resolved) {
    if (items.length > 1) return 'Which of these is the one you mean?';
    return null;
  }
  if (historyOlder) {
    return 'You worked from an earlier stored version. Want me to show what changed?';
  }
  if (resolved.award_status === 'AWARD_NOT_ESTABLISHED' && resolved.not_biddable) {
    return "An award isn't in Mindy yet. Want me to check whether one has appeared?";
  }
  if (resolved.contact?.name || resolved.contact?.email) {
    return 'I have the contracting contact. Want that?';
  }
  return null;
}

const HOST_RULES = [
  'This is lookup_solicitation — not find_opportunities. Do not call FIND.',
  'MATCHED_CANDIDATE is not identity. Never silently merge or pick the top hit as "the" solicitation.',
  'Same solicitation_number may collapse amendments; different numbers stay separate candidates.',
  'Closed/archived means not_biddable=true. Closed is not awarded. award_status is independent.',
  'After the user confirms ("yes, that\'s the one"), call lookup_solicitation with confirm_notice_id.',
  'Offer at most ONE next_prompt. Wait. Do not invent awards, debrief timing, or a post-award checklist. Do not auto-call paid tools.',
  'No web search for facts already returned.',
];

async function fetchByNoticeIds(sb: LookupDb, ids: string[]): Promise<LookupRow[]> {
  const uniq = [...new Set(ids.map((id) => normalizeNoticeUuid(id)).filter(Boolean))];
  if (!uniq.length) return [];
  const rows: LookupRow[] = [];
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const { data, error } = await sb.from('sam_opportunities').select(LOOKUP_COLS).in('notice_id', chunk).limit(LOOKUP_CANDIDATE_CAP);
    if (error) throw error;
    rows.push(...((data || []) as LookupRow[]));
  }
  return rows;
}

function withinRecent(row: LookupRow, days: number | null, now: Date): boolean {
  if (!days) return true;
  const cutoff = now.getTime() - days * 86400000;
  const posted = dateMs(row.posted_date);
  const deadline = dateMs(row.response_deadline);
  return posted >= cutoff || deadline >= cutoff;
}

async function searchTitleAcronym(sb: LookupDb, acronym: string): Promise<LookupRow[]> {
  const esc = escapeIlike(acronym);
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(LOOKUP_COLS)
    .ilike('title', `%${esc}%`)
    .limit(LOOKUP_CANDIDATE_CAP);
  if (error) throw error;
  return (data || []) as LookupRow[];
}

async function searchTsvToken(sb: LookupDb, token: string): Promise<LookupRow[]> {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(LOOKUP_COLS)
    .textSearch('search_tsv', token, { type: 'plain' })
    .limit(LOOKUP_CANDIDATE_CAP);
  if (error) {
    return [];
  }
  return (data || []) as LookupRow[];
}

/**
 * Title capability AND buyer geography. Hierarchy/office city only after title
 * narrows — never an unbounded agency_hierarchy scan.
 */
async function searchCapabilityBuyer(sb: LookupDb, capability: string, geo: string): Promise<LookupRow[]> {
  const cap = escapeIlike(capability);
  const g = escapeIlike(geo);
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(LOOKUP_COLS)
    .ilike('title', `%${cap}%`)
    .or(`agency_hierarchy.ilike.%${g}%,office_address->>city.ilike.%${g}%,sub_tier.ilike.%${g}%`)
    .limit(LOOKUP_CANDIDATE_CAP);
  if (error) throw error;
  return (data || []) as LookupRow[];
}

async function searchHistory(
  sb: LookupDb,
  email: string,
  needles: LookupNeedles,
): Promise<{ noticeIds: string[]; filenameHits: Set<string> }> {
  const filenameHits = new Set<string>();
  const noticeIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    const t = String(id || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    noticeIds.push(t);
  };

  const { data: pipe, error: pErr } = await sb
    .from('user_pipeline')
    .select('notice_id,title,agency')
    .eq('user_email', email)
    .limit(LOOKUP_HISTORY_CAP);
  if (pErr) throw pErr;
  const hayNeedles = [
    ...needles.acronyms,
    ...needles.capability,
    ...needles.buyerGeo,
    ...needles.tokens,
  ].map((s) => s.toLowerCase());
  for (const row of (pipe || []) as Array<{ notice_id?: string; title?: string; agency?: string }>) {
    const hay = `${row.title || ''} ${row.agency || ''}`.toLowerCase();
    if (!hayNeedles.length || hayNeedles.some((n) => n.length >= 3 && hay.includes(n.toLowerCase()))) {
      add(row.notice_id);
    }
  }

  const { data: docs, error: dErr } = await sb
    .from('pursuit_documents')
    .select('notice_id,filename')
    .eq('user_email', email)
    .limit(LOOKUP_HISTORY_CAP);
  if (dErr) throw dErr;
  for (const row of (docs || []) as Array<{ notice_id?: string; filename?: string }>) {
    const fn = (row.filename || '').toLowerCase();
    const hit = hayNeedles.some((n) => n.length >= 3 && fn.includes(n.toLowerCase()))
      || needles.acronyms.some((a) => fn.includes(a.toLowerCase()))
      || needles.identifiers.some((id) => fn.includes(id.toLowerCase()));
    if (hit) {
      add(row.notice_id);
      if (row.notice_id) filenameHits.add(row.notice_id);
    }
  }

  const { data: saved, error: sErr } = await sb
    .from('user_saved_opportunities')
    .select('notice_id,title')
    .eq('user_email', email)
    .limit(LOOKUP_HISTORY_CAP);
  if (!sErr) {
    for (const row of (saved || []) as Array<{ notice_id?: string; title?: string }>) {
      const hay = (row.title || '').toLowerCase();
      if (!hayNeedles.length || hayNeedles.some((n) => n.length >= 3 && hay.includes(n.toLowerCase()))) {
        add(row.notice_id);
      }
    }
  }

  return { noticeIds, filenameHits };
}

function fromCanonical(c: CanonicalSolicitation, extra?: Partial<LookupRow>): LookupRow {
  return { ...c.notice, ...extra };
}

export async function lookupSolicitation(
  input: LookupSolicitationInput,
): Promise<LookupSolicitationResult> {
  const t0 = Date.now();
  const query = String(input.query || '').trim();
  const now = input.now ?? new Date();
  const intent = classifySolicitationIntent(
    input.confirm_notice_id ? String(input.confirm_notice_id) : query,
  );
  const empty = (extra: Partial<LookupSolicitationResult['_meta']> = {}): LookupSolicitationResult => ({
    intent: classifySolicitationIntent(query),
    query,
    items: [],
    next_prompt: null,
    host_rules: HOST_RULES,
    _meta: {
      grounded: false,
      candidate_count: 0,
      collapsed_count: 0,
      history_matches: 0,
      corpus_matches: 0,
      rows_before_collapse: 0,
      db_ms: Date.now() - t0,
      sow_text_used: false,
      external_api: false,
      ...extra,
    },
  });

  const sb = input.client ?? dbFromEnv();
  if (!sb || (!query && !input.confirm_notice_id)) return empty();

  const confirm = String(input.confirm_notice_id || '').trim();
  const knownQuery = confirm || extractIdentifierTokens(query)[0] || '';
  if (confirm || intent === 'KNOWN_ID' || knownQuery) {
    let resolved = await resolveCanonicalSolicitation(confirm || knownQuery || query, { client: sb, now });
    if (!resolved) return empty({ db_ms: Date.now() - t0 });
    // Confirming a candidate upgrades the family to current truth. A UUID typed
    // as the query itself stays that exact record (#1557).
    if (confirm && isNoticeUuid(confirm) && resolved.notice.solicitation_number) {
      const latest = await resolveCanonicalSolicitation(resolved.notice.solicitation_number, { client: sb, now });
      if (latest) resolved = latest;
    }
    const enriched = await fetchByNoticeIds(sb, [resolved.notice.notice_id]);
    const row = enriched[0] ?? fromCanonical(resolved);
    const item = toItem(
      row,
      'RESOLVED_SOLICITATION',
      isNoticeUuid(confirm || knownQuery) ? ['exact_identifier'] : ['exact_identifier'],
      'sam_opportunities',
      resolved.identifiers,
      query || resolved.queried,
      now,
      resolved.version_count,
    );
    item.status = resolved.status;
    item.latest_amendment = resolved.amendment;
    item.response_deadline = resolved.response_deadline;
    item.not_biddable = resolved.status !== 'open';
    return {
      intent: 'KNOWN_ID',
      query: query || resolved.queried,
      items: [item],
      next_prompt: pickHandoff([item], false),
      host_rules: HOST_RULES,
      _meta: {
        grounded: true,
        candidate_count: 1,
        collapsed_count: 1,
        history_matches: 0,
        corpus_matches: resolved.version_count,
        rows_before_collapse: resolved.version_count,
        db_ms: Date.now() - t0,
        sow_text_used: false,
        external_api: false,
      },
    };
  }

  const needles = parseLookupQuery(query, now);
  const email = String(input.userEmail || '').trim().toLowerCase() || null;

  const historyIds: string[] = [];
  const filenameHits = new Set<string>();
  if (email) {
    const hist = await searchHistory(sb, email, needles);
    historyIds.push(...hist.noticeIds);
    hist.filenameHits.forEach((id) => filenameHits.add(id));
  }

  const corpus: LookupRow[] = [];
  const seenNid = new Set<string>();
  const pushRows = (rows: LookupRow[]) => {
    for (const r of rows) {
      if (!r.notice_id || seenNid.has(r.notice_id)) continue;
      if (!withinRecent(r, needles.recentlyDays, now)) continue;
      seenNid.add(r.notice_id);
      corpus.push(r);
    }
  };

  for (const ac of needles.acronyms) {
    pushRows(await searchTitleAcronym(sb, ac));
    if (corpus.length < LOOKUP_CANDIDATE_CAP) pushRows(await searchTsvToken(sb, ac));
  }
  for (const cap of needles.capability) {
    for (const geo of needles.buyerGeo) {
      pushRows(await searchCapabilityBuyer(sb, cap, geo));
    }
  }

  let historyRows: LookupRow[] = [];
  if (historyIds.length) {
    historyRows = await fetchByNoticeIds(sb, historyIds);
    pushRows(historyRows);
  }

  const rowsBefore = corpus.length;
  const collapsed = collapseLookupRows(corpus).slice(0, LOOKUP_CANDIDATE_CAP);

  const historySet = new Set(historyIds.map((id) => normalizeNoticeUuid(id)));
  const historyFamilyKeys = new Set(historyRows.map((r) => canonicalListingKey(r)).filter(Boolean));
  const filenameFamilyKeys = new Set(
    historyRows
      .filter((r) => filenameHits.has(r.notice_id) || filenameHits.has(normalizeNoticeUuid(r.notice_id)))
      .map((r) => canonicalListingKey(r))
      .filter(Boolean),
  );

  const preScored = collapsed.map((row) => {
    const family = canonicalListingKey(row);
    const why = whyMatchedFor(row, needles, {
      fromHistory: historySet.has(normalizeNoticeUuid(row.notice_id)) || historyFamilyKeys.has(family),
      fromFilename: filenameHits.has(row.notice_id) || filenameFamilyKeys.has(family),
    });
    return { row, why, score: rankScore(why, row.posted_date, now) };
  });
  preScored.sort((a, b) => b.score - a.score || dateMs(b.row.posted_date) - dateMs(a.row.posted_date));

  const UPGRADE_CAP = 10;
  const upgraded: Array<{ row: LookupRow; why: WhyMatched[]; score: number }> = [];
  const versionCounts = new Map<string, number>();
  for (let i = 0; i < preScored.length; i++) {
    const cur = preScored[i];
    const sol = String(cur.row.solicitation_number || '').trim();
    if (i < UPGRADE_CAP && sol && !isNoticeUuid(query)) {
      const canon = await resolveCanonicalSolicitation(sol, { client: sb, now });
      if (canon) {
        const extra = await fetchByNoticeIds(sb, [canon.notice.notice_id]);
        const row = extra[0] ?? fromCanonical(canon, {
          agency_hierarchy: cur.row.agency_hierarchy,
          office_address: cur.row.office_address,
          points_of_contact: cur.row.points_of_contact,
        });
        versionCounts.set(row.notice_id, canon.version_count);
        const family = canonicalListingKey(row);
        const why = whyMatchedFor(row, needles, {
          fromHistory: historySet.has(normalizeNoticeUuid(row.notice_id)) || historyFamilyKeys.has(family),
          fromFilename: filenameHits.has(row.notice_id) || filenameFamilyKeys.has(family),
        });
        upgraded.push({ row, why, score: rankScore(why, row.posted_date, now) });
        continue;
      }
    }
    versionCounts.set(cur.row.notice_id, 1);
    upgraded.push(cur);
  }
  upgraded.sort((a, b) => b.score - a.score || dateMs(b.row.posted_date) - dateMs(a.row.posted_date));
  const scored = upgraded;

  const uniqueFamilies = new Set(scored.map((s) => canonicalListingKey(s.row)));
  const items: LookupItem[] = scored.map((s) => {
    const provenance = historySet.has(normalizeNoticeUuid(s.row.notice_id))
      ? 'user_pipeline+sam_opportunities'
      : 'sam_opportunities';
    return toItem(
      s.row,
      'MATCHED_CANDIDATE',
      s.why,
      provenance,
      [],
      query,
      now,
      versionCounts.get(s.row.notice_id) || 1,
    );
  });

  const historyOlder = historyRows.some((h) => {
    const top = items[0];
    return top && h.notice_id !== top.notice_id && canonicalListingKey(h) === canonicalListingKey({
      notice_id: top.notice_id,
      solicitation_number: top.identifiers.find((id) => !isNoticeUuid(id)) || null,
    });
  });

  return {
    intent: 'HISTORICAL',
    query,
    items,
    next_prompt: pickHandoff(items, historyOlder),
    host_rules: HOST_RULES,
    _meta: {
      grounded: items.length > 0,
      candidate_count: items.length,
      collapsed_count: uniqueFamilies.size,
      history_matches: historyIds.length,
      corpus_matches: rowsBefore,
      rows_before_collapse: rowsBefore,
      db_ms: Date.now() - t0,
      sow_text_used: false,
      external_api: false,
    },
  };
}
