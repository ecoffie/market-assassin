/**
 * MCP tool: search_federal_contacts — the named people at a federal BUYING OFFICE
 * (contracting officers, contract specialists, small-business POCs), anchored on the
 * office's DoDAAC so a DoD sub-agency returns ITS people, not the whole-DoD firehose.
 * This is "nobody hands you the customer" made literal — the actual humans to email.
 *
 * Wraps the shared src/lib/gov-contacts/contact-roster.ts (Supabase read, no LLM).
 * The agency's OSBP small-business contact is prepended as the front door. Honest:
 * grounded=false = no matching contacts (not an invented POC); _meta.anchor tells you
 * whether the roster is office-precise ('dodaac'/'agency-dodaac') or a broad department
 * preview ('department'). tier: metered, credits: 2. `_ai_hint` OFF by default.
 */
import { queryFederalContacts, type FederalContact } from '@/lib/gov-contacts/contact-roster';
import { mcpFlags } from '@/lib/mcp/flags';

export interface FederalContactsToolInput {
  agency?: string;
  dodaac?: string;
  office?: string;
  role?: string;
  search?: string;
  limit?: number;
}

export interface FederalContactsToolResult {
  contacts: FederalContact[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    anchor: 'dodaac' | 'agency-dodaac' | 'department' | 'search' | 'none';
    count: number;
    emailable_count: number;
    total: number;
  };
}

export async function searchFederalContacts(input: FederalContactsToolInput): Promise<FederalContactsToolResult> {
  const res = await queryFederalContacts({
    agency: input.agency,
    dodaac: input.dodaac,
    office: input.office,
    role: input.role,
    search: input.search,
    limit: input.limit,
  });

  const grounded = res.contacts.length > 0;
  const officePrecise = res.anchor === 'dodaac' || res.anchor === 'agency-dodaac';

  const result: FederalContactsToolResult = {
    contacts: res.contacts,
    _meta: {
      grounded,
      degraded: res.degraded,
      anchor: res.anchor,
      count: res.contacts.length,
      emailable_count: res.emailableCount,
      total: res.total,
    },
  };

  if (mcpFlags.aiHint) {
    const named = res.contacts.find((c) => c.contact_email);
    result._ai_hint = {
      summary: res.degraded
        ? 'The contacts source errored (Supabase unreachable) — temporarily unavailable, not "no contacts".'
        : res.anchor === 'none'
        ? 'Provide an agency/command name, a 6-char DoDAAC, or a search term — nothing to look up.'
        : !grounded
        ? 'No contacts matched. Try the parent command, a DoDAAC if you have one, or drop the role filter.'
        : officePrecise
        ? `${res.contacts.length} contact(s) at this office (${res.anchor === 'dodaac' ? 'DoDAAC-anchored' : 'agency DoDAAC codes'}), ${res.emailableCount} emailable${named ? ` — e.g. ${named.contact_fullname} (${named.role || 'POC'})` : ''}.`
        : `${res.contacts.length} contact(s) via a department-wide match (no DoDAAC path) — these may span multiple offices; ${res.emailableCount} emailable.`,
      how_to_use:
        'The OSBP row (is_osbp=true) is the small-business front door — start there, then the Contracting Officer / Contract Specialist for a specific buy. Only email contacts with a real address; a null email means no public address (do not guess one).',
      key_caveats: [
        'anchor="dodaac"/"agency-dodaac" = office-precise; anchor="department" = a broad department preview (civilian agencies have no DoDAAC path) that may mix offices — say which you got.',
        'Overseas offices are intentionally filtered out (a US small business will not bid them). POC data is from SAM solicitations and can lag staff changes.',
      ],
    };
  }
  return result;
}
