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
const JUNK_TITLE_RE = /^(mr|mrs|ms|miss|dr|none|n\/a|na|gm|khan|rector|head of organization|business poc|government business poc|electronic business poc)\.?$/i;

function normalizeTitle(title: string | null): { role: string | null; pocLabel: string | null } {
  const t = (title || '').trim();
  if (!t) return { role: null, pocLabel: null };
  const pocMatch = /^(primary|secondary)\s+contact$/i.exec(t);
  if (pocMatch) return { role: null, pocLabel: pocMatch[1][0].toUpperCase() + pocMatch[1].slice(1).toLowerCase() };
  if (JUNK_TITLE_RE.test(t)) return { role: null, pocLabel: null };
  if (REAL_ROLE_RE.test(t)) return { role: t, pocLabel: null };
  // Unknown but non-junk title — keep it as a role (could be a real one).
  return { role: t.length <= 60 ? t : null, pocLabel: null };
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
  if (agency) q = q.ilike('department_ind_agency', `%${agency}%`);
  if (office) q = q.ilike('office', `%${office}%`);
  if (role) q = q.eq('role_category', role);
  // subAgency is DERIVED (from email domain / solicitation prefix), not a
  // column — so it's filtered in JS below. When set, pull a wider window so
  // the page still fills after filtering.
  const fetchLimit = subAgency ? Math.min(limit * 8, 1000) : limit;

  // Surface contacts that are actually reachable first (have email/phone),
  // then alphabetical by agency so the directory reads cleanly.
  q = q
    .order('contact_email', { ascending: true, nullsFirst: false })
    .order('department_ind_agency', { ascending: true })
    .range(offset, offset + fetchLimit - 1);

  const { data, error, count } = await q;
  if (error) {
    console.error('[federal-contacts]', error);
    return NextResponse.json({ success: false, error: 'Query failed' }, { status: 500 });
  }

  // The table has duplicate people (same person named on multiple
  // solicitations). Dedupe this page by email (fallback name+agency) so the
  // directory doesn't show the same contact 5 times.
  const seen = new Set<string>();
  let contacts = (data || []).filter((r: any) => {
    const key = (r.contact_email || `${r.contact_fullname}|${r.department_ind_agency}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }).map((r: any) => ({
    ...r,
    ...normalizeTitle(r.contact_title),
    // Derived command/branch within the broad parent agency (e.g. "Air Force"
    // under DEPT OF DEFENSE). Lets the UI narrow huge agencies.
    subAgency: deriveSubAgency(r.contact_email, r.solicitation_number),
  }));

  // Filter by derived sub-agency (JS, since it's not a column).
  if (subAgency) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contacts = contacts.filter((c: any) => c.subAgency === subAgency).slice(0, limit);
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
