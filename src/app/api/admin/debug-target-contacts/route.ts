import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deriveSubAgency } from '@/lib/gov-contacts/derive-subagency';

/**
 * GET /api/admin/debug-target-contacts?password=...&email=...
 *
 * Support diagnostic: for each target in a user's list, show the agency it would
 * query and a SAMPLE of the contacts that come back (with their derived branch),
 * so we can SEE whether the contacts actually match the saved agency. Built to
 * verify the "contacts don't match my target list" fix. Service-role, read-only.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const AGENCY_TO_SUBAGENCY: Array<{ re: RegExp; label: string }> = [
  { re: /\bnavy\b|\bnaval\b|navfac|navsup|navsea|navair|navwar|\bnswc\b|\bnuwc\b|\bspawar\b/i, label: 'Navy' },
  { re: /marine corps/i, label: 'Marine Corps' },
  { re: /air force|\busaf\b|\bafmc\b/i, label: 'Air Force' },
  { re: /corps of engineers|\busace\b/i, label: 'Army Corps of Engineers' },
  { re: /\barmy\b/i, label: 'Army' },
  { re: /defense logistics|\bdla\b/i, label: 'Defense Logistics Agency' },
];
function expectedBranch(name: string): string | null {
  for (const m of AGENCY_TO_SUBAGENCY) if (m.re.test(name)) return m.label;
  return null;
}
function parentKeyword(agency: string): string {
  return agency.replace(/\b(department|dept|of|the|agency|administration|us|u\.s\.|,|command|center)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ').trim().split(/\s+/)[0] || agency;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const email = (request.nextUrl.searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: targets } = await supabase
    .from('user_target_list')
    .select('agency_name, sub_agency_name, office_name')
    .eq('user_email', email)
    .limit(20);

  const out: unknown[] = [];
  for (const t of targets || []) {
    const agency = String(t.agency_name || '');
    const branch = expectedBranch(agency);
    const kw = parentKeyword(agency);
    // Pull a sample the same way the route's broad filter would, ordered by recency.
    const { data: contacts } = await supabase
      .from('federal_contacts')
      .select('contact_fullname, contact_email, department_ind_agency, office')
      .ilike('department_ind_agency', `%${kw.length >= 3 ? kw : agency}%`)
      .order('posted_date', { ascending: false, nullsFirst: false })
      .limit(40);

    const sample = (contacts || []).map((c) => ({
      name: c.contact_fullname,
      email: c.contact_email,
      dept: c.department_ind_agency,
      derivedBranch: deriveSubAgency(c.contact_email, null),
    }));
    const matchingBranch = branch ? sample.filter((s) => s.derivedBranch === branch) : sample;

    out.push({
      target: { agency, subAgency: t.sub_agency_name, office: t.office_name },
      queriedKeyword: kw,
      expectedBranch: branch,
      totalPulled: sample.length,
      matchingBranchCount: matchingBranch.length,
      sampleAfterNarrow: matchingBranch.slice(0, 5),
      sampleRawFirst3: sample.slice(0, 3),
    });
  }

  return NextResponse.json({ success: true, email, targetCount: (targets || []).length, results: out });
}
