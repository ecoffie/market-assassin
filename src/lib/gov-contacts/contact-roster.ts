/**
 * Federal buying-office contact roster — the moat query, factored into a shared lib
 * so both the in-app /api/app/federal-contacts route and the MCP tool can produce the
 * SAME office-anchored named-people roster.
 *
 * The insight (Eric, Jun 2026): every DoD POC in federal_contacts is tagged
 * "DEPT OF DEFENSE", so filtering by a sub-agency (a USACE district, DARPA, MDA)
 * collapses to the whole department and shows the WRONG people (@dla.mil under DARPA).
 * The solicitation_number's 6-char DoDAAC prefix identifies the REAL office, so we
 * anchor on that (explicit DoDAAC, or the sub-agency's DoDAAC codes) and skip the broad
 * department filter. Overseas offices are dropped (a US small business won't bid them).
 *
 * Pure data access (Supabase read only, no LLM). Helpers below are a faithful lift of
 * the route-local versions; keep them in sync if the route's evolve.
 */
import { createClient } from '@supabase/supabase-js';
import { decodeDodaac } from '@/lib/gov-contacts/dodaac';
import { normalizeOfficeName } from '@/lib/gov-contacts/office-name';
import { deriveSubAgency } from '@/lib/gov-contacts/derive-subagency';
import { loadDodaacNames, dodaacCodesForAgency } from '@/lib/gov-contacts/dodaac-directory';
import { getEnhancedAgencyInfo } from '@/lib/utils/command-info';
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';

// ── Lifted route-local classifiers (faithful copies of federal-contacts/route.ts) ──
const FOREIGN_OFFICE_RE = /\b(yokosuka|okinawa|guam|sasebo|atsugi|japan|korea|seoul|osan|kunsan|europe|german|ramstein|kaiserslautern|italy|aviano|naples|sigonella|spain|rota|uk\b|united kingdom|england|raf\b|bahrain|qatar|kuwait|djibouti|far east|pacific command|africa command|european command|central command|overseas|apo\b|fpo\b)\b/i;
const REAL_ROLE_RE = /(contracting officer|contract specialist|contracting specialist|program manager|program analyst|specialist|director|administrator|procurement|small business|osbp|chief|officer|analyst|manager|coordinator|liaison|buyer)/i;
const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const OFFICE_WORDS = /\b(contracting|contract|acquisition|procurement|contr|cons|squadron|battalion|command|center|division|directorate|office|agency|activity|wing|installation|depot|arsenal|naval|army|air force|marine|garrison|district|region|logistics|systems|naysup|navsup|navfac|usace|dla|gsa|fisc|mcma)\b/i;
const JUNK_TITLE_RE = /^(mr|mrs|ms|miss|dr|none|n\/a|na|gm|khan|rector|head of organization|business poc|government business poc|electronic business poc)\.?$/i;
const OFFICE_ACRONYMS: Array<[RegExp, string]> = [
  [/\bUSPFO\b/i, 'US Property & Fiscal Office (National Guard)'],
  [/\bNAVSUP\s+FLT\s+LOG\s+CTR\b/i, 'Naval Supply Fleet Logistics Center'],
  [/\bNAVSUP\b/i, 'Naval Supply Systems Command'],
  [/\bNAVFACSYSCOM\b/i, 'Naval Facilities Engineering Command'],
  [/\bNAVFAC\b/i, 'Naval Facilities Engineering Command'],
  [/\bNAVSEA\b/i, 'Naval Sea Systems Command'],
  [/\bNAVAIR\b/i, 'Naval Air Systems Command'],
  [/\bNSWC\b/i, 'Naval Surface Warfare Center'],
  [/\bNUWC\b/i, 'Naval Undersea Warfare Center'],
  [/\bDITCO\b/i, 'Defense Information Technology Contracting Org'],
  [/\bDISA\b/i, 'Defense Information Systems Agency'],
  [/\bDLA\b/i, 'Defense Logistics Agency'],
  [/\bUSACE\b/i, 'US Army Corps of Engineers'],
  [/\bACC\b/i, 'Army Contracting Command'],
  [/\bMICC\b/i, 'Mission & Installation Contracting Command'],
  [/\bACA\b/i, 'Army Contracting Agency'],
  [/\bAFLCMC\b/i, 'Air Force Life Cycle Management Center'],
  [/\bAFICA\b/i, 'Air Force Installation Contracting Agency'],
  [/\bSPAWAR\b/i, 'Space & Naval Warfare Systems Command'],
  [/\bFISC\b/i, 'Fleet & Industrial Supply Center'],
];
function expandOfficeAcronyms(s: string): string {
  let out = s;
  for (const [re, full] of OFFICE_ACRONYMS) {
    if (re.test(out)) { out = out.replace(re, full); break; }
  }
  return out;
}
function cleanRawOffice(raw: string): string | null {
  const s = raw.trim().replace(/,\s*$/, '');
  if (s.length < 3) return null;
  if (FOREIGN_OFFICE_RE.test(s)) return null;
  if (OFFICE_WORDS.test(s)) return expandOfficeAcronyms(s);
  if (/,/.test(s) && !US_STATES.test(s)) return null;
  if (/,\s*[A-Z]{2}$/.test(s) && !OFFICE_WORDS.test(s)) return null;
  if (!/\s/.test(s) && s === s.toUpperCase()) return null;
  return expandOfficeAcronyms(s);
}
function classifyRole(t: string): string | null {
  if (/contracting officer|\bKO\b|\bACO\b|\bPCO\b/i.test(t)) return 'Contracting Officer';
  if (/small business|osbp|sblo|sadbu|disadvantaged business/i.test(t)) return 'Small Business';
  if (/contract specialist|contracting specialist|procurement|buyer|purchasing/i.test(t)) return 'Contract Specialist';
  if (/program (manager|analyst|director|lead)|\bPM\b|\bCOR\b|technical|engineer/i.test(t)) return 'Program / Technical';
  if (/director|chief|administrator|head/i.test(t)) return 'Leadership';
  return null;
}
function normalizeTitle(title: string | null): { role: string | null; pocLabel: string | null; roleCategory: string | null } {
  const t = (title || '').trim();
  if (!t) return { role: null, pocLabel: null, roleCategory: null };
  const pocMatch = /^(primary|secondary)\s+contact$/i.exec(t);
  if (pocMatch) return { role: null, pocLabel: pocMatch[1][0].toUpperCase() + pocMatch[1].slice(1).toLowerCase(), roleCategory: null };
  if (JUNK_TITLE_RE.test(t)) return { role: null, pocLabel: null, roleCategory: null };
  if (REAL_ROLE_RE.test(t)) return { role: t, pocLabel: null, roleCategory: classifyRole(t) };
  const role = t.length <= 60 ? t : null;
  return { role, pocLabel: null, roleCategory: role ? classifyRole(role) : null };
}
// Civilian bureaus / sub-agencies whose people are tagged in federal_contacts
// ONLY at the parent-department level (no sub_agency granularity for civilian
// agencies — verified: USDA rows carry an empty sub_agency). Without this, a
// query for a bureau name ("Forest Service") ilike-matches department_ind_agency
// ("Department of Agriculture") → ZERO rows → the tool returned only the single
// curated OSBP contact. Map the bureau the user names to its parent department
// keyword so the full roster resolves. (DoD components anchor earlier via their
// DoDAAC, so this list is civilian-focused.)
const BUREAU_TO_DEPARTMENT: Array<[RegExp, string]> = [
  [/forest service|\busfs\b|natural resources conservation|\bnrcs\b|farm service|\bfsa\b|rural development|\baphis\b|food safety|agricultural research|risk management agency/i, 'Agriculture'],
  [/internal revenue|\birs\b|comptroller of the currency|\bocc\b|\bfincen\b|\bttb\b|bureau of engraving|\bmint\b|bureau of the fiscal service/i, 'Treasury'],
  [/\bfbi\b|federal bureau of investigation|\bdea\b|drug enforcement|\batf\b|alcohol.*tobacco.*firearms|marshals service|bureau of prisons|\bbop\b|\beoir\b/i, 'Justice'],
  [/\bfema\b|emergency management|\btsa\b|transportation security|customs and border|\bcbp\b|immigration and customs|\bice\b|coast guard|\buscg\b|secret service|\bcisa\b|cybersecurity and infrastructure|citizenship and immigration|\buscis\b|federal law enforcement training/i, 'Homeland Security'],
  [/national park|\bnps\b|bureau of land management|\bblm\b|geological survey|\busgs\b|fish and wildlife|\bfws\b|bureau of reclamation|indian affairs|\bbia\b|ocean energy management|\bboem\b|surface mining/i, 'Interior'],
  [/\bcdc\b|disease control|\bfda\b|food and drug|\bnih\b|national institutes of health|\bcms\b|medicare|medicaid services|indian health|\bihs\b|\bsamhsa\b|\bhrsa\b|\bahrq\b|administration for children/i, 'Health'],
  [/\bfaa\b|federal aviation|federal highway|\bfhwa\b|federal railroad|\bfra\b|maritime administration|\bmarad\b|federal transit|\bfta\b|\bnhtsa\b|pipeline.*hazardous/i, 'Transportation'],
  [/\bnoaa\b|oceanic and atmospheric|census bureau|patent and trademark|\buspto\b|\bnist\b|standards and technology|economic development administration/i, 'Commerce'],
  [/\bnnsa\b|nuclear security|\bferc\b|energy regulatory|\bepa\b|environmental protection/i, 'Energy'],
  [/\bosha\b|occupational safety|bureau of labor statistics|\bbls\b|mine safety|\bmsha\b|employment and training/i, 'Labor'],
  [/veterans health|veterans benefits|\bvha\b|\bvba\b|national cemetery/i, 'Veterans'],
];

export function subAgencyToParent(name: string): string {
  for (const [re, parent] of BUREAU_TO_DEPARTMENT) {
    if (re.test(name)) return parent;
  }
  // No known bureau alias — strip filler words and match the department field directly.
  return name
    .replace(/\b(department|dept|of|the|agency|administration|us|u\.s\.|,)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface FederalContact {
  contact_fullname: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  department_ind_agency: string | null;
  role: string | null;
  role_category_label: string | null; // classified bucket (Contracting Officer, Small Business, …)
  poc_label: string | null;
  sub_agency: string | null;
  derived_office: string | null;
  dodaac: string | null;
  is_osbp?: boolean;
  director_verified?: string | null;
}

export interface ContactRosterInput {
  agency?: string;
  dodaac?: string;
  office?: string;
  role?: string;
  search?: string;
  limit?: number;
  /** Prepend the agency's OSBP small-business contact (default true when agency given). */
  includeOsbp?: boolean;
}

export interface ContactRosterResult {
  contacts: FederalContact[];
  anchor: 'dodaac' | 'agency-dodaac' | 'department' | 'search' | 'none';
  total: number;
  emailableCount: number;
  degraded: boolean;
  trace: string[];
}

export async function queryFederalContacts(input: ContactRosterInput): Promise<ContactRosterResult> {
  const trace: string[] = [];
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 200);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { contacts: [], anchor: 'none', total: 0, emailableCount: 0, degraded: true, trace: ['supabase env missing'] };
  }
  const sb = createClient(url, key);

  const agency = (input.agency || '').trim();
  const office = (input.office || '').trim();
  const role = (input.role || '').trim();
  const search = (input.search || '').trim();
  const validDodaac = isValidDodaac(input.dodaac || '') ? (input.dodaac as string).toUpperCase().trim() : '';

  let q = sb
    .from('federal_contacts')
    .select(
      'id, contact_fullname, contact_title, contact_email, contact_phone, department_ind_agency, office, sub_tier, role_category, solicitation_number',
      { count: 'exact' },
    );

  if (search) q = q.or(`contact_fullname.ilike.%${search}%,contact_title.ilike.%${search}%`);

  let anchor: ContactRosterResult['anchor'] = search ? 'search' : 'none';
  let anchoredByDodaac = false;
  if (validDodaac) {
    q = q.ilike('solicitation_number', `${validDodaac}%`);
    anchoredByDodaac = true;
    anchor = 'dodaac';
    trace.push(`anchored on explicit dodaac ${validDodaac}`);
  }
  if (agency && !anchoredByDodaac) {
    const dodaacCodes = (await dodaacCodesForAgency(agency)).filter(isValidDodaac);
    if (dodaacCodes.length > 0) {
      q = q.or(dodaacCodes.slice(0, 60).map((c) => `solicitation_number.ilike.${c}%`).join(','));
      anchoredByDodaac = true;
      anchor = 'agency-dodaac';
      trace.push(`anchored on ${dodaacCodes.length} dodaac code(s) for "${agency}"`);
    }
  }
  if (agency && !anchoredByDodaac) {
    const keyword = subAgencyToParent(agency);
    q = keyword.length >= 3 ? q.ilike('department_ind_agency', `%${keyword}%`) : q.ilike('department_ind_agency', `%${agency}%`);
    anchor = 'department';
    trace.push(`department preview on keyword "${keyword || agency}"`);
  }
  if (office && !validDodaac) q = q.ilike('office', `%${office}%`);
  if (role) q = q.eq('role_category', role);

  q = q.order('posted_date', { ascending: false, nullsFirst: false }).range(0, limit * 4 - 1);

  const { data, error, count } = await q;
  if (error) {
    return { contacts: [], anchor, total: 0, emailableCount: 0, degraded: true, trace: [...trace, `query error: ${error.message}`] };
  }

  const dodaacNames = await loadDodaacNames();
  const seen = new Set<string>();
  const rows = (data || []) as Array<Record<string, string | null>>;
  let contacts: FederalContact[] = rows
    .filter((r) => {
      const hay = `${r.office || ''} ${r.sub_tier || ''} ${r.contact_email || ''}`;
      if (FOREIGN_OFFICE_RE.test(hay)) return false;
      const dedup = (r.contact_email || `${r.contact_fullname}|${r.department_ind_agency}`).toLowerCase();
      if (!dedup.trim() || seen.has(dedup)) return false;
      seen.add(dedup);
      return true;
    })
    .map((r) => {
      const dod = decodeDodaac(r.solicitation_number || '');
      const rawOffice = dod?.dodaac ? dodaacNames.get(dod.dodaac) || dod.officeName || dod.dodaac : null;
      let officeName = rawOffice ? normalizeOfficeName(rawOffice, { mode: 'expand' }) : null;
      if (!officeName && r.office) {
        const cleaned = cleanRawOffice(String(r.office));
        if (cleaned) officeName = normalizeOfficeName(cleaned, { mode: 'expand' });
      }
      const { role: normRole, pocLabel, roleCategory } = normalizeTitle(r.contact_title);
      return {
        contact_fullname: r.contact_fullname,
        contact_title: r.contact_title,
        contact_email: r.contact_email,
        contact_phone: r.contact_phone,
        department_ind_agency: r.department_ind_agency,
        role: normRole,
        role_category_label: roleCategory,
        poc_label: pocLabel,
        sub_agency: deriveSubAgency(r.contact_email, r.solicitation_number),
        derived_office: officeName,
        dodaac: dod?.dodaac || null,
      } as FederalContact;
    })
    // second-pass foreign filter on the DECODED office name
    .filter((c) => !FOREIGN_OFFICE_RE.test(c.derived_office || ''));

  // Prepend the OSBP small-business contact for the agency (the front door).
  const includeOsbp = input.includeOsbp ?? !!agency;
  if (includeOsbp && agency) {
    try {
      const osbp = getEnhancedAgencyInfo(agency, agency, agency).smallBusinessContact;
      // Skip the GENERIC SBA fallback (email gcbd@sba.gov, reached when NOTHING matched)
      // — otherwise a nonsense agency looks "grounded" with a boilerplate SBA mailbox.
      // Real agency OSBPs carry their own agency email (VA osdbu@va.gov, NAVFAC …).
      const isGenericFallback = (osbp?.email || '').toLowerCase() === 'gcbd@sba.gov';
      if (!isGenericFallback && (osbp?.director || osbp?.email)) {
        contacts.unshift({
          contact_fullname: osbp.director || null,
          contact_title: 'Office of Small Business Programs',
          contact_email: osbp.email || null,
          contact_phone: osbp.phone || null,
          department_ind_agency: agency,
          role: 'OSBP',
          role_category_label: 'Small Business',
          poc_label: null,
          sub_agency: null,
          derived_office: osbp.name || null,
          dodaac: null,
          is_osbp: true,
          director_verified: osbp.directorVerified || null,
        });
      }
    } catch { /* OSBP prepend is best-effort */ }
  }

  contacts = contacts.slice(0, limit);
  const emailableCount = contacts.filter((c) => !!c.contact_email).length;
  return {
    contacts,
    anchor,
    total: count ?? contacts.length,
    emailableCount,
    degraded: false,
    trace,
  };
}
