/**
 * getBuyerDetail(id) — the ONE-CALL feed for the Opportunity Map Gov Buyer drawer.
 *
 * Mirrors `getCompanyDetail(uei)` for the company drawer: the drawer JS fetches this once
 * (via /api/app/buyer-detail?id=<federal_contacts.id>) and renders every section from the
 * response. A "buyer" is a government decision-maker (contracting officer / primary POC) — a
 * PERSON, not a firm — so the sections are person-appropriate:
 *
 *   • header       — name · title/role · agency · office · location (contact info too)
 *   • opportunities — the solicitations/opps this POC is NAMED ON (federal_contacts ⋈
 *                     sam_opportunities by solicitation_number). "What are they buying" — the
 *                     buyer's most useful section.
 *   • office roster — OTHER contacts at the same agency (who else to reach). Reuses the same
 *                     federal_contacts directory the opp drawer's roster uses.
 *   • agency intel  — priorities / pain points for the buyer's agency (getUnifiedAgencyIntelligence).
 *
 * Everything is grounded in real data (federal_contacts / sam_opportunities / agency_intelligence)
 * — never an LLM guess. The phone-as-name guard (#462) is honored via isUsableContactCard so a
 * "Telephone: 7175503112" placeholder is never shown as a name.
 *
 * Consciously N/A for a buyer (justified per GOS #9c): Bid facts, SOW, Estimated value, set-aside
 * chips, "Should I bid?" — meaningless for a person.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isUsableContactCard } from './contact-quality';
import { getUnifiedAgencyIntelligence } from '@/lib/agency-intelligence';
import { formatAgencyDisplay } from '@/lib/mindy/agency-display';
import { resolveBuyerLocation } from '@/lib/geo/city-geocode';

export interface BuyerOpportunity {
  noticeId: string | null;
  solicitationNumber: string;
  title: string;
  noticeType: string;
  naics: string;
  setAside: string;
  deadline: string | null;
  posted: string | null;
  uiLink: string | null;
  active: boolean;
}

export interface BuyerRosterContact {
  id: string;   // federal_contacts id → the roster card can open THAT buyer's drawer (peer flywheel)
  name: string;
  title: string;
  email: string;
  phone: string;
  office: string;
}

export interface BuyerDetail {
  id: string;
  name: string;
  title: string;
  role: string;        // Contracting Officer / Primary Contact (from role_category or title)
  agency: string;      // human-readable display name ("Department of State")
  agencyRaw: string;   // raw department_ind_agency ("STATE, DEPARTMENT OF") — for DB-match links
  office: string;
  email: string;
  phone: string;
  location: string;    // "City, ST" or "ST" — recovered from the notices, if available
  locApprox: boolean;  // true when we only have a state (no confirmed city)
  opportunities: BuyerOpportunity[];
  oppCount: number;
  roster: BuyerRosterContact[];
  agencyIntel: { priorities: string[]; painPoints: string[] } | null;
}

function sb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Derive a clean "role" label from the raw role_category / title. Falls back to a plain
// "Primary Contact" so the header always has a role line (never a fabricated one).
function deriveRole(roleCategory: string, title: string): string {
  const t = `${roleCategory} ${title}`.toLowerCase();
  if (/contracting officer|\bko\b|\bco\b/.test(t)) return 'Contracting Officer';
  if (/contract specialist/.test(t)) return 'Contract Specialist';
  if (/small business|osbp/.test(t)) return 'Small Business Specialist';
  if (title && title.trim()) return title.trim();
  return 'Primary Contact';
}

/**
 * Build the Gov Buyer detail for a federal_contacts row id. Returns null on an unknown /
 * unusable id (mirrors getCompanyDetail's honest-404 contract).
 */
export async function getBuyerDetail(id: string): Promise<BuyerDetail | null> {
  const db = sb();

  // 1. The buyer's own contact row — name / title / agency / office / email / phone.
  const { data: rows, error: rowErr } = await db
    .from('federal_contacts')
    .select('id, contact_fullname, contact_title, contact_email, contact_phone, department_ind_agency, office, sub_tier, role_category, solicitation_number')
    .eq('id', id)
    .limit(1);
  if (rowErr) throw rowErr;
  const me = (rows || [])[0] as
    | { id: number; contact_fullname: string | null; contact_title: string | null; contact_email: string | null; contact_phone: string | null; department_ind_agency: string | null; office: string | null; sub_tier: string | null; role_category: string | null; solicitation_number: string | null }
    | undefined;
  if (!me || !isUsableContactCard(me as Record<string, unknown>)) return null;

  const name = me.contact_fullname || 'Contact';
  // `agency` = the RAW stored value (used to JOIN the roster + agency intel by
  // department_ind_agency). `agencyDisplay` = the human-readable name shown in the drawer
  // header ("STATE, DEPARTMENT OF" → "Department of State"), never used for a DB match.
  const agency = me.department_ind_agency || '';
  const agencyDisplay = formatAgencyDisplay(agency) || 'Government';
  const office = me.sub_tier || me.office || '';
  const title = me.contact_title || '';
  const role = deriveRole(me.role_category || '', title);

  // 2. The opportunities this POC is NAMED ON. federal_contacts stores one row per
  //    (person, notice), so the same person appears across many solicitation_numbers. Gather
  //    every solicitation this name+agency is on, then hydrate from sam_opportunities.
  const { data: mine, error: mineErr } = await db
    .from('federal_contacts')
    .select('solicitation_number')
    .eq('contact_fullname', name)
    .eq('department_ind_agency', agency)
    .not('solicitation_number', 'is', null)
    .limit(400);
  if (mineErr) throw mineErr;
  const solNums = Array.from(
    new Set(((mine || []) as Array<{ solicitation_number: string | null }>).map((r) => String(r.solicitation_number || '')).filter(Boolean)),
  ).slice(0, 200);

  const opportunities: BuyerOpportunity[] = [];
  let location = '';
  let locApprox = false;
  if (solNums.length) {
    const { data: opps, error: oppErr } = await db
      .from('sam_opportunities')
      .select('notice_id, solicitation_number, title, notice_type, naics_code, set_aside_code, set_aside_description, response_deadline, posted_date, ui_link, active, pop_city, pop_state, office_address')
      .in('solicitation_number', solNums)
      .order('posted_date', { ascending: false })
      .limit(60);
    if (oppErr) throw oppErr;
    const nowMs = Date.now();
    for (const o of (opps || []) as Array<Record<string, unknown>>) {
      const deadline = (o.response_deadline as string | null) || null;
      const activeFlag = o.active !== false && (!deadline || new Date(deadline).getTime() > nowMs);
      opportunities.push({
        noticeId: (o.notice_id as string | null) || null,
        solicitationNumber: String(o.solicitation_number || ''),
        title: (o.title as string) || 'Opportunity',
        noticeType: (o.notice_type as string) || '',
        naics: (o.naics_code as string) || '',
        setAside: (o.set_aside_description as string) || (o.set_aside_code as string) || '',
        deadline,
        posted: (o.posted_date as string | null) || null,
        uiLink: (o.ui_link as string | null) || null,
        active: activeFlag,
      });
      // Recover the buyer's location from the first notice that carries a coherent one.
      // `resolveBuyerLocation` fixes the "Seoul, DC" bug: a foreign place of performance
      // (pop_city="Seoul", pop_state="KR-11") is NEVER paired with the DC buying-office
      // state — a city is shown only when it's a real GeoNames city IN the resolved state,
      // otherwise state-level (noted). Never fabricated.
      if (!location) {
        const oa = (o.office_address as { city?: string; state?: string } | null) || null;
        const resolved = resolveBuyerLocation({
          popCity: (o.pop_city as string | null) ?? null,
          popState: (o.pop_state as string | null) ?? null,
          officeCity: oa?.city ?? null,
          officeState: oa?.state ?? null,
        });
        if (resolved) {
          location = resolved.city ? `${resolved.city}, ${resolved.state}` : resolved.state;
          // Approximate when we don't have a confirmed place-of-performance city: either
          // state-only, OR the location is the buying OFFICE (a foreign PoP fell back to it).
          locApprox = !resolved.city || !!resolved.approxNote;
        }
      }
    }
    // Sort: active/open notices first, then by posted date desc.
    opportunities.sort((a, b) => (Number(b.active) - Number(a.active)) || String(b.posted || '').localeCompare(String(a.posted || '')));
  }

  // 3. Office / agency roster — OTHER contacts at the same agency to network with. Reuses the
  //    federal_contacts directory (same source the opp drawer's roster uses). Filtered to real,
  //    usable cards, excluding the buyer themselves.
  const roster: BuyerRosterContact[] = [];
  if (agency) {
    const { data: rmates, error: rErr } = await db
      .from('federal_contacts')
      .select('id, contact_fullname, contact_title, contact_email, contact_phone, department_ind_agency, office, sub_tier, solicitation_number')
      .eq('department_ind_agency', agency)
      .neq('id', id)
      .not('contact_fullname', 'is', null)
      .not('contact_fullname', 'ilike', 'telephone:%')
      .not('contact_fullname', 'ilike', 'phone:%')
      .not('contact_fullname', 'ilike', 'fax:%')
      .not('contact_fullname', 'ilike', 'tel:%')
      .limit(120);
    if (rErr) throw rErr;
    const seen = new Set<string>([name.toLowerCase()]);
    for (const c of (rmates || []) as Array<Record<string, unknown>>) {
      if (!isUsableContactCard(c)) continue;
      const nm = String(c.contact_fullname || '');
      const key = nm.toLowerCase();
      if (!nm || seen.has(key)) continue;
      seen.add(key);
      roster.push({
        id: String(c.id ?? ''),
        name: nm,
        title: String(c.contact_title || ''),
        email: String(c.contact_email || ''),
        phone: String(c.contact_phone || ''),
        office: String(c.sub_tier || c.office || ''),
      });
      if (roster.length >= 8) break;
    }
  }

  // 4. Agency intel — priorities / pain points for the buyer's agency (honest null when none).
  let agencyIntel: { priorities: string[]; painPoints: string[] } | null = null;
  if (agency) {
    try {
      const intel = await getUnifiedAgencyIntelligence(agency);
      if (intel && (intel.priorities.length || intel.painPoints.length)) {
        agencyIntel = { priorities: intel.priorities.slice(0, 5), painPoints: intel.painPoints.slice(0, 5) };
      }
    } catch {
      agencyIntel = null; // intel is a nice-to-have; never fail the whole drawer for it
    }
  }

  return {
    id: String(me.id),
    name,
    title,
    role,
    agency: agencyDisplay,
    agencyRaw: agency,
    office,
    email: me.contact_email || '',
    phone: me.contact_phone || '',
    location,
    locApprox,
    opportunities,
    oppCount: opportunities.length,
    roster,
    agencyIntel,
  };
}
