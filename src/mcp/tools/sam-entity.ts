/**
 * MCP tool: lookup_sam_entity — the live SAM.gov registration for a contractor.
 *
 * Pass a UEI for an exact entity, or a company name to search. Returns the SAM entity
 * record: UEI/CAGE, legal name, registration status, NAICS, certifications (8(a),
 * HUBZone, etc.), location. This is the "is this vendor real, registered, and
 * set-aside eligible?" check.
 *
 * Reuses src/lib/sam/entity-api.ts (SAM Entity Management API — the same wrapper the
 * app uses). Public SAM data (commodity, metered). credits: 1. `_meta` always ships;
 * `_ai_hint` OFF by default.
 */
import { getEntityByUEI, searchEntities, type SAMEntity } from '@/lib/sam/entity-api';
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
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; match_count: number; mode: 'uei' | 'name' | 'empty' };
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
    console.error('[mcp:lookup_sam_entity] lookup failed:', err);
  }

  const matchCount = entity ? 1 : matches.length;
  const grounded = matchCount > 0;
  const result: SamEntityResult = {
    queried: { ...(uei ? { uei } : {}), ...(name ? { name } : {}), ...(state ? { state } : {}) },
    entity,
    matches,
    _meta: { grounded, degraded, match_count: matchCount, mode },
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
      key_caveats: ['Set-aside eligibility depends on the CURRENT registration status + certifications shown — not on past awards.'],
    };
  }

  return result;
}
