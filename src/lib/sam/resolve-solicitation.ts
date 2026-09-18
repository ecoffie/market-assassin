/**
 * Canonical known-ID resolution for a SAM solicitation.
 *
 * NOT a FIND / historical-search product. Callers already have an identifier.
 * Does not change SAM ingestion. Does not use sow_text.
 *
 * Identity: trim → notice UUID (exact record, no family upgrade) →
 * solicitation_number (indexed) → description identifier (bounded, no sow_text).
 * Version (family ids only): posted_date DESC, then notice_id DESC.
 * Status: OPEN only when active=true AND (no deadline OR deadline is future).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SOLICITATION_RESOLVE_COLS =
  'notice_id,solicitation_number,title,department,sub_tier,office,naics_code,psc_code,set_aside_description,notice_type,posted_date,response_deadline,archive_date,active,description,ui_link';

const FAMILY_CAP = 50;
const DESCRIPTION_HIT_CAP = 25;

export type SolicitationStatus = 'open' | 'closed' | 'archived' | 'unknown';
export type SolicitationMatchBy = 'notice_id' | 'solicitation_number' | 'description_identifier';

export interface SolicitationVersionRow {
  notice_id: string;
  solicitation_number: string | null;
  title: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  naics_code: string | null;
  psc_code: string | null;
  set_aside_description: string | null;
  notice_type: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  archive_date: string | null;
  active: boolean | null;
  description: string | null;
  ui_link: string | null;
}

export interface CanonicalSolicitation {
  queried: string;
  notice: SolicitationVersionRow;
  status: SolicitationStatus;
  response_deadline: string | null;
  amendment: string | null;
  matched_by: SolicitationMatchBy;
  identifiers: string[];
  version_count: number;
  source: 'sam_opportunities';
  versions: Array<{
    notice_id: string;
    posted_date: string | null;
    response_deadline: string | null;
    active: boolean | null;
  }>;
}

type ResolveDb = Pick<SupabaseClient, 'from'>;

function db(): ResolveDb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function normalizeSolicitationQuery(raw: string): string {
  return String(raw || '').trim();
}

export function isNoticeUuid(raw: string): boolean {
  const t = raw.trim();
  return /^[a-f0-9]{32}$/i.test(t) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(t);
}

export function normalizeNoticeUuid(raw: string): string {
  const t = raw.trim().replace(/-/g, '').toLowerCase();
  return t.length === 32 ? t : raw.trim();
}

/** Alphanumeric solicitation token — not free text, not a UUID. */
export function isSolicitationIdentifier(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 8 || t.length > 40) return false;
  if (isNoticeUuid(t)) return false;
  if (/\s/.test(t)) return false;
  if (!/\d/.test(t)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(t);
}

function escapeIlike(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function dateMs(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

export function selectCanonicalVersion<T extends { posted_date?: string | null; notice_id?: string | null }>(
  rows: T[],
): T | null {
  if (!rows.length) return null;
  const ranked = [...rows].sort((a, b) => {
    const posted = dateMs(b.posted_date) - dateMs(a.posted_date);
    if (posted !== 0) return posted;
    return String(b.notice_id || '').localeCompare(String(a.notice_id || ''));
  });
  return ranked[0] ?? null;
}

export function deriveSolicitationStatus(
  row: { active: boolean | null; response_deadline: string | null; archive_date: string | null },
  now: Date = new Date(),
): SolicitationStatus {
  const nowMs = now.getTime();
  const deadlineMs = row.response_deadline ? Date.parse(row.response_deadline) : NaN;
  const archiveMs = row.archive_date ? Date.parse(row.archive_date) : NaN;
  const deadlineExists = Number.isFinite(deadlineMs);
  const deadlineFuture = !deadlineExists || deadlineMs > nowMs;
  if (row.active === true && deadlineFuture) return 'open';
  if (Number.isFinite(archiveMs) && archiveMs <= nowMs) return 'archived';
  if (row.active === false) return 'closed';
  if (deadlineExists && deadlineMs <= nowMs) return 'closed';
  if (row.active == null) return 'unknown';
  return 'closed';
}

export function solicitationStatusLabel(status: SolicitationStatus): string {
  switch (status) {
    case 'open': return 'Open solicitation';
    case 'closed': return 'Closed solicitation';
    case 'archived': return 'Archived solicitation';
    default: return 'Solicitation';
  }
}

/**
 * Explicit "Amendment 000N" in the leading description only.
 * Returns null when the label is absent — do not invent "original".
 */
export function extractAmendmentLabel(description: string | null | undefined): string | null {
  if (!description) return null;
  const head = description.slice(0, 800);
  const m = head.match(/\bAmendment\s+(0*\d{1,4})\b/i);
  if (!m) return null;
  return `Amendment ${m[1]}`;
}

function identifiersFor(query: string, notice: SolicitationVersionRow): string[] {
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
  add(notice.solicitation_number);
  add(notice.notice_id);
  const rfp = notice.description?.match(/\bN\d{5,}[A-Z0-9]*\b/i);
  if (rfp && isSolicitationIdentifier(rfp[0])) add(rfp[0]);
  return out;
}

function descriptionMentions(description: string | null | undefined, token: string): boolean {
  if (!description || !token) return false;
  return description.toUpperCase().includes(token.toUpperCase());
}

export function resolveFromCandidateRows(
  query: string,
  rows: SolicitationVersionRow[],
  matchedBy: SolicitationMatchBy,
  now: Date = new Date(),
): CanonicalSolicitation | null {
  const queried = normalizeSolicitationQuery(query);
  const withId = rows.filter((r) => r.notice_id);
  // UUID is a record pointer: keep THAT version. Sol# / description-id
  // are family pointers: pick posted_date DESC.
  const canonical = matchedBy === 'notice_id'
    ? withId.find((r) => normalizeNoticeUuid(r.notice_id) === normalizeNoticeUuid(queried))
      ?? withId[0]
      ?? null
    : selectCanonicalVersion(withId);
  if (!canonical) return null;
  const versions = [...withId]
    .sort((a, b) => {
      const posted = dateMs(b.posted_date) - dateMs(a.posted_date);
      if (posted !== 0) return posted;
      return String(b.notice_id).localeCompare(String(a.notice_id));
    })
    .map((r) => ({
      notice_id: r.notice_id,
      posted_date: r.posted_date,
      response_deadline: r.response_deadline,
      active: r.active,
    }));
  return {
    queried,
    notice: canonical,
    status: deriveSolicitationStatus(canonical, now),
    response_deadline: canonical.response_deadline,
    amendment: extractAmendmentLabel(canonical.description),
    matched_by: matchedBy,
    identifiers: identifiersFor(queried, canonical),
    version_count: versions.length,
    source: 'sam_opportunities',
    versions,
  };
}

async function fetchByNoticeId(sb: ResolveDb, uuid: string): Promise<SolicitationVersionRow[]> {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(SOLICITATION_RESOLVE_COLS)
    .eq('notice_id', uuid)
    .limit(1);
  if (error) throw error;
  return (data || []) as SolicitationVersionRow[];
}

async function fetchBySolicitationNumber(sb: ResolveDb, token: string): Promise<SolicitationVersionRow[]> {
  const trimmed = token.trim();
  const attempts = [trimmed, `${trimmed} `, ` ${trimmed}`];
  const seen = new Set<string>();
  const rows: SolicitationVersionRow[] = [];
  for (const candidate of attempts) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const { data, error } = await sb
      .from('sam_opportunities')
      .select(SOLICITATION_RESOLVE_COLS)
      .ilike('solicitation_number', candidate)
      .order('posted_date', { ascending: false, nullsFirst: false })
      .limit(FAMILY_CAP);
    if (error) throw error;
    for (const row of (data || []) as SolicitationVersionRow[]) {
      if (row.notice_id) rows.push(row);
    }
    if (rows.length) break;
  }
  return rows;
}

async function fetchFamily(sb: ResolveDb, solicitationNumber: string): Promise<SolicitationVersionRow[]> {
  return fetchBySolicitationNumber(sb, solicitationNumber);
}

/**
 * Description-only identifier match. Bounded. Does NOT read sow_text.
 * search_tsv (GIN) covers title+description; we still require the token in
 * description or title so a future tsv widening cannot silently match body-only.
 */
async function fetchByDescriptionIdentifier(sb: ResolveDb, token: string): Promise<SolicitationVersionRow[]> {
  const escaped = escapeIlike(token);
  // Prefer the GIN FTS index (title+description). Bounded ILIKE is the
  // fallback only if search_tsv is unavailable — never sow_text.
  const fts = await sb
    .from('sam_opportunities')
    .select(SOLICITATION_RESOLVE_COLS)
    .textSearch('search_tsv', token, { type: 'plain' })
    .order('posted_date', { ascending: false, nullsFirst: false })
    .limit(DESCRIPTION_HIT_CAP);
  let rows: SolicitationVersionRow[] = [];
  if (!fts.error) {
    rows = (fts.data || []) as SolicitationVersionRow[];
  } else {
    const { data, error } = await sb
      .from('sam_opportunities')
      .select(SOLICITATION_RESOLVE_COLS)
      .or(`description.ilike.%${escaped}%,title.ilike.%${escaped}%`)
      .order('posted_date', { ascending: false, nullsFirst: false })
      .limit(DESCRIPTION_HIT_CAP);
    if (error) throw error;
    rows = (data || []) as SolicitationVersionRow[];
  }
  return rows.filter((r) =>
    descriptionMentions(r.description, token) ||
    (r.title || '').toUpperCase().includes(token.toUpperCase()) ||
    (r.solicitation_number || '').toUpperCase().includes(token.toUpperCase()),
  );
}

async function expandFamily(sb: ResolveDb, seeds: SolicitationVersionRow[]): Promise<SolicitationVersionRow[]> {
  const byId = new Map<string, SolicitationVersionRow>();
  for (const row of seeds) {
    if (row.notice_id) byId.set(row.notice_id, row);
  }
  const solNums = [...new Set(seeds.map((r) => r.solicitation_number).filter((s): s is string => !!s))];
  for (const sol of solNums) {
    for (const row of await fetchFamily(sb, sol)) {
      if (row.notice_id) byId.set(row.notice_id, row);
    }
  }
  return [...byId.values()];
}

export async function resolveCanonicalSolicitation(
  rawQuery: string,
  opts?: { client?: ResolveDb; now?: Date },
): Promise<CanonicalSolicitation | null> {
  const queried = normalizeSolicitationQuery(rawQuery);
  if (!queried) return null;
  const sb = opts?.client ?? db();
  if (!sb) return null;
  const now = opts?.now ?? new Date();

  let matchedBy: SolicitationMatchBy = 'solicitation_number';
  let seeds: SolicitationVersionRow[] = [];

  if (isNoticeUuid(queried)) {
    seeds = await fetchByNoticeId(sb, normalizeNoticeUuid(queried));
    if (!seeds.length) return null;
    return resolveFromCandidateRows(queried, seeds, 'notice_id', now);
  }

  seeds = await fetchBySolicitationNumber(sb, queried);
  if (seeds.length) matchedBy = 'solicitation_number';

  if (!seeds.length && isSolicitationIdentifier(queried)) {
    seeds = await fetchByDescriptionIdentifier(sb, queried);
    if (seeds.length) matchedBy = 'description_identifier';
  }

  if (!seeds.length) return null;

  const family = matchedBy === 'solicitation_number'
    ? seeds
    : await expandFamily(sb, seeds);
  return resolveFromCandidateRows(queried, family, matchedBy, now);
}

export function toResolvedNoticeFields(canonical: CanonicalSolicitation): {
  notice_id: string;
  solicitation_number: string | null;
  title: string | null;
  agency: string | null;
  department: string | null;
  naics_code: string | null;
  psc_code: string | null;
  set_aside: string | null;
  notice_type: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  ui_link: string | null;
  active: boolean | null;
  archive_date: string | null;
  status: SolicitationStatus;
  amendment: string | null;
  matched_by: SolicitationMatchBy;
  version_count: number;
} {
  const n = canonical.notice;
  return {
    notice_id: n.notice_id,
    solicitation_number: n.solicitation_number,
    title: n.title,
    agency: n.sub_tier || n.department,
    department: n.department,
    naics_code: n.naics_code,
    psc_code: n.psc_code,
    set_aside: n.set_aside_description,
    notice_type: n.notice_type,
    posted_date: n.posted_date,
    response_deadline: n.response_deadline,
    ui_link: n.ui_link || `https://sam.gov/opp/${n.notice_id}/view`,
    active: n.active,
    archive_date: n.archive_date,
    status: canonical.status,
    amendment: canonical.amendment,
    matched_by: canonical.matched_by,
    version_count: canonical.version_count,
  };
}
