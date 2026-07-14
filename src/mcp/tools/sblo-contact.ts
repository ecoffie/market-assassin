/**
 * MCP tool: get_sblo_contact — the Small Business Liaison Officer at a prime, so a
 * small business knows WHO to call to team on a subcontract. Curated data (canonical
 * 200-company Jun-2026 SBLO roster first, then the broader 3,502-prime DB).
 *
 * Wraps the pure src/lib/gov-contacts/sblo-lookup.ts (static JSON, no LLM/IO). Honest:
 * a matched company with a blank name/email means no public SBLO was found (the tool
 * surfaces the supplier portal instead) — it never invents a contact. tier: metered,
 * credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { lookupSbloContact, type SbloContact } from '@/lib/gov-contacts/sblo-lookup';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SbloContactToolInput {
  /** Prime contractor / company name, e.g. "Booz Allen Hamilton", "AECOM", "Leidos". */
  company: string;
}

export interface SbloContactToolResult {
  contact: SbloContact | null;
  candidates: Array<{ company: string; matched_from: 'roster' | 'prime_db' }>;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    match_type: 'exact' | 'contains' | 'none';
    matched_from: 'roster' | 'prime_db' | null;
    has_named_sblo: boolean;
    has_email: boolean;
  };
}

export function getSbloContact(input: SbloContactToolInput): SbloContactToolResult {
  const company = (input.company || '').trim();
  const res = lookupSbloContact(company);
  const c = res.contact;

  const grounded = c !== null;
  const hasNamedSblo = !!c?.sblo_name;
  const hasEmail = !!c?.email;

  const result: SbloContactToolResult = {
    contact: c,
    candidates: res.candidates,
    _meta: {
      grounded,
      degraded: false,
      match_type: res.matchType,
      matched_from: c?.matched_from ?? null,
      has_named_sblo: hasNamedSblo,
      has_email: hasEmail,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: !grounded
        ? `No SBLO record for "${company}" in the curated roster (200 canonical) or the 3,502-prime DB. That is a coverage gap, not proof they have no SBLO.`
        : hasNamedSblo
        ? `${c!.sblo_name}${c!.title ? `, ${c!.title}` : ''} at ${c!.company}${hasEmail ? ` (${c!.email})` : ' — no public email; use the supplier portal'}.`
        : `${c!.company} is in the roster but no public SBLO name was found — start at the supplier portal${c!.supplier_portal ? ` (${c!.supplier_portal})` : ''}.`,
      how_to_use: grounded
        ? 'The SBLO is the teaming front door at a prime — reach out to be added to their small-business/subcontractor pipeline. When the name/email is blank, the supplier portal is the honest next step; do NOT guess an address.'
        : 'Not in the curated set; do NOT invent a name/email. Suggest the prime\'s public supplier-diversity / small-business page, or search_contractors for their award footprint.',
      key_caveats: [
        c?.matched_from === 'prime_db'
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
