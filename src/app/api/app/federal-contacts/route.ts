/**
 * GET /api/app/federal-contacts
 *
 * Browse the government decision-makers / contacts directory — the
 * federal_contacts table (~112K rows, synced daily from SAM POCs).
 * Search by name/title, filter by agency + office, sort. This is the
 * read-only directory; saving to CRM stays in /api/app/relationships.
 *
 * Params: email (auth), search, agency, office, role, limit, offset.
 * Special: ?facets=agencies → distinct agency list for the filter dropdown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getOfficesForAgency } from '@/lib/bigquery/agencies';
import { deriveSubAgency } from '@/lib/gov-contacts/derive-subagency';
import { decodeDodaac, expandOfficeName } from '@/lib/gov-contacts/dodaac';
import { loadDodaacNames } from '@/lib/gov-contacts/dodaac-directory';
import { getEnhancedAgencyInfo } from '@/lib/utils/command-info';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) {
    _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

// In-memory cache for the agency facet (~56 values, changes ~daily with the
// sync). Avoids re-scanning 112K rows on every panel mount.
let _agencyCache: { list: string[]; at: number } | null = null;
const AGENCY_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// SAM's contact "title" is messy: ~25% is the generic POC designation
// ("Primary Contact"), some is a real role ("Contracting Officer"), much is
// noise ("MR", "MRS", "GM", "NONE"). Be honest about which is which rather
// than presenting a POC label as a job title. Returns:
//   role        — a real job title, or null
//   pocLabel    — "Primary"/"Secondary" when the title is just the POC slot
// The UI shows the role when present, else the POC label as a muted hint.
const REAL_ROLE_RE = /(contracting officer|contract specialist|contracting specialist|program manager|program analyst|specialist|director|administrator|procurement|small business|osbp|chief|officer|analyst|manager|coordinator|liaison|buyer)/i;

// US state abbreviations — used to detect "CITY, ST" location strings that got
// mis-stored in the office column.
const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
// Words that signal a real CONTRACTING office (vs. a city/junk).
const OFFICE_WORDS = /\b(contracting|contract|acquisition|procurement|contr|cons|squadron|battalion|command|center|division|directorate|office|agency|activity|wing|installation|depot|arsenal|naval|army|air force|marine|garrison|district|region|district|logistics|systems|naysup|navsup|navfac|usace|dla|gsa|fisc|mcma)\b/i;

/**
 * Clean a raw `office` value (Eric QC: Decision Makers showed "CONSTANTA,
 * ROMANIA", "USPFO ACTIVITY MEANG 101" instead of a real office name). The SAM
 * POC `office` column is messy — frequently a foreign CITY or a bare base code.
 * Return a usable office string, or null if it's clearly junk (let the UI fall
 * back to the clean sub-agency).
 */
// Map a sub-agency/bureau to its PARENT department keyword (federal_contacts is
// keyed by parent). Returns null if no mapping (use the name as-is).
const SUBAGENCY_PARENT: Array<{ re: RegExp; parent: string }> = [
  { re: /land management|\bblm\b|national park|\bnps\b|fish (and|&) wildlife|\bfws\b|bureau of indian|reclamation|geological survey|\busgs\b|ocean energy|\bboem\b|surface mining|interior/i, parent: 'INTERIOR' },
  { re: /forest service|agricultural research|\bars\b|natural resources conservation|\bnrcs\b|rural development|farm service|food safety|animal (and|&) plant|\baphis\b|agriculture/i, parent: 'AGRICULTURE' },
  { re: /\barmy\b|\bnavy\b|air force|marine corps|defense logistics|\bdla\b|\busace\b|corps of engineers|navfac|navsup|defense health|missile defense|\bdod\b|defense/i, parent: 'DEFENSE' },
  { re: /customs (and|&) border|\bcbp\b|immigration|\bice\b|coast guard|\buscg\b|secret service|\bfema\b|cybersecurity|\bcisa\b|transportation security|\btsa\b|homeland/i, parent: 'HOMELAND SECURITY' },
  { re: /veterans health|veterans benefits|national cemetery|\bva\b|veterans affairs/i, parent: 'VETERANS AFFAIRS' },
  { re: /centers for medicare|\bcms\b|\bnih\b|national institutes|\bfda\b|food (and|&) drug|\bcdc\b|disease control|indian health|\bihs\b|health (and|&) human/i, parent: 'HEALTH AND HUMAN' },
  { re: /federal aviation|\bfaa\b|federal highway|\bfhwa\b|federal transit|maritime administration|transportation/i, parent: 'TRANSPORTATION' },
  { re: /internal revenue|\birs\b|\bmint\b|engraving (and|&) printing|comptroller|treasury/i, parent: 'TREASURY' },
];
function subAgencyToParent(name: string): string | null {
  for (const m of SUBAGENCY_PARENT) if (m.re.test(name)) return m.parent;
  return null;
}

// OVERSEAS markers (Eric: "why are offices in Japan/Europe in my list?"). A US
// small business won't bid on these — drop the contact entirely.
const FOREIGN_OFFICE_RE = /\b(yokosuka|okinawa|guam|sasebo|atsugi|japan|korea|seoul|osan|kunsan|europe|german|ramstein|kaiserslautern|italy|aviano|naples|sigonella|spain|rota|uk\b|united kingdom|england|raf\b|bahrain|qatar|kuwait|djibouti|far east|pacific command|africa command|european command|central command|overseas|apo\b|fpo\b)\b/i;

// Decode cryptic military org codes → readable names (Eric: "NAVSUP/USPFO mean
// nothing to a user"). Longest-match first.
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
    if (re.test(out)) { out = out.replace(re, full); break; } // expand the primary code
  }
  return out;
}

function cleanRawOffice(raw: string): string | null {
  const s = raw.trim().replace(/,\s*$/, '');
  if (s.length < 3) return null;
  if (FOREIGN_OFFICE_RE.test(s)) return null;               // overseas → drop (Eric)
  // Looks like an office? keep it (expand cryptic codes to readable names).
  if (OFFICE_WORDS.test(s)) return expandOfficeAcronyms(s);
  // "CITY, ST" or "CITY, FOREIGN PLACE" with no office words → it's a location.
  if (/,/.test(s) && !US_STATES.test(s)) return null;      // foreign city
  if (/,\s*[A-Z]{2}$/.test(s) && !OFFICE_WORDS.test(s)) return null; // US "CITY, ST" location
  // A single token that's all-caps and short with no office word → likely junk
  // (GIZA, HONDA, KAUNAS). Keep multi-word strings that might be real.
  if (!/\s/.test(s) && s === s.toUpperCase()) return null;
  return expandOfficeAcronyms(s);
}
const JUNK_TITLE_RE = /^(mr|mrs|ms|miss|dr|none|n\/a|na|gm|khan|rector|head of organization|business poc|government business poc|electronic business poc)\.?$/i;

// Classify a real role into a scannable category (Eric: "who to call for what").
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
  // Unknown but non-junk title — keep it as a role (could be a real one).
  const role = t.length <= 60 ? t : null;
  return { role, pocLabel: null, roleCategory: role ? classifyRole(role) : null };
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email');

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const sb = getSupabase();

  // Facets: distinct agency list for the filter dropdown.
  if (sp.get('facets') === 'agencies') {
    if (_agencyCache && Date.now() - _agencyCache.at < AGENCY_TTL_MS) {
      return NextResponse.json({ success: true, agencies: _agencyCache.list, cached: true });
    }
    // There are ~56 distinct agencies but they DON'T cluster in the first N
    // rows — the column is alphabetically ordered, so a single .limit(5000)
    // only ever saw the first 3 (bug 2026-06-04). We must page the WHOLE
    // column: NO early-exit, because one agency (DoD) spans many consecutive
    // pages, which would falsely look "done" before reaching later-alphabet
    // agencies. The 6h cache above makes this full scan a once-per-6h cost.
    const set = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; from < 120_000; from += PAGE) {
      const { data, error } = await sb
        .from('federal_contacts')
        .select('department_ind_agency')
        .not('department_ind_agency', 'is', null)
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data as { department_ind_agency: string }[]) {
        if (r.department_ind_agency) set.add(r.department_ind_agency);
      }
      if (data.length < PAGE) break;
    }
    const list = Array.from(set).sort();
    _agencyCache = { list, at: Date.now() };
    return NextResponse.json({ success: true, agencies: list });
  }

  // Facet: contracting OFFICES for an agency (drill-down DoD → NAVAIR /
  // NAVSEA / DLA …). SAM POC data has NO office for the real agencies, so we
  // read awards.awarding_office via the agency_office_summary BQ rollup
  // (top 100/agency by spend, ~MB cached). Returns rich offices with $ scale.
  if (sp.get('facets') === 'offices') {
    const facetAgency = (sp.get('agency') || '').trim();
    if (!facetAgency) return NextResponse.json({ success: true, offices: [] });
    try {
      const rows = await getOfficesForAgency(facetAgency, 100);
      // Return names for the dropdown, plus richer data the UI can show.
      return NextResponse.json({
        success: true,
        offices: rows.map(r => r.awarding_office),
        officeDetail: rows.map(r => ({ name: r.awarding_office, amount: r.total_amount, awards: r.award_count })),
      });
    } catch (e) {
      console.error('[federal-contacts] offices facet:', e);
      return NextResponse.json({ success: true, offices: [] });
    }
  }

  // Facet: derived SUB-AGENCIES present in a (broad) agency's CONTACTS — e.g.
  // DoD → Air Force / Navy / Army / DLA. SAM has no sub-agency field for these,
  // so we derive it from each contact's email domain / solicitation prefix and
  // tally which ones actually appear. Sampled (the big agencies have plenty).
  if (sp.get('facets') === 'subagencies') {
    const facetAgency = (sp.get('agency') || '').trim();
    if (!facetAgency) return NextResponse.json({ success: true, subAgencies: [] });
    const { data } = await sb
      .from('federal_contacts')
      .select('contact_email, solicitation_number')
      .ilike('department_ind_agency', `%${facetAgency}%`)
      .limit(5000);
    const counts = new Map<string, number>();
    for (const r of (data || []) as { contact_email: string | null; solicitation_number: string | null }[]) {
      const sa = deriveSubAgency(r.contact_email, r.solicitation_number);
      if (sa) counts.set(sa, (counts.get(sa) || 0) + 1);
    }
    const subAgencies = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    return NextResponse.json({ success: true, subAgencies });
  }

  const search = (sp.get('search') || '').trim();
  const agency = (sp.get('agency') || '').trim();
  const office = (sp.get('office') || '').trim();
  const role = (sp.get('role') || '').trim();
  const limit = Math.min(Number(sp.get('limit')) || 50, 200);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);

  const subAgency = (sp.get('subAgency') || '').trim();

  let q = sb
    .from('federal_contacts')
    .select(
      'id, contact_fullname, contact_title, contact_email, contact_phone, department_ind_agency, office, sub_tier, role_category, solicitation_number',
      { count: 'exact' },
    );

  if (search) {
    // name OR title match
    q = q.or(`contact_fullname.ilike.%${search}%,contact_title.ilike.%${search}%`);
  }
  if (agency) {
    // federal_contacts stores by PARENT department ("INTERIOR, DEPARTMENT OF"),
    // but a target may be a SUB-agency ("Bureau of Land Management" → 0 matches).
    // Map common sub-agencies to their parent keyword first.
    const parentKeyword = subAgencyToParent(agency);
    // Otherwise reconcile name formats: drop the generic "department of/the"
    // words and match on the distinctive keyword.
    const keyword = parentKeyword || agency
      .replace(/\b(department|dept|of|the|agency|administration|us|u\.s\.|,)\b/gi, ' ')
      .replace(/\s{2,}/g, ' ').trim();
    q = keyword.length >= 3
      ? q.ilike('department_ind_agency', `%${keyword}%`)
      : q.ilike('department_ind_agency', `%${agency}%`);
  }
  if (office) q = q.ilike('office', `%${office}%`);
  if (role) q = q.eq('role_category', role);
  // subAgency is DERIVED (from email domain / solicitation prefix), not a
  // column — so it's filtered in JS below. When set, pull a wider window so
  // the page still fills after filtering.
  const fetchLimit = subAgency ? Math.min(limit * 8, 1000) : limit;

  // Order by MOST RECENT posting (Eric: alphabetical-by-email made every result
  // start with "A" — useless). Recency surfaces active, relevant POCs + gives a
  // varied set, not the A-front. Reachable (has email) still preferred via the
  // posted_date sort landing real contacts first.
  q = q
    .order('posted_date', { ascending: false, nullsFirst: false })
    .range(offset, offset + fetchLimit - 1);

  const { data, error, count } = await q;
  if (error) {
    console.error('[federal-contacts]', error);
    return NextResponse.json({ success: false, error: 'Query failed' }, { status: 500 });
  }

  // The table has duplicate people (same person named on multiple
  // solicitations). Dedupe this page by email (fallback name+agency) so the
  // directory doesn't show the same contact 5 times.
  // Load the DoDAAC directory (code → office NAME) so users see
  // "10th Contracting Squadron", not "FA7000". Cached in-process.
  const dodaacNames = await loadDodaacNames();
  const seen = new Set<string>();
  let contacts = (data || []).filter((r: any) => {
    // Drop OVERSEAS contacts entirely (Eric: "why are Japan/Europe offices in my
    // list?") — a US small business won't bid these. Check office + email host.
    const hay = `${r.office || ''} ${r.sub_tier || ''} ${r.contact_email || ''}`;
    if (FOREIGN_OFFICE_RE.test(hay)) return false;
    const key = (r.contact_email || `${r.contact_fullname}|${r.department_ind_agency}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }).map((r: any) => {
    // Decode the DoDAAC from the solicitation number → the specific contracting
    // OFFICE (N00104 = NAVSUP WSS), fiscal year, and instrument type. This is
    // the office-level granularity SAM doesn't store (Eric 2026-06-05).
    const dod = decodeDodaac(r.solicitation_number);
    // Name resolution order: directory table > in-code map > raw code, then
    // expand terse military abbreviations ("87 CONS PK" → "87 Contracting
    // Squadron") so it reads like a name.
    const rawOffice = dod?.dodaac
      ? (dodaacNames.get(dod.dodaac) || dod.officeName || dod.dodaac)
      : null;
    let officeName = rawOffice ? expandOfficeName(rawOffice) : null;
    // Fallback: if no DoDAAC office, try the raw `office` column — but it's messy
    // SAM POC data (often a foreign CITY like "CONSTANTA, ROMANIA" or a bare
    // base code). Expand what we can; reject obvious junk so the UI shows the
    // clean sub-agency instead of garbage (Eric QC: office codes/cities showing).
    if (!officeName && r.office) {
      const cleaned = cleanRawOffice(String(r.office));
      if (cleaned) officeName = expandOfficeName(cleaned);
    }
    return {
      ...r,
      ...normalizeTitle(r.contact_title),
      // Derived command/branch within the broad parent agency (e.g. "Air Force"
      // under DEPT OF DEFENSE).
      subAgency: deriveSubAgency(r.contact_email, r.solicitation_number),
      derivedOffice: officeName,
      dodaac: dod?.dodaac || null,
      instrumentType: dod?.instrumentType || null,
    };
  });

  // SECOND-PASS foreign filter (QA caught: the overseas signal is in the
  // DoDAAC-DECODED office name "NAVSUP FLT LOG CTR YOKOSUKA" / "DISA/DITCO EUROPE",
  // which only exists AFTER the map — the raw r.office is null. Drop them here.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contacts = contacts.filter((c: any) => !FOREIGN_OFFICE_RE.test(c.derivedOffice || ''));

  // Filter by derived sub-agency (JS, since it's not a column).
  if (subAgency) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contacts = contacts.filter((c: any) => c.subAgency === subAgency).slice(0, limit);
  }

  // OSBP / Small-Business office (Eric: OSBP was a SEPARATE source — the
  // command-info directory, NOT federal_contacts). Prepend the agency's
  // small-business contact so the user gets the OSBP person, not just KOs.
  if (agency) {
    const osbp = getEnhancedAgencyInfo(agency, agency, agency).smallBusinessContact;
    if (osbp?.director && osbp.director !== `${agency} OSBP Director`) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (contacts as any[]).unshift({
        id: `osbp:${agency}`,
        contact_fullname: osbp.director,
        contact_title: osbp.name || 'Office of Small Business Programs',
        contact_email: osbp.email || null,
        contact_phone: osbp.phone || null,
        role_category: 'small_business',
        role: 'OSBP',
        roleCategory: 'Small Business',
        derivedOffice: osbp.name || null,
        sub_tier: null,
      });
    }
  }

  return NextResponse.json({
    success: true,
    total: count ?? contacts.length, // pre-dedupe total (approx; for "X of N")
    count: contacts.length,
    offset,
    limit,
    contacts,
  });
}
