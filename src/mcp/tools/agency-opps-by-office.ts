/**
 * MCP tool: search_agency_opps_by_office — open SAM.gov solicitations anchored to a
 * specific BUYING OFFICE, not the whole department. The moat: a DoD sub-agency shares
 * one department label, so a plain department filter returns the whole-DoD firehose;
 * this anchors on the 6-char DoDAAC that prefixes the solicitation number (W912PL =
 * USACE LA District) so you get THAT office's real open buys.
 *
 * Wraps the shared src/lib/opportunities/by-office.ts (Supabase read, no LLM).
 * `_meta.anchor` is honest: 'dodaac' = office-precise; 'department' = a broad civilian
 * preview (no DoDAAC path) — the agent should say which it got. tier: metered,
 * credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { searchOppsByOffice, type OfficeOpp } from '@/lib/opportunities/by-office';
import { mcpFlags } from '@/lib/mcp/flags';

export interface AgencyOppsByOfficeInput {
  agency?: string;
  dodaac?: string;
  naics?: string;
  state?: string;
  limit?: number;
}

export interface AgencyOppsByOfficeResult {
  opportunities: OfficeOpp[];
  dodaacs: string[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    anchor: 'dodaac' | 'department' | 'none';
    dodaac_count: number;
    count: number;
    total: number;
  };
}

export async function searchAgencyOppsByOffice(input: AgencyOppsByOfficeInput): Promise<AgencyOppsByOfficeResult> {
  const res = await searchOppsByOffice({
    agency: input.agency,
    dodaac: input.dodaac,
    naics: input.naics,
    state: input.state,
    limit: input.limit,
  });

  const grounded = res.opportunities.length > 0;

  const result: AgencyOppsByOfficeResult = {
    opportunities: res.opportunities,
    dodaacs: res.dodaacs,
    _meta: {
      grounded,
      degraded: res.degraded,
      anchor: res.anchor,
      dodaac_count: res.dodaacs.length,
      count: res.opportunities.length,
      total: res.total,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: res.degraded
        ? 'The opportunities source errored (Supabase unreachable) — treat as temporarily unavailable, not as "no open buys".'
        : res.anchor === 'none'
        ? 'Provide an agency/command name or a 6-char DoDAAC — nothing to anchor the search to.'
        : !grounded
        ? res.anchor === 'dodaac'
          ? `No OPEN solicitations right now at ${res.dodaacs.join(', ')}. That is a real "quiet today," not an error — check recompetes/forecasts for what is coming.`
          : `No open solicitations matched department "${input.agency}". Try the exact command name, or a DoDAAC if you have one.`
        : res.anchor === 'dodaac'
        ? `${res.total} open solicitation(s) at this office (DoDAAC ${res.dodaacs.join(', ')}) — office-precise, not the whole department.`
        : `${res.total} open solicitation(s) matched department "${input.agency}" — this is a BROAD department preview (no DoDAAC path for this agency), not a single office.`,
      how_to_use:
        'anchor="dodaac" means these are THIS buying office\'s own open buys — pair with lookup_federal_osbp + search_federal_contacts to get the people. anchor="department" is a wide net; narrow it with a NAICS or a DoDAAC.',
      key_caveats: [
        'DoDAAC anchoring covers DoD/DLA/Navy/Army buying offices; civilian agencies fall back to a department-wide preview (anchor="department") — say which you got.',
        'Open = active with a future response_deadline. An empty office-precise result is a genuine "nothing open now," not a miss.',
      ],
    };
  }
  return result;
}
