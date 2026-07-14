/**
 * MCP tool: lookup_federal_osbp — the Office of Small Business Programs (OSBP /
 * OSDBU) contact + acquisition office for a federal command or agency. This is the
 * "who do I actually call to get in the door" answer for a small business — the
 * curated DoD command / OSBP directory (src/data/dod-command-info.json), served
 * through the pure src/lib/utils/command-info.ts helpers (no LLM, no network).
 *
 * Honest about staleness: the org STRUCTURE + mailboxes are stable; director NAMES
 * rotate. Each office carries `director_verified` ("YYYY-MM" when the name was last
 * checked) — absent means treat the name as unverified/role-title. tier: metered,
 * credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import {
  getCommandInfo,
  getSmallBusinessContact,
  getCommandsByParentAgency,
  type CommandInfo,
} from '@/lib/utils/command-info';
import { mcpFlags } from '@/lib/mcp/flags';

export interface FederalOsbpToolInput {
  /** A command/agency name or abbreviation, e.g. "NAVFAC", "USACE", "Department of the Navy". */
  agency: string;
}

interface OsbpOffice {
  command: string;
  abbreviation: string;
  parent_agency: string;
  osbp_office: string | null;
  osbp_director: string | null;
  director_verified: string | null; // "YYYY-MM" or null (unverified / role-title)
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  forecast_url: string | null;
  acquisition_office: string | null;
  key_capabilities: string[];
}

export interface FederalOsbpToolResult {
  /** Best direct command match (null when the input only resolves to a parent agency). */
  office: OsbpOffice | null;
  /** When the input is a parent agency (e.g. "Navy", "Army"), all its commands' OSBP offices. */
  related_offices: OsbpOffice[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    match: 'command' | 'parent_agency' | 'none';
    office_count: number;
    director_verified: boolean;
  };
}

function toOffice(info: CommandInfo): OsbpOffice {
  const sb = info.smallBusinessOffice;
  return {
    command: info.fullName,
    abbreviation: info.abbreviation,
    parent_agency: info.parentAgency,
    osbp_office: sb?.name ?? null,
    osbp_director: sb?.director ?? null,
    director_verified: sb?.directorVerified ?? null,
    email: sb?.email ?? null,
    phone: sb?.phone ?? null,
    address: sb?.address ?? null,
    website: info.website ?? null,
    forecast_url: info.forecastUrl ?? null,
    acquisition_office: info.acquisitionOffice?.name ?? null,
    key_capabilities: info.keyCapabilities ?? [],
  };
}

export function lookupFederalOsbp(input: FederalOsbpToolInput): FederalOsbpToolResult {
  const agency = (input.agency || '').trim();

  if (!agency) {
    return {
      office: null,
      related_offices: [],
      _meta: { grounded: false, degraded: false, match: 'none', office_count: 0, director_verified: false },
    };
  }

  // 1. Direct command match (NAVFAC, USACE, DLA Aviation, ...).
  const direct = getCommandInfo(agency);
  const office = direct ? toOffice(direct) : null;

  // 2. Parent-agency roster (e.g. "Navy" → NAVFAC, NAVSUP, SPAWAR, ...).
  //    Exclude the direct match if it's already surfaced above.
  const related = getCommandsByParentAgency(agency)
    .filter((c) => !direct || c.abbreviation !== direct.abbreviation)
    .map(toOffice);

  // Fallback: the branch-level small-business contact when no command/parent matched.
  let branchOnly: OsbpOffice | null = null;
  if (!office && related.length === 0) {
    const sb = getSmallBusinessContact(agency);
    if (sb.contact) {
      branchOnly = {
        command: sb.source,
        abbreviation: sb.source,
        parent_agency: agency,
        osbp_office: sb.contact.name ?? null,
        osbp_director: sb.contact.director ?? null,
        director_verified: sb.contact.directorVerified ?? null,
        email: sb.contact.email ?? null,
        phone: sb.contact.phone ?? null,
        address: sb.contact.address ?? null,
        website: null,
        forecast_url: null,
        acquisition_office: null,
        key_capabilities: [],
      };
    }
  }

  const resolvedOffice = office ?? branchOnly;
  const match: 'command' | 'parent_agency' | 'none' = office || branchOnly ? 'command' : related.length > 0 ? 'parent_agency' : 'none';
  const grounded = resolvedOffice !== null || related.length > 0;
  const officeCount = (resolvedOffice ? 1 : 0) + related.length;
  const anyVerified =
    (resolvedOffice?.director_verified != null) || related.some((o) => o.director_verified != null);

  const result: FederalOsbpToolResult = {
    office: resolvedOffice,
    related_offices: related,
    _meta: {
      grounded,
      degraded: false,
      match,
      office_count: officeCount,
      director_verified: anyVerified,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: !grounded
        ? `No OSBP office found for "${agency}" in the curated DoD command directory. This directory is DoD/DLA/Navy/Army-weighted — a civilian agency or an unusual spelling may simply not be covered.`
        : match === 'parent_agency'
        ? `"${agency}" is a parent agency — returned ${related.length} of its commands' OSBP offices. Pick the one whose mission matches the buy.`
        : `OSBP for ${resolvedOffice?.abbreviation}: ${resolvedOffice?.osbp_office || 'office'}${resolvedOffice?.email ? ` (${resolvedOffice.email})` : ''}.`,
      how_to_use: grounded
        ? 'The OSBP/OSDBU is the small-business front door — email/call them to request a capability-statement review or a match to upcoming buys. Pair with search_federal_contacts for the buying-office engineers/POCs on a specific solicitation.'
        : 'Not in the directory; do NOT invent a name or email. Suggest the buying office POC on the actual SAM solicitation instead (search_federal_contacts).',
      key_caveats: [
        'Office structure + mailboxes are STABLE, but director NAMES rotate — trust `director_verified` (YYYY-MM); when it is null, treat the name as an unverified role-title and lead with the office mailbox, not the person.',
        'Curated directory is DoD/DLA/Navy/Army-weighted — a "none" result is a coverage gap, not proof the office does not exist.',
      ],
    };
  }
  return result;
}
