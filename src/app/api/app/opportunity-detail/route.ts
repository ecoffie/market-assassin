/**
 * GET /api/app/opportunity-detail?id=<notice_id> — the per-opportunity spine for the
 * Opportunity Map detail drawer. Returns ONE sam_opportunities row's useful fields (the raw
 * facts every detail section is built from). Section-specific enrichment (predecessor value,
 * capable contractors, agency intel, AI brief) is fetched by its own section, on demand.
 *
 * Public read of the same non-PII data the map already exposes; no auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setGroupKey, SET_LABEL, naicsCategory } from '@/lib/opportunities/map-data';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';

const COLS = 'notice_id, solicitation_number, title, description, seo_summary, naics_code, psc_code, '
  + 'department, sub_tier, office, agency_hierarchy, posted_date, response_deadline, last_modified, '
  + 'set_aside_code, set_aside_description, notice_type, active, pop_city, pop_state, pop_zip, pop_country, '
  + 'office_address, map_loc_source, ui_link, has_sow_doc, sow_doc_type, sow_filename, sow_text, '
  + 'attachments, points_of_contact, additional_info_link, additional_info_text, fair_opportunity, '
  + 'award_amount, award_date, awardee_name, awardee_uei';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shape(r: Record<string, any>) {
  const office = (r.office_address || null) as { city?: string; state?: string; zipcode?: string } | null;
  const popState = normalizeStateCode(r.pop_state || office?.state || '');
  const popCity = (r.pop_city || office?.city || '').trim();
  const setKey = setGroupKey(r.set_aside_code);
  // Points of contact — normalize to a consistent shape (SAM uses fullName/title/email/phone).
  const pocs = Array.isArray(r.points_of_contact) ? r.points_of_contact : [];
  const contacts = pocs.map((p: Record<string, unknown>) => ({
    name: (p.fullName as string) || (p.name as string) || '',
    title: (p.title as string) || '',
    email: (p.email as string) || '',
    phone: (p.phone as string) || '',
    type: (p.type as string) || '',
  })).filter((c: { name: string; email: string; phone: string }) => c.name || c.email || c.phone);

  return {
    id: String(r.notice_id ?? ''),
    solicitation: r.solicitation_number || '',
    title: r.title || 'Untitled opportunity',
    // synopsis: prefer the real SAM description body; fall back to the SEO summary.
    synopsis: (r.description || r.seo_summary || '').trim(),
    hasDescription: !!(r.description && String(r.description).trim()),
    naics: r.naics_code || '',
    psc: r.psc_code || '',
    category: naicsCategory(r.naics_code),
    department: r.department || '',
    subTier: r.sub_tier || '',
    office: r.office || '',
    noticeType: r.notice_type || '',
    setAside: setKey,
    setAsideLabel: r.set_aside_description || SET_LABEL[setKey],
    fairOpportunity: r.fair_opportunity || '',
    posted: r.posted_date || null,
    deadline: r.response_deadline || null,
    lastModified: r.last_modified || null,
    active: r.active === true,
    location: { city: popCity, state: popState, country: r.pop_country || '', source: r.map_loc_source === 'office' ? 'office' : 'pop' },
    officeLocation: office ? { city: office.city || '', state: office.state || '', zip: office.zipcode || '' } : null,
    uiLink: r.ui_link || '',
    // scope of work (section #5)
    sow: { has: !!r.has_sow_doc, type: r.sow_doc_type || '', filename: r.sow_filename || '', text: (r.sow_text || '').trim() },
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    additionalInfo: { link: r.additional_info_link || '', text: r.additional_info_text || '' },
    contacts,
    // award facts (if this notice is itself an award)
    award: r.award_amount ? { amount: Number(r.award_amount), date: r.award_date || null, awardee: r.awardee_name || '', uei: r.awardee_uei || '' } : null,
  };
}

export async function GET(request: NextRequest) {
  const id = (new URL(request.url).searchParams.get('id') || '').trim();
  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
  try {
    const { data, error } = await sb().from('sam_opportunities').select(COLS).eq('notice_id', id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    return NextResponse.json({ success: true, opp: shape(data) });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
