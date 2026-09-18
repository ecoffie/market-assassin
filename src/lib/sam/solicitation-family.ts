/**
 * Solicitation Family v1 — confirmed identity, aliases, current truth.
 *
 * Reuses the known-ID resolver (resolve-solicitation.ts). Does not duplicate
 * trim / notice_id / solicitation_number / description lookup / posted_date
 * winner / status derivation.
 *
 * NO-GO: forecast/award/recompete auto-merge, PAE, lifecycle super-entity,
 * fuzzy title merges, FIND Open active=true removal.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  deriveSolicitationStatus,
  extractAmendmentLabel,
  isNoticeUuid,
  isSolicitationIdentifier,
  resolveCanonicalSolicitation,
  selectCanonicalVersion,
  type SolicitationStatus,
  type SolicitationVersionRow,
} from '@/lib/sam/resolve-solicitation';

export const FAMILY_EVIDENCE = {
  CONFIRMED_IDENTITY: 'CONFIRMED_IDENTITY',
  SUPPORTED_LINK: 'SUPPORTED_LINK',
  CANDIDATE_LINK: 'CANDIDATE_LINK',
  NOT_LINKED: 'NOT_LINKED',
  NOT_ESTABLISHED: 'NOT_ESTABLISHED',
} as const;

export type FamilyEvidenceGrade = (typeof FAMILY_EVIDENCE)[keyof typeof FAMILY_EVIDENCE];

export type IdentifierType =
  | 'solicitation_number'
  | 'notice_id'
  | 'customer_rfp'
  | 'document_filename';

export type IdentifierSource = 'sam_column' | 'description' | 'attachment';

export interface FamilyIdentifier {
  identifier_type: IdentifierType;
  identifier_value: string;
  identifier_norm: string;
  source: IdentifierSource;
  evidence_grade: 'CONFIRMED_IDENTITY';
}

export interface VersionDocumentSet {
  notice_id: string;
  amendment: string | null;
  posted_date: string | null;
  attachments: unknown[];
}

export interface FamilyVersion {
  notice_id: string;
  posted_date: string | null;
  response_deadline: string | null;
  amendment: string | null;
  active: boolean | null;
  title: string | null;
}

export interface SolicitationFamilyView {
  family_id: string | null;
  identity_key: string;
  canonical_solicitation_number: string | null;
  current_notice_id: string;
  current_status: SolicitationStatus;
  current_deadline: string | null;
  current_amendment: string | null;
  current_set_aside: string | null;
  canonical_title: string | null;
  primary_dodaac: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  current_contact: unknown;
  identifiers: FamilyIdentifier[];
  versions: FamilyVersion[];
  documents: {
    current: VersionDocumentSet;
    historical: VersionDocumentSet[];
  };
  rejected_unrelated_notice_ids: string[];
  ambiguous: boolean;
}

export interface PursuitFamilyAttachment {
  family_id: string | null;
  identity_key: string;
  worked_from_notice_id: string;
  current_notice_id: string;
  newer_sibling: boolean;
  heal: {
    preserved_worked_from: true;
    claimed_user_saw_current: false;
  };
}

export interface FamilyNewVersionChange {
  change_type: 'new_version';
  summary: string;
  old_value: string | null;
  new_value: string;
}

export interface IdentityConflict {
  kind: 'IDENTITY_CONFLICT';
  identifier_norm: string;
  identifier_type: IdentifierType;
  existing_family_id: string;
  attempted_family_id: string;
}

export interface FamilyPersistResult {
  view: SolicitationFamilyView;
  identity_conflicts: IdentityConflict[];
}

type FamilyDb = Pick<SupabaseClient, 'from'>;

function pgCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export interface FamilyNoticeRow extends SolicitationVersionRow {
  attachments?: unknown;
  points_of_contact?: unknown;
  office_address?: { city?: string | null } | null;
}

const RFP_PHRASE =
  /(?:Request\s+for\s+Proposal\s*\(\s*RFP\s*\)|RFP)\s+([A-Za-z0-9][A-Za-z0-9._/-]{7,39})/gi;

function db(): FamilyDb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function normalizeIdentifier(raw: string | null | undefined): string {
  return String(raw || '').trim().toUpperCase();
}

export function familyIdentityKey(canonicalSolicitationNumber: string | null, currentNoticeId: string): string {
  const raw = String(canonicalSolicitationNumber || '').trim();
  if (raw && isSolicitationIdentifier(raw)) return `sol:${normalizeIdentifier(raw)}`;
  return `nid:${currentNoticeId}`;
}

/** DoDAAC from an authoritative SAM solicitation token (first 6), not from title. */
export function extractPrimaryDodaac(solicitationNumber: string | null | undefined): string | null {
  const t = String(solicitationNumber || '').trim().toUpperCase();
  if (/^[A-Z][A-Z0-9]{5}/.test(t)) return t.slice(0, 6);
  return null;
}

function isOfficePrefixOf(token: string, solicitationNumber: string | null): boolean {
  const norm = normalizeIdentifier(token);
  const sol = normalizeIdentifier(solicitationNumber);
  return Boolean(sol && norm.length === 6 && sol.startsWith(norm));
}

function addIdentifier(out: FamilyIdentifier[], row: Omit<FamilyIdentifier, 'identifier_norm'>): void {
  const identifier_norm = normalizeIdentifier(row.identifier_value);
  if (!identifier_norm) return;
  if (out.some((x) => x.identifier_norm === identifier_norm && x.identifier_type === row.identifier_type)) {
    return;
  }
  out.push({ ...row, identifier_norm });
}

function tokensFromText(text: string): string[] {
  const found: string[] = [];
  const re = /[A-Za-z][A-Za-z0-9._/-]{7,39}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (isSolicitationIdentifier(m[0])) found.push(m[0]);
  }
  return found;
}

function attachmentNames(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((item) => {
    if (!item || typeof item !== 'object') return '';
    const rec = item as Record<string, unknown>;
    return String(rec.filename || rec.name || rec.title || '');
  }).filter(Boolean);
}

function firstContact(pointsOfContact: unknown): unknown {
  if (!Array.isArray(pointsOfContact) || pointsOfContact.length === 0) return null;
  return pointsOfContact[0];
}

/**
 * CONFIRMED aliases only. Title / DoDAAC / NAICS / PSC never create identity.
 */
export function extractConfirmedAliases(rows: FamilyNoticeRow[]): FamilyIdentifier[] {
  const out: FamilyIdentifier[] = [];
  for (const row of rows) {
    if (row.notice_id) {
      addIdentifier(out, {
        identifier_type: 'notice_id',
        identifier_value: row.notice_id,
        source: 'sam_column',
        evidence_grade: 'CONFIRMED_IDENTITY',
      });
    }
    const sol = row.solicitation_number?.trim() ?? null;
    if (sol && isSolicitationIdentifier(sol)) {
      addIdentifier(out, {
        identifier_type: 'solicitation_number',
        identifier_value: sol,
        source: 'sam_column',
        evidence_grade: 'CONFIRMED_IDENTITY',
      });
    }

    const description = row.description || '';
    RFP_PHRASE.lastIndex = 0;
    let phrase: RegExpExecArray | null;
    while ((phrase = RFP_PHRASE.exec(description))) {
      const token = phrase[1];
      if (!token || !isSolicitationIdentifier(token)) continue;
      if (normalizeIdentifier(token) === normalizeIdentifier(sol)) continue;
      if (isOfficePrefixOf(token, sol)) continue;
      addIdentifier(out, {
        identifier_type: 'customer_rfp',
        identifier_value: token,
        source: 'description',
        evidence_grade: 'CONFIRMED_IDENTITY',
      });
    }

    for (const name of attachmentNames(row.attachments)) {
      for (const token of tokensFromText(name)) {
        if (normalizeIdentifier(token) === normalizeIdentifier(sol)) continue;
        if (isOfficePrefixOf(token, sol)) continue;
        addIdentifier(out, {
          identifier_type: 'document_filename',
          identifier_value: token,
          source: 'attachment',
          evidence_grade: 'CONFIRMED_IDENTITY',
        });
      }
    }
  }
  return out;
}

export function groupRowsBySolicitationNumber(rows: FamilyNoticeRow[]): Map<string, FamilyNoticeRow[]> {
  const groups = new Map<string, FamilyNoticeRow[]>();
  for (const row of rows) {
    const raw = row.solicitation_number?.trim() || '';
    const key = raw && isSolicitationIdentifier(raw)
      ? normalizeIdentifier(raw)
      : `nid:${row.notice_id}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

/**
 * CONFIRMED_IDENTITY merge only:
 *   A. same authoritative SAM solicitation_number
 *   B. official description/attachment names the other family's identifier
 * Title / DoDAAC / NAICS / PSC / incumbent / date / buyer never merge.
 */
export function shouldMergeFamilies(
  a: { canonical_solicitation_number: string | null; confirmed_identifier_norms: string[] },
  b: { canonical_solicitation_number: string | null; confirmed_identifier_norms: string[] },
): boolean {
  const aSol = normalizeIdentifier(a.canonical_solicitation_number);
  const bSol = normalizeIdentifier(b.canonical_solicitation_number);
  if (aSol && bSol && aSol === bSol && isSolicitationIdentifier(aSol)) return true;
  const aSet = new Set(a.confirmed_identifier_norms.map(normalizeIdentifier).filter(Boolean));
  const bSet = new Set(b.confirmed_identifier_norms.map(normalizeIdentifier).filter(Boolean));
  // Rule B: one family's authoritative SAM sol# is named as the other's confirmed alias.
  // Shared customer-RFP tokens alone do not merge (alias theft / HVAC dual-sol case).
  if (aSol && isSolicitationIdentifier(aSol) && bSet.has(aSol)) return true;
  if (bSol && isSolicitationIdentifier(bSol) && aSet.has(bSol)) return true;
  return false;
}

export function shouldMergeOnTitleDodaacNaics(): false {
  return false;
}

function confirmedNormsForGroup(rows: FamilyNoticeRow[]): string[] {
  return extractConfirmedAliases(rows).map((x) => x.identifier_norm);
}

function groupCanonicalSol(rows: FamilyNoticeRow[]): string | null {
  const sols = [...new Set(rows.map((r) => r.solicitation_number?.trim()).filter(Boolean))] as string[];
  return sols[0] || null;
}

/**
 * Partition candidate rows into one confirmed family + rejected unrelated notices.
 * Mixed SAM solicitation_numbers do not merge unless B (official identifier naming).
 */
export function partitionConfirmedFamily(
  rows: FamilyNoticeRow[],
  query?: string,
): { accepted: FamilyNoticeRow[]; rejected: FamilyNoticeRow[]; ambiguous: boolean } {
  const usable = rows.filter((r) => r.notice_id);
  const groups = [...groupRowsBySolicitationNumber(usable).values()];
  if (groups.length <= 1) {
    return { accepted: usable, rejected: [], ambiguous: false };
  }

  const meta = groups.map((g) => ({
    rows: g,
    canonical_solicitation_number: groupCanonicalSol(g),
    confirmed_identifier_norms: confirmedNormsForGroup(g),
  }));

  const qNorm = normalizeIdentifier(query);
  let seedIdx = 0;
  if (qNorm) {
    const hit = meta.findIndex((m) =>
      m.confirmed_identifier_norms.includes(qNorm) ||
      normalizeIdentifier(m.canonical_solicitation_number) === qNorm ||
      m.rows.some((r) => r.notice_id === query || normalizeIdentifier(r.notice_id) === qNorm),
    );
    if (hit >= 0) seedIdx = hit;
  }

  const acceptedIdx = new Set<number>([seedIdx]);
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < meta.length; i++) {
      if (acceptedIdx.has(i)) continue;
      for (const j of acceptedIdx) {
        if (shouldMergeFamilies(meta[i], meta[j])) {
          acceptedIdx.add(i);
          grew = true;
          break;
        }
      }
    }
  }

  const accepted: FamilyNoticeRow[] = [];
  const rejected: FamilyNoticeRow[] = [];
  meta.forEach((m, i) => {
    if (acceptedIdx.has(i)) accepted.push(...m.rows);
    else rejected.push(...m.rows);
  });

  return { accepted, rejected, ambiguous: false };
}

export function splitDocumentSets(
  rows: FamilyNoticeRow[],
  currentNoticeId: string,
): { current: VersionDocumentSet; historical: VersionDocumentSet[] } {
  const sets: VersionDocumentSet[] = rows.map((r) => ({
    notice_id: r.notice_id,
    amendment: extractAmendmentLabel(r.description),
    posted_date: r.posted_date,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
  }));
  const current = sets.find((s) => s.notice_id === currentNoticeId) || {
    notice_id: currentNoticeId,
    amendment: null,
    posted_date: null,
    attachments: [],
  };
  const historical = sets.filter((s) => s.notice_id !== currentNoticeId);
  return { current, historical };
}

export function buildFamilyView(
  rows: FamilyNoticeRow[],
  opts?: { query?: string; now?: Date; family_id?: string | null },
): SolicitationFamilyView | null {
  const now = opts?.now ?? new Date();
  const { accepted, rejected, ambiguous } = partitionConfirmedFamily(rows, opts?.query);
  const current = selectCanonicalVersion(accepted);
  if (!current) return null;

  const identifiers = extractConfirmedAliases(accepted);
  const canonicalSol = current.solicitation_number?.trim() || groupCanonicalSol(accepted);
  const identity_key = familyIdentityKey(canonicalSol, current.notice_id);
  const versions: FamilyVersion[] = [...accepted]
    .sort((a, b) => String(b.posted_date || '').localeCompare(String(a.posted_date || '')))
    .map((r) => ({
      notice_id: r.notice_id,
      posted_date: r.posted_date,
      response_deadline: r.response_deadline,
      amendment: extractAmendmentLabel(r.description),
      active: r.active,
      title: r.title,
    }));

  return {
    family_id: opts?.family_id ?? null,
    identity_key,
    canonical_solicitation_number: canonicalSol,
    current_notice_id: current.notice_id,
    current_status: deriveSolicitationStatus(current, now),
    current_deadline: current.response_deadline,
    current_amendment: extractAmendmentLabel(current.description),
    current_set_aside: current.set_aside_description,
    canonical_title: current.title,
    primary_dodaac: extractPrimaryDodaac(canonicalSol),
    department: current.department,
    sub_tier: current.sub_tier,
    office: current.office,
    current_contact: firstContact(current.points_of_contact),
    identifiers,
    versions,
    documents: splitDocumentSets(accepted, current.notice_id),
    rejected_unrelated_notice_ids: rejected.map((r) => r.notice_id),
    ambiguous,
  };
}

export function attachPursuitToFamily(
  workedFromNoticeId: string,
  family: SolicitationFamilyView,
): PursuitFamilyAttachment {
  return {
    family_id: family.family_id,
    identity_key: family.identity_key,
    worked_from_notice_id: workedFromNoticeId,
    current_notice_id: family.current_notice_id,
    newer_sibling: workedFromNoticeId !== family.current_notice_id,
    heal: {
      preserved_worked_from: true,
      claimed_user_saw_current: false,
    },
  };
}

/**
 * Family-aware monitor. A new confirmed sibling is NEW_VERSION.
 * Unrelated same-office notices are not amendments.
 * First snapshot (no previous current) does not alert.
 */
export function detectFamilyNewVersion(args: {
  previousCurrentNoticeId: string | null | undefined;
  familyCurrentNoticeId: string;
  familyNoticeIds: string[];
  currentAmendment?: string | null;
}): FamilyNewVersionChange | null {
  const prev = args.previousCurrentNoticeId || null;
  const next = args.familyCurrentNoticeId;
  if (!next) return null;
  if (!prev) return null;
  if (prev === next) return null;
  if (!args.familyNoticeIds.includes(next)) return null;
  const label = args.currentAmendment || next;
  return {
    change_type: 'new_version',
    summary: `Newer stored version detected (${label}). Worked-from notice was not rewritten.`,
    old_value: prev,
    new_value: next,
  };
}

export function gradeForecastRelationship(input: {
  familyTitle?: string | null;
  forecastTitle?: string | null;
  familyDodaac?: string | null;
  forecastOffice?: string | null;
  familyNaics?: string | null;
  forecastNaics?: string | null;
  authoritativeIdentityEvidence?: boolean;
}): FamilyEvidenceGrade {
  if (input.authoritativeIdentityEvidence) return FAMILY_EVIDENCE.CONFIRMED_IDENTITY;
  const titleHit = Boolean(
    input.familyTitle &&
    input.forecastTitle &&
    input.familyTitle.trim().toLowerCase() === input.forecastTitle.trim().toLowerCase(),
  );
  const officeHit = Boolean(
    input.familyDodaac &&
    input.forecastOffice &&
    normalizeIdentifier(input.familyDodaac) === normalizeIdentifier(input.forecastOffice),
  );
  const naicsHit = Boolean(
    input.familyNaics &&
    input.forecastNaics &&
    String(input.familyNaics).slice(0, 6) === String(input.forecastNaics).slice(0, 6),
  );
  if (titleHit || officeHit || naicsHit) return FAMILY_EVIDENCE.SUPPORTED_LINK;
  if (input.forecastTitle || input.forecastOffice) return FAMILY_EVIDENCE.CANDIDATE_LINK;
  return FAMILY_EVIDENCE.NOT_LINKED;
}

export function gradeAwardRelationship(input: {
  awardId?: string | null;
  piid?: string | null;
}): FamilyEvidenceGrade {
  if (!input.awardId && !input.piid) return FAMILY_EVIDENCE.NOT_ESTABLISHED;
  return FAMILY_EVIDENCE.CANDIDATE_LINK;
}

export function paeRelationshipForFamily(): {
  implemented: false;
  invented: false;
  linked: false;
} {
  return { implemented: false, invented: false, linked: false };
}

const FAMILY_MEMBER_COLS =
  'notice_id,solicitation_number,title,department,sub_tier,office,naics_code,psc_code,set_aside_description,notice_type,posted_date,response_deadline,archive_date,active,description,ui_link,attachments,points_of_contact,office_address';

/**
 * Known-ID family current truth.
 *
 * Identity comes from the merged #1557 resolver (UUID stays a record pointer;
 * sol# / RFP token pick latest). Version *membership* is family-owned: after
 * the resolver names a notice, load siblings by that stored solicitation_number
 * so a historical UUID still returns the Amd-N current pointer.
 */
export async function resolveFamilyForQuery(
  rawQuery: string,
  opts?: { client?: FamilyDb; now?: Date },
): Promise<SolicitationFamilyView | null> {
  const canonical = await resolveCanonicalSolicitation(rawQuery, {
    client: opts?.client,
    now: opts?.now,
  });
  if (!canonical) return null;
  const sb = opts?.client ?? db();
  const sol = canonical.notice.solicitation_number?.trim();

  if (sb && sol && isSolicitationIdentifier(sol)) {
    const { data, error } = await sb
      .from('sam_opportunities')
      .select(FAMILY_MEMBER_COLS)
      .ilike('solicitation_number', sol)
      .order('posted_date', { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) throw error;
    const view = buildFamilyView((data || []) as FamilyNoticeRow[], {
      query: rawQuery,
      now: opts?.now,
    });
    if (view) return view;
  }

  if (!sb) {
    return buildFamilyView(canonical.versions.map((v) => ({
      notice_id: v.notice_id,
      solicitation_number: canonical.notice.solicitation_number,
      title: canonical.notice.title,
      department: canonical.notice.department,
      sub_tier: canonical.notice.sub_tier,
      office: canonical.notice.office,
      naics_code: canonical.notice.naics_code,
      psc_code: canonical.notice.psc_code,
      set_aside_description: canonical.notice.set_aside_description,
      notice_type: canonical.notice.notice_type,
      posted_date: v.posted_date,
      response_deadline: v.response_deadline,
      archive_date: canonical.notice.archive_date,
      active: v.active,
      description: v.notice_id === canonical.notice.notice_id ? canonical.notice.description : null,
      ui_link: canonical.notice.ui_link,
    })), { query: rawQuery, now: opts?.now });
  }

  const ids = canonical.versions.map((v) => v.notice_id);
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(FAMILY_MEMBER_COLS)
    .in('notice_id', ids);
  if (error) throw error;
  return buildFamilyView((data || []) as FamilyNoticeRow[], {
    query: rawQuery,
    now: opts?.now,
  });
}

export async function ensureFamilyPersisted(
  view: SolicitationFamilyView,
  opts?: { client?: FamilyDb },
): Promise<FamilyPersistResult> {
  const sb = opts?.client ?? db();
  if (!sb) return { view, identity_conflicts: [] };

  const row = {
    identity_key: view.identity_key,
    canonical_solicitation_number: view.canonical_solicitation_number,
    current_notice_id: view.current_notice_id,
    current_status: view.current_status,
    current_deadline: view.current_deadline,
    current_amendment: view.current_amendment,
    current_set_aside: view.current_set_aside,
    canonical_title: view.canonical_title,
    primary_dodaac: view.primary_dodaac,
    department: view.department,
    sub_tier: view.sub_tier,
    office: view.office,
    current_contact: view.current_contact,
    updated_at: new Date().toISOString(),
  };

  const { data: upserted, error: upsertErr } = await sb
    .from('solicitation_family')
    .upsert(row, { onConflict: 'identity_key' })
    .select('family_id')
    .single();

  let familyId: string | null = upserted?.family_id ?? null;
  if (upsertErr) {
    if (pgCode(upsertErr) !== '23505') throw upsertErr;
    const { data: existing, error: readErr } = await sb
      .from('solicitation_family')
      .select('family_id')
      .eq('identity_key', view.identity_key)
      .maybeSingle();
    if (readErr) throw readErr;
    familyId = existing?.family_id ?? null;
  }
  if (!familyId) {
    throw new Error('solicitation_family upsert returned no family_id');
  }

  const versionRows = view.versions.map((v) => ({
    family_id: familyId,
    notice_id: v.notice_id,
    posted_date: v.posted_date,
    response_deadline: v.response_deadline,
    amendment: v.amendment,
    active: v.active,
    title: v.title,
  }));
  if (versionRows.length) {
    const { error } = await sb.from('solicitation_family_versions').upsert(versionRows, {
      onConflict: 'family_id,notice_id',
    });
    if (error) throw error;
  }

  const identity_conflicts = await persistIdentifiersWithoutTheft(sb, familyId, view.identifiers);
  return { view: { ...view, family_id: familyId }, identity_conflicts };
}

/**
 * CASE A: identifier absent → insert.
 * CASE B: same family → idempotent success.
 * CASE C: different family → IDENTITY_CONFLICT; do not update family_id.
 */
async function persistIdentifiersWithoutTheft(
  sb: FamilyDb,
  familyId: string,
  identifiers: FamilyIdentifier[],
): Promise<IdentityConflict[]> {
  if (!identifiers.length) return [];

  const idRows = identifiers.map((id) => ({
    family_id: familyId,
    identifier_type: id.identifier_type,
    identifier_value: id.identifier_value,
    identifier_norm: id.identifier_norm,
    source: id.source,
    evidence_grade: id.evidence_grade,
  }));

  const { error: insErr } = await sb.from('solicitation_identifiers').upsert(idRows, {
    onConflict: 'identifier_norm,identifier_type',
    ignoreDuplicates: true,
  });
  if (insErr) throw insErr;

  const norms = [...new Set(identifiers.map((id) => id.identifier_norm))];
  const { data: owned, error: readErr } = await sb
    .from('solicitation_identifiers')
    .select('identifier_norm,identifier_type,family_id')
    .in('identifier_norm', norms);
  if (readErr) throw readErr;
  if (owned == null) {
    throw new Error('solicitation_identifiers ownership read returned no data');
  }

  const wanted = new Set(identifiers.map((id) => `${id.identifier_norm}|${id.identifier_type}`));
  const conflicts: IdentityConflict[] = [];
  for (const row of owned as Array<{
    identifier_norm: string;
    identifier_type: IdentifierType;
    family_id: string;
  }>) {
    if (!wanted.has(`${row.identifier_norm}|${row.identifier_type}`)) continue;
    if (row.family_id === familyId) continue;
    conflicts.push({
      kind: 'IDENTITY_CONFLICT',
      identifier_norm: row.identifier_norm,
      identifier_type: row.identifier_type,
      existing_family_id: row.family_id,
      attempted_family_id: familyId,
    });
  }
  return conflicts;
}

export function isKnownIdQuery(raw: string): boolean {
  const t = String(raw || '').trim();
  return isNoticeUuid(t) || isSolicitationIdentifier(t);
}

export function indexFamiliesByNoticeId(
  rows: FamilyNoticeRow[],
  now: Date = new Date(),
): Map<string, SolicitationFamilyView> {
  const out = new Map<string, SolicitationFamilyView>();
  for (const group of groupRowsBySolicitationNumber(rows).values()) {
    const view = buildFamilyView(group, { now });
    if (!view) continue;
    for (const version of view.versions) {
      out.set(version.notice_id, view);
    }
  }
  return out;
}

export async function familyAttachmentForNotice(
  noticeId: string,
  opts?: { persist?: boolean; client?: FamilyDb; now?: Date },
): Promise<{ view: SolicitationFamilyView; attachment: PursuitFamilyAttachment } | null> {
  const view = await resolveFamilyForQuery(noticeId, { client: opts?.client, now: opts?.now });
  if (!view) return null;
  let persisted = view;
  if (opts?.persist) {
    try {
      const result = await ensureFamilyPersisted(view, { client: opts?.client });
      persisted = result.view;
      if (result.identity_conflicts.length) {
        console.warn('[solicitation-family] IDENTITY_CONFLICT', result.identity_conflicts);
      }
    } catch (err) {
      const code = pgCode(err);
      if (code === '23505') {
        console.warn('[solicitation-family] persist unique violation after ON CONFLICT handling:', err instanceof Error ? err.message : err);
      } else {
        console.warn('[solicitation-family] persist skipped:', err instanceof Error ? err.message : err);
      }
    }
  }
  return { view: persisted, attachment: attachPursuitToFamily(noticeId, persisted) };
}
