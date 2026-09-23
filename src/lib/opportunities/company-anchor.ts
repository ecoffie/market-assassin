/**
 * Company-anchored FIND — the COMPANY RECORD a FIND call is anchored on.
 *
 * WHY THIS EXISTS (IMI test, 2026-09-22). One lookup_sam_entity call returned Industrial
 * Mechanical Inc.'s size status BY NAICS and the equipment-repair PSCs it registered (J034,
 * J036) — exactly the codes on two Anniston RFIs that FIND missed, because FIND searched the
 * user's literal words and never looked at the company. Mindy already knew the company; FIND
 * did not use it.
 *
 * NOT A NEW PROFILE SYSTEM. The anchor is a thin, typed PROJECTION of the canonical
 * registration record that `lookup_sam_entity` already returns (`src/mcp/tools/sam-entity.ts`):
 *   sam_api_cache (CACHE-FIRST, via makeSAMRequest) → live SAM Entity API → local sam_entities
 *   mirror. Nothing here fetches on its own; the resolver calls lookupSamEntity.
 *
 * The seam other workstreams consume (multi-state / acquisition stage):
 *   - `CompanyAnchor`              — resolved codes, size-by-NAICS, certs, location, provenance
 *   - `resolveCompanyAnchor(uei)`  — UEI → CompanyAnchorResolution (never throws)
 *   - `anchorFromSamEntity()`      — pure; tests + fixtures build anchors without I/O
 *   - `companyRecallBasis()`       — which registered code recalled a row (label, never DIRECT)
 *   - `companyCodeRecall()`        — the {naics, psc} lists a discovery plan unions into recall
 *
 * TRUTH RULES
 *   - Size is PER NAICS. SAM's tri-state map ('Y' | 'N' | 'E', absent = SAM said nothing) is
 *     carried verbatim. Company-wide "small" is never inferred from any one NAICS.
 *   - A local-registry (mirror) record does not carry per-NAICS size or PSCs today, so those
 *     stay EMPTY + `size_source:'unavailable'` — unknown, never "not small" / "no PSCs".
 *   - Certifications keep provenance: 8(a)/HUBZone are SBA-certified (authoritative only when
 *     the record came from the Entity API); SDVOSB/WOSB/VOSB are SAM SELF-IDENTIFIED.
 */
import type { SAMEntity } from '@/lib/sam/entity-api';
import type { NaicsSbMap, SbStatus } from '@/lib/sam/naics-small-business';
import { lookupSamEntity, type SamEntityResult } from '@/mcp/tools/sam-entity';

export type AnchorSource = 'sam_entity_api' | 'local_registry';

export interface CompanyAnchor {
  uei: string;
  legal_name: string;
  dba_name: string | null;
  /** Where the registration came from. `local_registry` = a mirror row AS OF `as_of`. */
  source: AnchorSource;
  as_of: string | null;
  registration_status: string;
  registration_expiration: string | null;
  /** Registered NAICS (6-digit). */
  naics: string[];
  primary_naics: string | null;
  /** Registered PSCs. Empty on a mirror record = NOT KNOWN, not "none registered". */
  psc: string[];
  /**
   * SAM per-NAICS small-business representation, verbatim tri-state. A missing key means SAM
   * said nothing for that NAICS. SELF-REPRESENTED in SAM — not an SBA size determination.
   */
  size_by_naics: NaicsSbMap;
  size_source: 'sam_entity_api' | 'unavailable';
  certifications: {
    /** SBA-certified programs. `undefined` = not known from this record. */
    sba_8a: boolean | undefined;
    sba_hubzone: boolean | undefined;
    /** Normalized SAM self-identified labels (VOSB / SDVOSB / WOSB). */
    self_identified: string[];
    /** True only for an Entity API record, whose sbaBusinessTypeList is complete. */
    sba_list_authoritative: boolean;
  };
  location: { city: string | null; state: string | null; zip: string | null; country: string | null };
}

export type AnchorResolutionStatus = 'resolved' | 'not_found' | 'lookup_failed' | 'invalid_uei';

export interface CompanyAnchorResolution {
  status: AnchorResolutionStatus;
  uei: string;
  anchor: CompanyAnchor | null;
  /** Plain-English reason when status ≠ resolved. Never "not registered" for a failed lookup. */
  note: string | null;
}

const UEI_RE = /^[A-Z0-9]{12}$/;

export function normalizeUei(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

export function isValidUei(raw: unknown): boolean {
  return UEI_RE.test(normalizeUei(raw));
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean))];

/**
 * PURE projection of a SAMEntity (as lookup_sam_entity returns it) into the anchor. No I/O.
 */
export function anchorFromSamEntity(
  entity: SAMEntity,
  provenance: { source: AnchorSource; as_of?: string | null },
): CompanyAnchor {
  const fromApi = provenance.source === 'sam_entity_api';
  const sizeMap: NaicsSbMap = {};
  for (const [code, v] of Object.entries(entity.certifications?.naicsSmallBusiness || {})) {
    if (/^\d{6}$/.test(code) && (v === 'Y' || v === 'N' || v === 'E')) sizeMap[code] = v as SbStatus;
  }
  const naics = uniq((entity.naicsList || []).map((n) => n.naicsCode)).filter((c) => /^\d{6}$/.test(c));
  const psc = uniq((entity.pscList || []).map((p) => p.pscCode));
  const self = uniq(entity.businessTypes || []);
  const addr = entity.physicalAddress || {};
  return {
    uei: normalizeUei(entity.ueiSAM),
    legal_name: entity.legalBusinessName || '',
    dba_name: entity.dbaName || null,
    source: provenance.source,
    as_of: provenance.as_of ?? null,
    registration_status: entity.registrationStatus || 'Unknown',
    registration_expiration: entity.registrationExpirationDate || null,
    naics,
    primary_naics: entity.primaryNaics || (entity.naicsList || []).find((n) => n.isPrimary)?.naicsCode || null,
    psc,
    size_by_naics: sizeMap,
    size_source: Object.keys(sizeMap).length ? 'sam_entity_api' : 'unavailable',
    certifications: {
      sba_8a: typeof entity.has8a === 'boolean' ? entity.has8a : undefined,
      sba_hubzone: typeof entity.hasHUBZone === 'boolean' ? entity.hasHUBZone : undefined,
      self_identified: self,
      sba_list_authoritative: fromApi,
    },
    location: {
      city: addr.city || null,
      state: addr.stateOrProvince || null,
      zip: addr.zipCode || null,
      country: addr.countryCode || null,
    },
  };
}

export type EntityLookup = (input: { uei: string }) => Promise<SamEntityResult>;

/**
 * UEI → anchor through the canonical lookup_sam_entity path (cache-first). Never throws:
 * a failed lookup is `lookup_failed` (NOT "unregistered"), a clean miss is `not_found`.
 */
export async function resolveCompanyAnchor(
  rawUei: unknown,
  lookup: EntityLookup = (i) => lookupSamEntity(i),
): Promise<CompanyAnchorResolution> {
  const uei = normalizeUei(rawUei);
  if (!UEI_RE.test(uei)) {
    return { status: 'invalid_uei', uei, anchor: null, note: `"${uei}" is not a 12-character SAM UEI.` };
  }
  let res: SamEntityResult;
  try {
    res = await lookup({ uei });
  } catch (err) {
    return {
      status: 'lookup_failed',
      uei,
      anchor: null,
      note: `The SAM registration lookup failed (${(err as Error).message}). That is not evidence the company is unregistered.`,
    };
  }
  const status = res._meta.lookup_status;
  if (status === 'found' && res.entity) {
    const source: AnchorSource = res._meta.source === 'local_registry' ? 'local_registry' : 'sam_entity_api';
    return {
      status: 'resolved',
      uei,
      anchor: anchorFromSamEntity(res.entity, { source, as_of: res._meta.as_of ?? null }),
      note: source === 'local_registry'
        ? 'Registration served from Mindy\'s local SAM mirror (as of the date shown). Per-NAICS size and registered PSCs are not carried by the mirror, so size-based eligibility is UNKNOWN.'
        : null,
    };
  }
  if (status === 'not_found') {
    return { status: 'not_found', uei, anchor: null, note: `No SAM registration found for UEI ${uei} in live SAM or the local mirror.` };
  }
  return {
    status: 'lookup_failed',
    uei,
    anchor: null,
    note: `The SAM registration lookup for ${uei} did not complete (${status}). That is not evidence the company is unregistered.`,
  };
}

export type CompanyRecallBasis = 'company_registered_psc' | 'company_registered_naics';

function pscHit(list: string[], v: unknown): boolean {
  const c = String(v || '').trim().toUpperCase();
  return !!c && list.includes(c);
}

/**
 * Which of the company's REGISTERED codes a row carries. PSC first (it names what was bought).
 * This is a RECALL label — it never makes a row a DIRECT_MATCH for the user's words.
 */
export function companyRecallBasis(
  row: { naics_code?: unknown; psc_code?: unknown },
  anchor: CompanyAnchor | null | undefined,
): CompanyRecallBasis | null {
  if (!anchor) return null;
  if (pscHit(anchor.psc, row.psc_code)) return 'company_registered_psc';
  const n = String(row.naics_code || '').trim();
  if (n && anchor.naics.includes(n)) return 'company_registered_naics';
  return null;
}

/** The exact codes a discovery plan unions into candidate recall (exact-match; no prefixes). */
export function companyCodeRecall(anchor: CompanyAnchor | null | undefined): { naics: string[]; psc: string[] } | null {
  if (!anchor) return null;
  if (!anchor.naics.length && !anchor.psc.length) return null;
  return { naics: [...anchor.naics], psc: [...anchor.psc] };
}

/** Size representation for one NAICS: 'Y' | 'N' | 'E' | 'not_represented' (SAM said nothing). */
export function sizeUnderNaics(anchor: CompanyAnchor, naics: string | null | undefined): SbStatus | 'not_represented' | 'size_unavailable' {
  if (anchor.size_source === 'unavailable') return 'size_unavailable';
  const v = anchor.size_by_naics[String(naics || '').trim()];
  return v ?? 'not_represented';
}
