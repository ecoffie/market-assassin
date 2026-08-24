/**
 * MCP tool: lookup_sam_entity — the live SAM.gov registration for a contractor.
 *
 * Pass a UEI for an exact entity, or a company name to search. Returns the SAM entity
 * record: UEI/CAGE, legal name, registration status, NAICS, certifications (8(a),
 * HUBZone, etc.), location. This is the "is this vendor real, registered, and
 * set-aside eligible?" check.
 *
 * Reuses src/lib/sam/entity-api.ts (SAM Entity Management API — the same wrapper the
 * app uses). Public SAM data (commodity, metered). credits: 5. `_meta` always ships;
 * `_ai_hint` OFF by default.
 */
import { getEntityByUEI, searchEntities, type SAMEntity } from '@/lib/sam/entity-api';
import { localEntityByUEI, localEntitiesByName } from '@/lib/sam/entity-local-fallback';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SamEntityInput {
  /** 12-char SAM UEI for an exact lookup. */
  uei?: string;
  /** Company legal name to search (used when no UEI is given). */
  name?: string;
  /** Optional 2-letter state filter for name search. */
  state?: string;
  /** Max name-search matches (default 10, max 25). */
  limit?: number;
}

export interface SamEntityResult {
  queried: { uei?: string; name?: string; state?: string };
  /** Exact entity when a UEI was given. */
  entity: SAMEntity | null;
  /** Name-search matches when no UEI was given. */
  matches: SAMEntity[];
  /**
   * Per-cert PROVENANCE (Eric #3, 2026-07-28) — so a consumer never presents a SAM SELF-IDENTIFIED
   * cert as if it were the authoritative SBA determination. 8(a)/HUBZone come from SBA-certified SAM
   * codes (A6/XX); SDVOSB/WOSB come from SAM's self-identified field, so they are NOT the authoritative
   * SBA VetCert status. Only present on a UEI lookup with a found entity.
   */
  cert_provenance?: Array<{ cert: string; source: 'sba' | 'self'; source_label: string; authoritative: boolean }>;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    match_count: number;
    mode: 'uei' | 'name' | 'empty';
    /** Where the answer came from. 'local_registry' means live SAM was unavailable and this
     *  is a CACHED registration — the consumer must say "as of <as_of>", never imply a live check. */
    source?: 'sam_live' | 'local_registry';
    /** When the local row was last refreshed from SAM. Present only for source='local_registry'. */
    as_of?: string | null;
    source_note?: string;
  };
}

export async function lookupSamEntity(input: SamEntityInput): Promise<SamEntityResult> {
  const uei = String(input.uei ?? '').trim().toUpperCase();
  const name = String(input.name ?? '').trim();
  const state = String(input.state ?? '').trim().toUpperCase();
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25);
  const mode: 'uei' | 'name' | 'empty' = uei ? 'uei' : name ? 'name' : 'empty';

  let entity: SAMEntity | null = null;
  let matches: SAMEntity[] = [];
  let degraded = false;
  let usedLocal = false;
  let localAsOf: string | null = null;

  try {
    if (mode === 'uei') {
      entity = await getEntityByUEI(uei);
    } else if (mode === 'name') {
      const res = await searchEntities({ legalBusinessName: name, stateCode: state || undefined, size: limit });
      matches = res.entities || [];
      // The name-search endpoint returns LIGHT records without the points-of-
      // contact block, so a name query used to surface no registered POCs. Fetch
      // the TOP match's full registration so the company's registered POC NAMES
      // (government-business / electronic-business / past-performance) come back
      // for "who do I contact at [company]". One extra call, best match only.
      // NOTE: SAM redacts POC email/phone on the public API — NAMES only.
      const topUei = String(matches[0]?.ueiSAM || '').trim();
      if (topUei) {
        const detail = await getEntityByUEI(topUei).catch(() => null);
        if (detail) { entity = detail; matches[0] = detail; }
      }
    }
  } catch (err) {
    degraded = true;
    console.error('[mcp:lookup_sam_entity] live SAM failed:', err);

    // ── LOCAL REGISTRY FALLBACK (DEFECT-7) ────────────────────────────────────────────────
    // Live SAM is down/throttled/rejected. We hold ~910K SAM entities locally, so a basic
    // identity lookup must not become unusable because SAM is having a bad day. Measured on
    // the failing case: the live path returned nothing while EIGHT matching rows sat in
    // `sam_entities`. Live SAM should ENRICH the record, not be its single point of failure.
    //
    // ⚠️ `degraded` STAYS TRUE on this path. The data is a CACHED registration, not a live
    // one — the caller must be able to say "as of <date>" instead of implying a fresh check.
    try {
      if (mode === 'uei') {
        const hit = await localEntityByUEI(uei);
        if (hit) { entity = hit.entity; localAsOf = hit.asOf; usedLocal = true; }
      } else if (mode === 'name') {
        const hits = await localEntitiesByName(name, limit);
        if (hits.length) {
          matches = hits.map((h) => h.entity);
          entity = hits[0].entity;
          localAsOf = hits[0].asOf;
          usedLocal = true;
        }
      }
    } catch (fallbackErr) {
      console.error('[mcp:lookup_sam_entity] local fallback also failed:', fallbackErr);
    }
  }

  const matchCount = entity ? 1 : matches.length;
  const grounded = matchCount > 0;

  // Per-cert provenance (Eric #3) — spell out which certs are SBA-CERTIFIED vs SAM SELF-IDENTIFIED so a
  // consumer doesn't treat a self-cert as authoritative (the "hasSDVOSB:false" trust bug). Only for a
  // found entity's true flags.
  const certProvenance: NonNullable<SamEntityResult['cert_provenance']> = [];
  if (entity) {
    const add = (cert: string, on: boolean | undefined, source: 'sba' | 'self') => {
      if (on) certProvenance.push({
        cert, source,
        source_label: source === 'sba' ? 'SBA-certified' : 'SAM self-identified',
        authoritative: source === 'sba',
      });
    };
    add('8(a)', entity.has8a, 'sba');       // SAM code A6 = SBA Certified 8(a)
    add('HUBZone', entity.hasHUBZone, 'sba'); // SAM code XX = SBA Certified HUBZone
    add('SDVOSB', entity.hasSDVOSB, 'self'); // SAM self-identified — NOT authoritative VetCert
    add('WOSB', entity.hasWOSB, 'self');     // SAM self-identified
  }

  const result: SamEntityResult = {
    queried: { ...(uei ? { uei } : {}), ...(name ? { name } : {}), ...(state ? { state } : {}) },
    entity,
    matches,
    ...(certProvenance.length ? { cert_provenance: certProvenance } : {}),
    _meta: {
      grounded, degraded, match_count: matchCount, mode,
      // Where the answer came from. A consumer must not present a cached row as a live SAM
      // check — 'local' means "registered as of `as_of`", not "verified just now".
      source: usedLocal ? 'local_registry' : 'sam_live',
      ...(usedLocal ? { as_of: localAsOf, source_note: 'Live SAM was unavailable; served from Mindy\'s local SAM mirror. Registration details are as of the date shown, not re-verified just now.' } : {}),
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? 'SAM.gov could not be reached (temporary error) — retry; do NOT state the entity is unregistered.'
        : mode === 'empty'
        ? 'No UEI or name supplied — nothing to look up.'
        : grounded
        ? mode === 'uei'
          ? `${entity!.legalBusinessName || uei} — registration ${entity!.registrationStatus || 'unknown'}.`
          : `${matches.length} SAM match${matches.length === 1 ? '' : 'es'} for "${name}".`
        : `No SAM registration found for ${uei || name}. Do not claim certifications or eligibility.`,
      how_to_use: grounded
        ? 'Cite registration status + certifications straight from the record. An Inactive/Expired registration means they cannot currently receive an award.'
        : 'No grounded entity; say the vendor is not found in SAM rather than assuming.',
      key_caveats: [
        'Set-aside eligibility depends on the CURRENT registration status + certifications shown — not on past awards.',
        'SDVOSB and WOSB here are SAM SELF-IDENTIFIED, not the authoritative SBA VetCert determination — a firm may be VetCert-certified while SAM shows self-cert false, or vice-versa. 8(a) and HUBZone come from SBA-certified SAM codes and are authoritative. See cert_provenance.',
      ],
    };
  }

  return result;
}
