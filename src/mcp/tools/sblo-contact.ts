/**
 * MCP tool: get_sblo_contact — the Small Business Liaison Officer at a prime, so a
 * small business knows WHO to call to team on a subcontract. Curated SBLO names first
 * (the canonical 200-company Jun-2026 roster, then the broader 3,502-prime DB — the
 * hand-verified moat), then a LIVE BigQuery fallback that confirms an out-of-snapshot
 * company is a real federal prime + returns live award context. When no named SBLO is curated,
 * it returns the firm's REGISTERED SAM points of contact from Mindy's mirror / stored SAM responses
 * (lib/sam/registered-poc.ts, never a live SAM call), labelled as not a designated SB liaison.
 *
 * Wraps src/lib/gov-contacts/sblo-lookup.ts (lookupSbloContactEnriched). Honest: a match
 * with a blank name/email means no public SBLO was found (surface the supplier portal),
 * and the BigQuery tier has NO SBLO contact by design — it never invents one. tier:
 * metered, credits: 20 (curated hit is instant; a miss does one BQ point lookup). `_meta`
 * always ships; `_ai_hint` OFF by default.
 */
import { lookupSbloContactEnriched, type SbloContact, type SbloSource } from '@/lib/gov-contacts/sblo-lookup';
import { mcpFlags } from '@/lib/mcp/flags';
import { resolveRegisteredPocs, REGISTERED_POC_LABEL, type RegisteredPocs } from '@/lib/sam/registered-poc';

export interface SbloContactToolInput {
  /** Prime contractor / company name, e.g. "Booz Allen Hamilton", "AECOM", "Leidos". */
  company: string;
}

export interface SbloContactToolResult {
  contact: SbloContact | null;
  candidates: Array<{ company: string; matched_from: SbloSource }>;
  /**
   * R8 (2026-11-13): when no named SBLO is curated, the people the firm listed on its SAM
   * registration, read from Mindy's mirror / stored SAM responses (never a live SAM call).
   * Labelled: registered SAM point of contact, NOT a designated small business liaison.
   */
  registered_points_of_contact?: RegisteredPocs;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    match_type: 'exact' | 'contains' | 'none';
    matched_from: SbloSource | null;
    has_named_sblo: boolean;
    has_email: boolean;
    /** What the answer rests on: a curated SBLO, a registered SAM POC, award context only, or nothing. */
    contact_basis: 'curated_sblo' | 'registered_sam_poc' | 'award_context_only' | 'curated_no_name' | 'none';
    has_registered_poc: boolean;
    /** Outcome of the registered-POC fallback (absent when a named SBLO was curated). */
    registered_poc_status?: 'found' | 'no_pocs_held' | 'ambiguous' | 'not_found' | 'unavailable';
    /** BigQuery award-context lookup errored (kept separate so a found POC is not hidden as "unavailable"). */
    bq_degraded?: boolean;
    incomplete_reason?: string;
  };
}

function usd(n: number | null | undefined): string {
  if (!n || n <= 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

export async function getSbloContact(input: SbloContactToolInput): Promise<SbloContactToolResult> {
  const company = (input.company || '').trim();
  const res = await lookupSbloContactEnriched(company);
  const c = res.contact;

  const hasNamedSblo = !!c?.sblo_name;
  const hasEmail = !!c?.email;
  const fromBq = c?.matched_from === 'bigquery';

  // No named SBLO curated → the firm's registered SAM POCs, cache/mirror only. Resolve by the
  // user's name first (unique legal-stem pick in the mirror); an exact BigQuery match's UEI is
  // the second key. A contains-match UEI is NOT used: it may be a different firm.
  let registered: RegisteredPocs | undefined;
  let pocStatus: SbloContactToolResult['_meta']['registered_poc_status'];
  if (!hasNamedSblo && company) {
    try {
      let r = await resolveRegisteredPocs({ name: company });
      if (r.status !== 'found' && fromBq && res.matchType === 'exact' && c?.uei) {
        const byUei = await resolveRegisteredPocs({ uei: c.uei });
        if (byUei.status === 'found' || r.status === 'not_found') r = byUei;
      }
      pocStatus = r.status;
      if (r.status === 'found') registered = r.pocs;
    } catch (err) {
      console.error('[mcp:get_sblo_contact] registered POC fallback failed:', err);
      pocStatus = 'unavailable';
    }
  }
  const hasRegisteredPoc = !!registered;
  const grounded = c !== null || hasRegisteredPoc;
  const bqDegraded = res.bqDegraded ?? false;
  const contactBasis: SbloContactToolResult['_meta']['contact_basis'] = hasNamedSblo
    ? 'curated_sblo'
    : hasRegisteredPoc
      ? 'registered_sam_poc'
      : fromBq
        ? 'award_context_only'
        : c
          ? 'curated_no_name'
          : 'none';

  const result: SbloContactToolResult = {
    contact: c,
    candidates: res.candidates,
    ...(registered ? { registered_points_of_contact: registered } : {}),
    _meta: {
      grounded,
      // A found registered POC is a real answer; the BQ award-context outage stays visible in
      // bq_degraded + incomplete_reason instead of turning the whole result into "unavailable".
      degraded: bqDegraded && !hasRegisteredPoc,
      match_type: res.matchType,
      matched_from: c?.matched_from ?? null,
      has_named_sblo: hasNamedSblo,
      has_email: hasEmail,
      contact_basis: contactBasis,
      has_registered_poc: hasRegisteredPoc,
      ...(pocStatus ? { registered_poc_status: pocStatus } : {}),
      ...(bqDegraded ? { bq_degraded: true } : {}),
      ...(bqDegraded && hasRegisteredPoc
        ? { incomplete_reason: 'Award-context lookup (BigQuery) was unavailable; registered SAM POCs were still returned.' }
        : {}),
    },
  };

  if (mcpFlags.aiHint) {
    const bqContext = fromBq
      ? `${c!.company} is a real federal prime — ${usd(c!.total_contract_value)} across ${c!.distinct_agency_count ?? 0} agencies (${c!.contract_count ?? 0} awards, live from USASpending)`
      : '';
    result._ai_hint = {
      summary: hasRegisteredPoc && !hasNamedSblo
        ? `No curated SBLO for "${company}". ${registered!.company} lists these people on its SAM registration (${REGISTERED_POC_LABEL}): ${registered!.contacts.map((p) => `${p.name}${p.title ? `, ${p.title}` : ''}`).join('; ')}. As of ${registered!.as_of ?? 'unknown date'}.`
        : res.bqDegraded
        ? `No curated SBLO for "${company}", and the live award-context lookup was unavailable — treat as temporarily down, not as "no such prime". Retry shortly.`
        : !grounded
          ? `No SBLO for "${company}" in the curated roster (200 canonical) or the 3,502-prime DB, and no matching federal prime in USASpending. That is a coverage gap, not proof they have no SBLO.`
          : fromBq
            ? `${bqContext} — but NO public SBLO is on file. Start at their supplier-diversity / small-business page; do not guess a contact.`
            : hasNamedSblo
              ? `${c!.sblo_name}${c!.title ? `, ${c!.title}` : ''} at ${c!.company}${hasEmail ? ` (${c!.email})` : ' — no public email; use the supplier portal'}.`
              : `${c!.company} is in the curated set but no public SBLO name was found — start at the supplier portal${c!.supplier_portal ? ` (${c!.supplier_portal})` : ''}.`,
      how_to_use: grounded
        ? 'The SBLO is the teaming front door at a prime — reach out to be added to their small-business/subcontractor pipeline. When the name/email is blank (including every BigQuery-tier match), the supplier portal / SB page is the honest next step; do NOT guess an address.'
        : 'Not in the curated set and not a named USASpending prime; do NOT invent a name/email. Suggest the company\'s public supplier-diversity page, or search_contractors for their award footprint.',
      key_caveats: [
        fromBq
          ? 'Matched from BigQuery (award data) — this CONFIRMS the prime and its award footprint but carries NO SBLO contact; the curated roster is the only source of a named SBLO.'
          : c?.matched_from === 'prime_db'
            ? 'Matched from the broader prime DB (older provenance than the Jun-2026 roster) — verify the contact is current before a formal outreach.'
            : 'Matched from the canonical Jun-2026 roster; blank fields mean "no public SBLO found," never a fabricated contact.',
        res.matchType === 'contains'
          ? 'Name matched by partial/contains — confirm this is the same legal entity you meant (see candidates[]).'
          : 'Curated contact data is refreshed periodically; a person may have moved on.',
      ],
    };
  }
  return result;
}
