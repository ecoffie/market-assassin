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
import { agencySearchKeywords } from '@/lib/gov-contacts/agency-search';

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
// Map a caller/LLM role query ("contracting_officer", "small business", "CO") to a
// canonical title bucket, or null if it maps to none. The DB `role_category` column is
// a uniform coarse ingest tag ("contracting") — useless for filtering — so role
// filtering happens IN MEMORY against the title-derived bucket (classifyRole) instead.
export function roleQueryToBucket(role: string): string | null {
  const q = role.replace(/[_-]+/g, ' ').trim();
  if (!q) return null;
  // Bare acronyms the title-classifier's word-boundary regexes won't catch on their own.
  if (/^(co|ko|pco|aco)$/i.test(q)) return 'Contracting Officer';
  if (/^cs$/i.test(q)) return 'Contract Specialist';
  if (/^(osbp|sblo|sadbu)$/i.test(q)) return 'Small Business';
  return classifyRole(q);
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
// Civilian bureaus / sub-agencies. federal_contacts tags civilian people at the
// parent-department level in `department_ind_agency` ("Department of Agriculture")
// AND — for a subset of rows — the specific bureau in `sub_tier` ("FOREST
// SERVICE"). So each bureau maps to TWO keywords:
//   dept    — matches department_ind_agency (the anchor; always resolves a roster)
//   subTier — matches sub_tier to NARROW to that bureau (undefined = no narrow)
// The query narrows on sub_tier when present, and FALLS BACK to the department
// roster if the narrow finds nothing (many rows have a null sub_tier), so a
// bureau query is never empty. (DoD components anchor earlier via their DoDAAC.)
const BUREAU_MAP: Array<[RegExp, string, string?]> = [
  // DoD components. Measured 2026-07-17: "DEFENSE LOGISTICS AGENCY" is the SINGLE
  // LARGEST sub_tier in federal_contacts (7,890 rows) — but the acronym everyone
  // actually types found only 52, because "DLA" appears nowhere in that text. A 152x
  // miss that never errored: it resolved, searched, and returned almost nothing.
  // (Army/Navy/Air Force need no alias — those words ARE in their sub_tier text, so
  // the sub_tier ILIKE from #230 already finds them.)
  [/\bdla\b|defense logistics/i, 'Defense', 'defense logistics'],
  // USDA (sub_tier confirmed populated: FOREST SERVICE, AGRICULTURAL RESEARCH SERVICE, …)
  [/forest service|\busfs\b/i, 'Agriculture', 'forest service'],
  [/natural resources conservation|\bnrcs\b/i, 'Agriculture', 'natural resources conservation'],
  [/farm service|\bfsa\b|farm production/i, 'Agriculture', 'farm'],
  [/\baphis\b|animal and plant/i, 'Agriculture', 'animal and plant'],
  [/agricultural research|\bars\b/i, 'Agriculture', 'agricultural research'],
  [/agricultural marketing|\bams\b/i, 'Agriculture', 'agricultural marketing'],
  [/food and nutrition|\bfns\b/i, 'Agriculture', 'food and nutrition'],
  [/rural development/i, 'Agriculture', 'rural'],
  [/food safety|\bfsis\b/i, 'Agriculture', 'food safety'],
  // Treasury
  [/internal revenue|\birs\b/i, 'Treasury', 'internal revenue'],
  [/comptroller of the currency|\bocc\b/i, 'Treasury', 'comptroller'],
  [/\bfincen\b|financial crimes/i, 'Treasury', 'financial crimes'],
  [/\bttb\b|alcohol and tobacco tax/i, 'Treasury', 'alcohol and tobacco'],
  [/\bmint\b/i, 'Treasury', 'mint'],
  [/bureau of engraving/i, 'Treasury', 'engraving'],
  [/fiscal service/i, 'Treasury', 'fiscal'],
  // Justice
  [/\bfbi\b|federal bureau of investigation/i, 'Justice', 'investigation'],
  [/\bdea\b|drug enforcement/i, 'Justice', 'drug enforcement'],
  [/\batf\b|alcohol.*tobacco.*firearms/i, 'Justice', 'firearms'],
  [/marshals/i, 'Justice', 'marshals'],
  [/bureau of prisons|\bbop\b/i, 'Justice', 'prisons'],
  // Homeland Security
  [/\bfema\b|emergency management/i, 'Homeland Security', 'emergency management'],
  [/\btsa\b|transportation security/i, 'Homeland Security', 'transportation security'],
  [/customs and border|\bcbp\b/i, 'Homeland Security', 'customs and border'],
  [/immigration and customs|\bice\b/i, 'Homeland Security', 'immigration and customs'],
  [/coast guard|\buscg\b/i, 'Homeland Security', 'coast guard'],
  [/secret service/i, 'Homeland Security', 'secret service'],
  [/\bcisa\b|cybersecurity and infrastructure/i, 'Homeland Security', 'cybersecurity'],
  [/citizenship and immigration|\buscis\b/i, 'Homeland Security', 'citizenship'],
  // Interior
  [/national park|\bnps\b/i, 'Interior', 'national park'],
  [/bureau of land management|\bblm\b/i, 'Interior', 'land management'],
  [/geological survey|\busgs\b/i, 'Interior', 'geological'],
  [/fish and wildlife|\bfws\b/i, 'Interior', 'fish and wildlife'],
  [/bureau of reclamation/i, 'Interior', 'reclamation'],
  [/indian affairs|\bbia\b/i, 'Interior', 'indian affairs'],
  // Health & Human Services
  [/\bcdc\b|disease control/i, 'Health', 'disease control'],
  [/\bfda\b|food and drug/i, 'Health', 'food and drug'],
  [/\bnih\b|national institutes of health/i, 'Health', 'national institutes of health'],
  [/\bcms\b|medicare|medicaid services/i, 'Health', 'medicare'],
  [/indian health|\bihs\b/i, 'Health', 'indian health'],
  // Transportation
  [/\bfaa\b|federal aviation/i, 'Transportation', 'aviation'],
  [/federal highway|\bfhwa\b/i, 'Transportation', 'highway'],
  [/federal railroad|\bfra\b/i, 'Transportation', 'railroad'],
  [/maritime administration|\bmarad\b/i, 'Transportation', 'maritime'],
  [/federal transit|\bfta\b/i, 'Transportation', 'transit'],
  // Commerce
  [/\bnoaa\b|oceanic and atmospheric/i, 'Commerce', 'oceanic'],
  [/census bureau/i, 'Commerce', 'census'],
  [/patent and trademark|\buspto\b/i, 'Commerce', 'patent'],
  [/\bnist\b|standards and technology/i, 'Commerce', 'standards and technology'],
  // Energy
  [/\bnnsa\b|nuclear security/i, 'Energy', 'nuclear'],
  [/\bferc\b|energy regulatory/i, 'Energy', 'energy regulatory'],
  // EPA is its OWN department (not under Energy) — anchor on its own name, no narrow.
  [/\bepa\b|environmental protection/i, 'Environmental Protection'],
  // Labor
  [/\bosha\b|occupational safety/i, 'Labor', 'occupational safety'],
  [/bureau of labor statistics|\bbls\b/i, 'Labor', 'labor statistics'],
  // Veterans Affairs
  [/veterans health|\bvha\b/i, 'Veterans', 'veterans health'],
  [/veterans benefits|\bvba\b/i, 'Veterans', 'veterans benefits'],
];

// Parent-department acronyms → department_ind_agency keyword. No sub_tier narrow:
// these are the whole department, so they return the full roster like the spelled-out name.
const DEPARTMENT_ACRONYMS: Array<[RegExp, string]> = [
  [/\busda\b/i, 'Agriculture'],
  [/\bdhs\b/i, 'Homeland Security'],
  [/\bdod\b|\bd\.o\.d\.?\b/i, 'Defense'],
  [/\bdoj\b/i, 'Justice'],
  [/\bhhs\b/i, 'Health'],
  [/\bdot\b/i, 'Transportation'],
  [/\bdoe\b/i, 'Energy'],
  [/\bhud\b/i, 'Housing'],
  [/\bdoi\b/i, 'Interior'],
  [/\bva\b/i, 'Veterans'],
  // Standalone agencies — their own department_ind_agency, sub_tier null or self-
  // referential, so there is no bureau to narrow to. Measured 2026-07-17: the acronym
  // found 18 contacts, the real name 1,094 (GSA) and 981 (NASA) — 61x and 55x misses.
  [/\bgsa\b/i, 'General Services'],
  [/\bnasa\b/i, 'Aeronautics'],
];

/** Resolve an agency/bureau name to its parent-department keyword + optional sub_tier narrow keyword. */
export function resolveAgency(name: string): { deptKeyword: string; subTier?: string } {
  for (const [re, dept, subTier] of BUREAU_MAP) {
    if (re.test(name)) return { deptKeyword: dept, subTier };
  }
  for (const [re, dept] of DEPARTMENT_ACRONYMS) {
    if (re.test(name)) return { deptKeyword: dept };
  }
  // No known bureau alias — strip filler words and match department_ind_agency directly.
  const deptKeyword = name
    .replace(/\b(department|dept|of|the|agency|administration|us|u\.s\.|,)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { deptKeyword };
}

/** Back-compat: the parent-department keyword only. */
export function subAgencyToParent(name: string): string {
  return resolveAgency(name).deptKeyword;
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

  // Resolve the agency ONCE: its DoD office codes (DoDAAC) and its civilian
  // parent-department keyword + optional sub_tier narrow keyword.
  const agencyDodaacCodes = agency && !validDodaac
    ? (await dodaacCodesForAgency(agency)).filter(isValidDodaac).slice(0, 60)
    : [];
  const resolved = agency && !validDodaac && agencyDodaacCodes.length === 0 ? resolveAgency(agency) : null;
  let anchor: ContactRosterResult['anchor'] = search ? 'search' : 'none';
  if (validDodaac) anchor = 'dodaac';
  else if (agencyDodaacCodes.length > 0) anchor = 'agency-dodaac';
  else if (agency) anchor = 'department';

  // Build a fresh query each call so we can retry without sub_tier narrowing.
  const buildQuery = (applySubTier: boolean) => {
    let q = sb
      .from('federal_contacts')
      .select(
        'id, contact_fullname, contact_title, contact_email, contact_phone, department_ind_agency, office, sub_tier, role_category, solicitation_number',
        { count: 'exact' },
      )
      // GOVERNMENT decision makers only — mirror the app route. federal_contacts
      // also holds ~82K private-entity registrant rows (a company/foreign-NGO name
      // in sub_tier, NO federal agency, and ZERO with an email). They leaked into
      // a bare text search here (name surnames + junk); the app route already
      // excludes them. A real POC always has a department.
      .not('department_ind_agency', 'is', null);
    if (search) {
      // Mirror the app route's agency-aware search: name/title PLUS agency + the
      // sub_tier (bureau) column, so "forest" finds sub_tier "FOREST SERVICE" (the
      // real USDA Forest Service POCs), and acronyms resolve to their parent dept.
      const safe = search.replace(/[,()%]/g, ' ').trim();
      const parts = [
        `contact_fullname.ilike.%${safe}%`,
        `contact_title.ilike.%${safe}%`,
        `department_ind_agency.ilike.%${safe}%`,
        `sub_tier.ilike.%${safe}%`,
      ];
      for (const kw of agencySearchKeywords(safe)) parts.push(`department_ind_agency.ilike.%${kw}%`);
      q = q.or(parts.join(','));
    }
    if (validDodaac) {
      q = q.ilike('solicitation_number', `${validDodaac}%`);
    } else if (agencyDodaacCodes.length > 0) {
      q = q.or(agencyDodaacCodes.map((c) => `solicitation_number.ilike.${c}%`).join(','));
    } else if (agency && resolved) {
      const kw = resolved.deptKeyword;
      q = kw.length >= 3 ? q.ilike('department_ind_agency', `%${kw}%`) : q.ilike('department_ind_agency', `%${agency}%`);
      // Narrow the department roster to the specific bureau (Forest Service, IRS…).
      if (applySubTier && resolved.subTier) q = q.ilike('sub_tier', `%${resolved.subTier}%`);
    }
    if (office && !validDodaac) q = q.ilike('office', `%${office}%`);
    // NOTE: role is a SOFT filter applied in-memory below (the DB role_category column
    // is a uniform "contracting" tag; filtering on it here would zero-out every query).
    return q.order('posted_date', { ascending: false, nullsFirst: false }).range(0, limit * 4 - 1);
  };

  const wantNarrow = anchor === 'department' && !!resolved?.subTier;
  let { data, error, count } = await buildQuery(wantNarrow);
  let narrowedToBureau = wantNarrow;
  // Many civilian rows carry a null sub_tier — if the narrow found nothing, fall
  // back to the full department roster rather than returning empty.
  if (!error && wantNarrow && (!data || data.length === 0)) {
    ({ data, error, count } = await buildQuery(false));
    narrowedToBureau = false;
    trace.push(`sub_tier narrow "${resolved!.subTier}" empty → department fallback`);
  }
  if (agency && !trace.length) {
    trace.push(narrowedToBureau
      ? `narrowed to bureau via sub_tier "${resolved!.subTier}"`
      : anchor === 'agency-dodaac' ? `anchored on ${agencyDodaacCodes.length} dodaac code(s)`
      : `department preview on "${resolved?.deptKeyword || agency}"`);
  }
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

  // Soft role filter: prefer contacts whose title matches the requested role (by bucket
  // or title substring), but NEVER return empty on a role miss — fall back to the full
  // roster so "contracting officers at FEMA" still yields the office's people.
  if (role) {
    const wantBucket = roleQueryToBucket(role);
    const words = role.replace(/[_-]+/g, ' ').trim().toLowerCase();
    const matched = contacts.filter((c) => {
      // SAM POC rows often carry the role in the NAME ("Jane Doe, Contracting Officer")
      // while contact_title is just "Primary Contact" — search both.
      const hay = `${c.contact_fullname || ''} ${c.contact_title || ''}`;
      if (wantBucket && classifyRole(hay) === wantBucket) return true;
      return words.length >= 3 && hay.toLowerCase().includes(words);
    });
    if (matched.length > 0) {
      contacts = matched;
      trace.push(`role "${role}"${wantBucket ? ` → ${wantBucket}` : ''}: ${matched.length} match`);
    } else {
      trace.push(`role "${role}" matched 0 → full roster`);
    }
  }

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
