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
import { lookupLocalEntitiesByName, lookupLocalEntityByUEI } from '@/lib/sam/entity-local-fallback';
import { classifyNameHits } from '@/lib/contractor/name-resolution';
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

/** Evidence for a name miss: legal + DBA live + local mirror were checked (Monarch #14). */
export interface SamEntityReconciliation {
  outcome: 'not_found';
  sources_checked: Array<{
    source: 'sam_live_legal' | 'sam_live_dba' | 'local_registry';
    hits: number;
    status: 'ok' | 'unavailable' | 'skipped';
  }>;
  note: string;
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
    /**
     * found = unique entity. ambiguous = several hits, none selected.
     * not_found = both live and local agreed there is no row.
     * lookup_failed = the lookup itself failed — NOT "unregistered".
     * empty = no query.
     */
    lookup_status: 'found' | 'ambiguous' | 'not_found' | 'lookup_failed' | 'empty';
    /**
     * Present on name-mode `not_found` only. Documents that legal-name, DBA, and the
     * local mirror were consulted — so a prior claim that "Monarch Yachts" is a DBA of
     * a registered firm is reconciled as: sources currently return no match (not a
     * missed DBA classifier).
     */
    reconciliation?: SamEntityReconciliation;
  };
}

function mergeEntities(groups: SAMEntity[][]): SAMEntity[] {
  const byUei = new Map<string, SAMEntity>();
  for (const list of groups) {
    for (const e of list) {
      const uei = String(e.ueiSAM || '').trim().toUpperCase();
      if (!uei) continue;
      const prev = byUei.get(uei);
      if (!prev) {
        byUei.set(uei, e);
        continue;
      }
      // Live legal-name hits often omit dbaName. Overlay it from a later DBA/local row
      // so "Monarch Yachts" can unique-pick the same UEI.
      if (!prev.dbaName && e.dbaName) {
        byUei.set(uei, { ...prev, dbaName: e.dbaName });
      }
    }
  }
  return [...byUei.values()];
}

function pickUniqueEntity(
  name: string,
  matches: SAMEntity[],
): { entity: SAMEntity | null; status: 'found' | 'ambiguous' | 'not_found' } {
  const classified = classifyNameHits(
    name,
    matches.map((m) => ({
      name: m.legalBusinessName || '',
      uei: m.ueiSAM,
      total_obligated: 0,
      award_count: 0,
      dba: m.dbaName,
    })),
    matches.length,
  );
  if (classified.status === 'unique') {
    return { entity: matches.find((m) => m.ueiSAM === classified.uei) || null, status: 'found' };
  }
  if (classified.status === 'ambiguous') return { entity: null, status: 'ambiguous' };
  return { entity: null, status: 'not_found' };
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
  let lookupStatus: SamEntityResult['_meta']['lookup_status'] = mode === 'empty' ? 'empty' : 'not_found';
  // Name-miss evidence (Monarch #14): count every source consulted before asserting absence.
  let liveLegalHits = 0;
  let liveDbaHits = 0;
  let liveDbaStatus: 'ok' | 'unavailable' | 'skipped' = mode === 'name' ? 'skipped' : 'skipped';
  let localHits = 0;
  let localStatus: 'ok' | 'unavailable' | 'skipped' = 'skipped';

  try {
    if (mode === 'uei') {
      entity = await getEntityByUEI(uei);
      if (entity) lookupStatus = 'found';
    } else if (mode === 'name') {
      const legal = await searchEntities({ legalBusinessName: name, stateCode: state || undefined, size: limit });
      liveLegalHits = (legal.entities || []).length;
      let dbaEntities: SAMEntity[] = [];
      try {
        const dba = await searchEntities({ dbaName: name, stateCode: state || undefined, size: limit });
        dbaEntities = dba.entities || [];
        liveDbaHits = dbaEntities.length;
        liveDbaStatus = 'ok';
      } catch (dbaErr) {
        liveDbaStatus = 'unavailable';
        console.warn('[mcp:lookup_sam_entity] DBA live search failed; legal-name results still used:', dbaErr);
      }
      matches = mergeEntities([legal.entities || [], dbaEntities]);
      const picked = pickUniqueEntity(name, matches);
      lookupStatus = picked.status;
      entity = picked.entity;
      const topUei = String(entity?.ueiSAM || '').trim();
      if (topUei) {
        const detail = await getEntityByUEI(topUei).catch(() => null);
        if (detail) {
          entity = detail;
          matches = matches.map((m) => (m.ueiSAM === topUei ? detail : m));
        }
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
        const looked = await lookupLocalEntityByUEI(uei);
        if (looked.status === 'found') { entity = looked.hit.entity; localAsOf = looked.hit.asOf; usedLocal = true; lookupStatus = 'found'; localHits = 1; localStatus = 'ok'; }
        else if (looked.status === 'unavailable') { lookupStatus = 'lookup_failed'; localStatus = 'unavailable'; }
        else { localStatus = 'ok'; localHits = 0; }
      } else if (mode === 'name') {
        const looked = await lookupLocalEntitiesByName(name, limit);
        if (looked.status === 'found') {
          matches = looked.hits.map((h) => h.entity);
          localHits = looked.hits.length;
          localStatus = 'ok';
          const picked = pickUniqueEntity(name, matches);
          lookupStatus = picked.status;
          entity = picked.entity;
          localAsOf = looked.hits[0]?.asOf ?? null;
          usedLocal = true;
        } else if (looked.status === 'unavailable') {
          lookupStatus = 'lookup_failed';
          localStatus = 'unavailable';
        } else {
          localStatus = 'ok';
          localHits = 0;
        }
      }
    } catch (fallbackErr) {
      lookupStatus = 'lookup_failed';
      localStatus = 'unavailable';
      console.error('[mcp:lookup_sam_entity] local fallback also failed:', fallbackErr);
    }
  }

  // ── CHAIN-1 (2026-08-25) + DBA uniqueness (2026-09-20) ────────────────────────────────
  // Empty live success is not absence. Ambiguous live legal-name hits are also not
  // absence of a DBA: "Monarch Yachts" can return several Monarch* legal names while
  // the DBA sits on one local/live row. Reconcile the mirror whenever the lookup
  // did not uniquely pick — never only when matches.length === 0.
  if (!degraded && lookupStatus !== 'found' && !usedLocal && mode !== 'empty') {
    try {
      if (mode === 'uei') {
        const looked = await lookupLocalEntityByUEI(uei);
        if (looked.status === 'found') { entity = looked.hit.entity; localAsOf = looked.hit.asOf; usedLocal = true; lookupStatus = 'found'; localHits = 1; localStatus = 'ok'; }
        else if (looked.status === 'unavailable') { degraded = true; lookupStatus = 'lookup_failed'; localStatus = 'unavailable'; }
        else { localStatus = 'ok'; localHits = 0; }
      } else {
        const looked = await lookupLocalEntitiesByName(name, limit);
        if (looked.status === 'found') {
          localHits = looked.hits.length;
          localStatus = 'ok';
          const liveUeis = new Set(matches.map((m) => String(m.ueiSAM || '').toUpperCase()).filter(Boolean));
          matches = mergeEntities([matches, looked.hits.map((h) => h.entity)]);
          const picked = pickUniqueEntity(name, matches);
          lookupStatus = picked.status;
          entity = picked.entity;
          const pickedUei = String(entity?.ueiSAM || '').toUpperCase();
          if (picked.status === 'found' && pickedUei && !liveUeis.has(pickedUei)) {
            usedLocal = true;
            localAsOf = looked.hits[0]?.asOf ?? null;
          } else if (matches.length > 0 && liveUeis.size === 0) {
            usedLocal = true;
            localAsOf = looked.hits[0]?.asOf ?? null;
          }
        } else if (looked.status === 'unavailable') {
          degraded = true;
          lookupStatus = 'lookup_failed';
          localStatus = 'unavailable';
        } else {
          localStatus = 'ok';
          localHits = 0;
        }
      }
      if (usedLocal) {
        console.warn(`[mcp:lookup_sam_entity] live SAM missed a unique pick for ${mode}="${mode === 'uei' ? uei : name}" — reconciled against the local registry, not reported as absent.`);
      }
    } catch (reconcileErr) {
      degraded = true;
      lookupStatus = 'lookup_failed';
      localStatus = 'unavailable';
      console.error('[mcp:lookup_sam_entity] local reconciliation failed:', reconcileErr);
    }
  }

  // Name search sets `entity` to the top match's full registration AND keeps every
  // hit in `matches`. Counting the detail record made _meta.match_count 1 while
  // matches held 18 (Tanaq family, 2026-09-16). UEI mode is one record or none.
  const matchCount = mode === 'name' ? matches.length : (entity ? 1 : 0);
  const grounded = matchCount > 0;
  if (mode !== 'empty' && lookupStatus === 'not_found' && grounded && matches.length === 1 && entity) {
    lookupStatus = 'found';
  }
  if (degraded && !grounded) lookupStatus = 'lookup_failed';

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

  const reconciliation: SamEntityReconciliation | undefined =
    mode === 'name' && lookupStatus === 'not_found'
      ? {
          outcome: 'not_found',
          sources_checked: [
            { source: 'sam_live_legal', hits: liveLegalHits, status: 'ok' },
            { source: 'sam_live_dba', hits: liveDbaHits, status: liveDbaStatus === 'skipped' ? 'unavailable' : liveDbaStatus },
            { source: 'local_registry', hits: localHits, status: localStatus === 'skipped' ? 'unavailable' : localStatus },
          ],
          note:
            'Live SAM legal-name search, live SAM DBA search, and the local sam_entities mirror all returned no unique match. '
            + 'This is not a missed DBA classifier — when a DBA row exists, lookup_sam_entity unique-picks it. '
            + 'A prior claim that this trade name maps to a registered entity is not supported by current sources.',
        }
      : undefined;

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
      lookup_status: lookupStatus,
      ...(usedLocal ? { as_of: localAsOf, source_note: 'Live SAM was unavailable; served from Mindy\'s local SAM mirror. Registration details are as of the date shown, not re-verified just now.' } : {}),
      ...(reconciliation ? { reconciliation } : {}),
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? 'SAM.gov could not be reached (temporary error) — retry; do NOT state the entity is unregistered.'
        : mode === 'empty'
        ? 'No UEI or name supplied — nothing to look up.'
        : lookupStatus === 'lookup_failed'
        ? `SAM registration lookup failed for ${uei || name}. That is not evidence the business is unregistered.`
        : lookupStatus === 'ambiguous'
        ? `${matches.length} SAM matches for "${name}" — none selected. Name the legal entity or pass a UEI.`
        : grounded
        ? mode === 'uei'
          ? `${entity!.legalBusinessName || uei} — registration ${entity!.registrationStatus || 'unknown'}.`
          : `${matches.length} SAM match${matches.length === 1 ? '' : 'es'} for "${name}".`
        : `No SAM registration found for ${uei || name} after legal-name, DBA, and local-mirror checks. Do not invent a UEI; say current sources returned no match.`,
      how_to_use: grounded
        ? 'Cite registration status + certifications straight from the record. An Inactive/Expired registration means they cannot currently receive an award.'
        : 'No grounded entity; say the vendor is not found in current SAM/mirror sources rather than assuming they are unregistered forever.',
      key_caveats: [
        'Set-aside eligibility depends on the CURRENT registration status + certifications shown — not on past awards.',
        'SDVOSB and WOSB here are SAM SELF-IDENTIFIED, not the authoritative SBA VetCert determination — a firm may be VetCert-certified while SAM shows self-cert false, or vice-versa. 8(a) and HUBZone come from SBA-certified SAM codes and are authoritative. See cert_provenance.',
        ...(reconciliation
          ? ['See _meta.reconciliation for the legal / DBA / local hit counts that established this miss.']
          : []),
      ],
    };
  }

  return result;
}
