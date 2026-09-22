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
 * credits: 5. `_meta` always ships; `_ai_hint` OFF by default.
 */
import {
  getCommandInfo,
  getSmallBusinessContact,
  getCommandsByParentAgency,
  osbpContactForAgency,
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
  /**
   * ALWAYS present, never gated behind _ai_hint. Measured 2026-08-16: 121 of 169
   * commands carry no verification stamp, so the common case is an unverified
   * name — and a caller that only reads `osbp_director` cannot tell the
   * difference. A named human's stale email is the highest-consequence staleness
   * in the repo: the customer emails someone who left, and the failure is silent
   * and reputational. Say it in the payload, not in an optional hint.
   */
  director_status: 'verified' | 'unverified' | 'none';
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
    /** How many returned offices carry a verification stamp, and how many do not. */
    directors_verified: number;
    directors_unverified: number;
    /**
     * Distinguish "this agency is not in the curated directory" from
     * "the directory lists the command but has no OSBP office".
     */
    coverage: 'hit' | 'not_in_directory' | 'no_osbp_listed' | 'empty_query';
    /**
     * Diagnostic: the OSBP mailbox domain uniquely maps to a different
     * directory command. Never a promotion veto — identity stays on the office.
     */
    email_domain_flag: boolean;
  };
}

export type OsbpCoverage = 'hit' | 'not_in_directory' | 'no_osbp_listed' | 'empty_query';

export function classifyOsbpCoverage(input: {
  query: string;
  commandMatched: boolean;
  officeHasOsbp: boolean;
  relatedCount: number;
}): OsbpCoverage {
  if (!input.query.trim()) return 'empty_query';
  if (!input.commandMatched && input.relatedCount === 0) return 'not_in_directory';
  if (!input.officeHasOsbp && input.relatedCount === 0) return 'no_osbp_listed';
  return 'hit';
}
function directorStatus(director: string | null, verified: string | null): 'verified' | 'unverified' | 'none' {
  if (!director) return 'none';
  return verified ? 'verified' : 'unverified';
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
    director_status: directorStatus(sb?.director ?? null, sb?.directorVerified ?? null),
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
      _meta: {
        grounded: false, degraded: false, match: 'none', office_count: 0,
        director_verified: false, directors_verified: 0, directors_unverified: 0,
        coverage: 'empty_query',
        email_domain_flag: false,
      },
    };
  }

  // 1. Direct command match (NAVFAC, USACE, DLA Aviation, ...).
  const direct = getCommandInfo(agency);
  const prepend = osbpContactForAgency(agency);
  let office = direct && prepend.reason !== 'contradiction' ? toOffice(direct) : null;

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
        director_status: directorStatus(sb.contact.director ?? null, sb.contact.directorVerified ?? null),
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
  const allOffices = [...(resolvedOffice ? [resolvedOffice] : []), ...related];
  const anyVerified =
    (resolvedOffice?.director_verified != null) || related.some((o) => o.director_verified != null);
  const officeHasOsbp = !!(resolvedOffice?.osbp_office || resolvedOffice?.email);
  const coverage = classifyOsbpCoverage({
    query: agency,
    commandMatched: !!(direct || branchOnly),
    officeHasOsbp,
    relatedCount: related.length,
  });

  const result: FederalOsbpToolResult = {
    office: resolvedOffice,
    related_offices: related,
    _meta: {
      grounded,
      degraded: false,
      match,
      office_count: officeCount,
      director_verified: anyVerified,
      // A boolean over a set hid the shape: `true` because ONE of nine offices
      // was verified read as "these names are checked". Report the split.
      directors_verified: allOffices.filter((o) => o.director_status === 'verified').length,
      directors_unverified: allOffices.filter((o) => o.director_status === 'unverified').length,
      coverage,
      email_domain_flag: prepend.emailDomainFlag,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: coverage === 'not_in_directory'
        ? `No OSBP office found for "${agency}" because this name is not in the curated DoD command directory. That is a coverage gap, not proof the office does not exist.`
        : coverage === 'no_osbp_listed'
        ? `The directory has "${agency}" but lists no OSBP/OSDBU office for it. Do not invent a mailbox.`
        : match === 'parent_agency'
        ? `"${agency}" is a parent agency — returned ${related.length} of its commands' OSBP offices. Pick the one whose mission matches the buy.`
        : `OSBP for ${resolvedOffice?.abbreviation}: ${resolvedOffice?.osbp_office || 'office'}${resolvedOffice?.email ? ` (${resolvedOffice.email})` : ''}.`,
      how_to_use: grounded
        ? 'The OSBP/OSDBU is the small-business front door — email/call them to request a capability-statement review or a match to upcoming buys. Pair with search_federal_contacts for the buying-office engineers/POCs on a specific solicitation.'
        : 'Not in the directory; do NOT invent a name or email. Suggest the buying office POC on the actual SAM solicitation instead (search_federal_contacts).',
      key_caveats: [
        'Office structure + mailboxes are STABLE, but director NAMES rotate — trust `director_verified` (YYYY-MM); when it is null, treat the name as an unverified role-title and lead with the office mailbox, not the person.',
        'Curated directory is DoD/DLA/Navy/Army-weighted — coverage=not_in_directory is a gap, not proof the office does not exist. coverage=no_osbp_listed means the command is known but no OSBP row is stored.',
      ],
    };
  }
  return result;
}
