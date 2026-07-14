/**
 * Office-anchored open-opportunity search — the moat query, factored out of the
 * target-market-research route so it can be shared (in-app + MCP).
 *
 * The insight (Eric, Jun 2026): a DoD sub-agency (DARPA, MDA, a USACE district)
 * shares ONE department label, so filtering sam_opportunities by department returns
 * the WHOLE-DoD firehose. The real buying office is the 6-char DoDAAC that PREFIXES
 * the solicitation_number (W912PL-24-R-0001 → W912PL = LA District). So we anchor by
 * DoDAAC prefix when we can resolve one, and only fall back to a department match for
 * civilian agencies that have no DoDAAC path.
 *
 * Pure data access (Supabase read only, no LLM). `_meta.anchor` tells the caller
 * whether the result is office-precise ('dodaac') or a broad department preview
 * ('department') so nothing is silently over-counted.
 */
import { createClient } from '@supabase/supabase-js';
import { dodaacCodesForAgency } from '@/lib/gov-contacts/dodaac-directory';
import { normalizeAgencyKey, isValidDodaac } from '@/lib/gov-contacts/agency-key';
import agencyAliases from '@/data/agency-aliases.json';

/** Expand an abbreviation/alias to its full agency name (e.g. "VA" → "Department of
 *  Veterans Affairs"), so both DoDAAC resolution and the department fallback get a
 *  real name to work with. Returns the input unchanged when no alias matches. */
function expandAlias(s: string): string {
  const aliases = (agencyAliases as { aliases?: Record<string, string> }).aliases || {};
  const up = s.trim().toUpperCase();
  return aliases[up] || aliases[s.trim()] || s.trim();
}

export interface OfficeOppsInput {
  /** Agency / command / sub-agency name, e.g. "USACE", "Naval Sea Systems Command". */
  agency?: string;
  /** A known 6-char DoDAAC (e.g. "W912PL"); takes precedence over agency resolution. */
  dodaac?: string;
  /** NAICS filter: <=4 digits = prefix, 6 = exact. */
  naics?: string;
  /** 2-letter place-of-performance state. */
  state?: string;
  /** Max rows (default 25, cap 100). */
  limit?: number;
}

export interface OfficeOpp {
  notice_id: string | null;
  solicitation_number: string | null;
  title: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  naics_code: string | null;
  psc_code: string | null;
  notice_type: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  pop_state: string | null;
  has_sow_doc: boolean | null;
  ui_link: string | null;
}

export interface OfficeOppsResult {
  opportunities: OfficeOpp[];
  dodaacs: string[];
  anchor: 'dodaac' | 'department' | 'none';
  total: number;
  degraded: boolean;
  trace: string[];
}

const LIGHT_COLS =
  'notice_id,solicitation_number,title,department,sub_tier,office,naics_code,psc_code,' +
  'notice_type,set_aside_code,set_aside_description,posted_date,response_deadline,pop_state,has_sow_doc,ui_link';

export async function searchOppsByOffice(input: OfficeOppsInput): Promise<OfficeOppsResult> {
  const trace: string[] = [];
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { opportunities: [], dodaacs: [], anchor: 'none', total: 0, degraded: true, trace: ['supabase env missing'] };
  }
  const supabase = createClient(url, key);

  const agencyRaw = (input.agency || '').trim();
  const agencyExpanded = agencyRaw ? expandAlias(agencyRaw) : '';

  // 1. Resolve DoDAAC prefixes — explicit dodaac wins, else resolve from the agency
  //    name. Try the alias-expanded name first (VA → Department of Veterans Affairs,
  //    ARMY CORPS → U.S. Army Corps of Engineers…) then the raw input.
  let dodaacs: string[] = [];
  const explicit = (input.dodaac || '').toUpperCase().trim();
  if (explicit) {
    if (isValidDodaac(explicit)) {
      dodaacs = [explicit];
      trace.push(`explicit dodaac ${explicit}`);
    } else {
      trace.push(`ignored invalid dodaac "${input.dodaac}"`);
    }
  } else if (agencyRaw) {
    for (const candidate of [agencyExpanded, agencyRaw]) {
      try {
        const codes = (await dodaacCodesForAgency(candidate)).filter(isValidDodaac);
        if (codes.length > 0) {
          dodaacs = codes;
          trace.push(`resolved ${codes.length} dodaac(s) for "${candidate}"`);
          break;
        }
      } catch (e) {
        trace.push(`dodaac resolve failed for "${candidate}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const nowIso = new Date().toISOString();
  const anchor: 'dodaac' | 'department' | 'none' = dodaacs.length > 0 ? 'dodaac' : agencyRaw ? 'department' : 'none';

  if (anchor === 'none') {
    return { opportunities: [], dodaacs: [], anchor: 'none', total: 0, degraded: false, trace: [...trace, 'no agency or dodaac supplied'] };
  }

  let query = supabase
    .from('sam_opportunities')
    .select(LIGHT_COLS, { count: 'exact' })
    .eq('active', true)
    .gt('response_deadline', nowIso);

  if (anchor === 'dodaac') {
    // Solicitation numbers begin with the DoDAAC (verified live: W912PL% → LA District).
    query = query.or(dodaacs.map((d) => `solicitation_number.ilike.${d}%`).join(','));
  } else {
    // Civilian / unresolved — honest broad department preview (NOT office-precise).
    // The DB stores department inverted ("VETERANS AFFAIRS, DEPARTMENT OF"), so match
    // on the normalized CORE tokens ("VETERANS AFFAIRS") rather than the raw phrase.
    const core = normalizeAgencyKey(agencyExpanded) || agencyExpanded.toUpperCase();
    trace.push(`department preview on core "${core}"`);
    query = query.ilike('department', `%${core}%`);
  }

  // Optional NAICS filter (prefix for <=4 digits, exact for 6).
  if (input.naics?.trim()) {
    const n = input.naics.trim();
    query = n.length <= 4 ? query.like('naics_code', `${n}%`) : query.eq('naics_code', n);
  }
  if (input.state?.trim()) {
    query = query.eq('pop_state', input.state.trim().toUpperCase());
  }

  query = query.order('posted_date', { ascending: false }).limit(limit);

  const { data, error, count } = await query;
  if (error) {
    return { opportunities: [], dodaacs, anchor, total: 0, degraded: true, trace: [...trace, `query error: ${error.message}`] };
  }

  const opportunities = (data || []) as unknown as OfficeOpp[];
  return {
    opportunities,
    dodaacs,
    anchor,
    total: count ?? opportunities.length,
    degraded: false,
    trace,
  };
}
