/**
 * GET /api/app/opportunity-detail?id=<notice_id>
 *
 * Powers the Opportunity Map detail drawer (the Zillow "home details" equivalent).
 * Returns one opportunity shaped for the drawer's render(), PLUS:
 *  - bidFacts : a clean fact grid (set-aside, NAICS, PSC, deadline, agency/office, POP, docs, POC)
 *  - similar  : a few similar opportunities (same NAICS or agency, nearby) — the flywheel
 *
 * All fields are real columns from sam_opportunities. No fabrication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setGroupKey, SET_LABEL } from '@/lib/opportunities/map-data';
import { findPredecessorAward } from '@/lib/usaspending/find-predecessor';
import { getUnifiedAgencyIntelligence } from '@/lib/agency-intelligence';
import { getPricingIntel } from '@/mcp/tools/pricing-intel';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Reused-intelligence block for the drawer — runs the existing engines in PARALLEL and
// FAIL-SOFT (a slow/failed tool returns null, never blocks the drawer). Loaded on-demand
// via ?intel=1 so the base detail stays fast. Every field is real data from those tools.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildIntel(naics: string | null, agency: string | null, title: string | null) {
  const guard = <T>(p: Promise<T>): Promise<T | null> => p.then((v) => v).catch(() => null);
  // Agency intel matches on the CORE agency word ("DEPT OF DEFENSE" → "DEFENSE"); the raw
  // uppercase-comma form doesn't match the maintained list.
  const agencyKey = agency ? normalizeAgencyKey(agency) : '';
  const [predecessor, agencyIntel, pricing] = await Promise.all([
    guard(findPredecessorAward({ naicsCode: naics || undefined, agencyName: agency || undefined, keyword: title || undefined })),
    agencyKey ? guard(getUnifiedAgencyIntelligence(agencyKey)) : Promise.resolve(null),
    naics ? guard(getPricingIntel({ naics })) : Promise.resolve(null),
  ]);

  const fmt = (n?: number | null) => (typeof n === 'number' && n > 0)
    ? (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`) : null;

  // Field names validated against real tool output (see intel-probe).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pred = predecessor as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = agencyIntel as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pr = pricing as any;
  const topVendors = (pr && pr._meta?.grounded && pr.pricing?.topVendors) ? pr.pricing.topVendors : [];
  const asText = (x: unknown): string | null => (typeof x === 'string' ? x : (x && typeof x === 'object' ? ((x as Record<string, string>).text || (x as Record<string, string>).title || (x as Record<string, string>).description) : null)) || null;

  return {
    predecessor: (pred && pred.recipientName) ? {
      incumbent: pred.recipientName || null,
      incumbentState: pred.recipientState || null,
      value: fmt(pred.ceiling ?? pred.currentValue ?? pred.obligated),
      expires: (pred.popPotentialEnd || pred.popEnd) ? String(pred.popPotentialEnd || pred.popEnd).slice(0, 10) : null,
      vehicle: pred.parentIdvPiid || null,
      confidence: pred.matchConfidence || null,
    } : null,
    agency: ai ? {
      painPoints: (ai.painPoints || []).slice(0, 4).map(asText).filter(Boolean),
      priorities: (ai.priorities || []).slice(0, 3).map(asText).filter(Boolean),
    } : null,
    pricing: topVendors.length ? {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rates: topVendors.slice(0, 4).map((v: any) => ({
        labor_category: v.name,
        hourly_rate: (typeof v.avgRate === 'number') ? Math.round(v.avgRate) : null,
        size: v.businessSize || null,
      })),
      summary: `${pr.pricing.topVendors.length} vendors analyzed via GSA CALC`,
    } : null,
  };
}

const DETAIL_COLS = 'notice_id, solicitation_number, title, description, naics_code, psc_code, department, sub_tier, office, agency_hierarchy, posted_date, response_deadline, set_aside_code, set_aside_description, notice_type, pop_city, pop_state, pop_country, ui_link, attachments, points_of_contact, office_address, has_sow_doc, sow_text, sow_filename, additional_info_link, additional_info_text, map_loc_source';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeOpp(r: any) {
  const setKey = setGroupKey(r.set_aside_code);
  return {
    id: r.notice_id,
    solicitation: r.solicitation_number || r.notice_id,
    title: r.title,
    naics: r.naics_code,
    psc: r.psc_code,
    department: r.department,
    subTier: r.sub_tier,
    office: r.office || (r.office_address && r.office_address.city) || null,
    noticeType: r.notice_type,
    setAsideLabel: r.set_aside_description || (r.set_aside_code ? (SET_LABEL[setKey] || r.set_aside_code) : ''),
    deadline: r.response_deadline ? String(r.response_deadline).slice(0, 10) : null,
    posted: r.posted_date ? String(r.posted_date).slice(0, 10) : null,
    location: {
      city: r.pop_city || (r.office_address && r.office_address.city) || null,
      state: r.pop_state || (r.office_address && r.office_address.state) || null,
      country: r.pop_country || null,
      source: r.map_loc_source || (r.pop_state ? 'pop' : 'office'),
    },
    synopsis: r.description || null,
    sow: (r.sow_text ? { text: r.sow_text, filename: r.sow_filename || null } : null),
    contacts: Array.isArray(r.points_of_contact) ? r.points_of_contact : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    additionalInfo: (r.additional_info_link || r.additional_info_text)
      ? { link: r.additional_info_link || null, text: r.additional_info_text || null } : null,
    uiLink: r.ui_link || null,
  };
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

  const db = sb();
  // Match on notice_id first, then solicitation_number (cards may carry either).
  let { data, error } = await db.from('sam_opportunities').select(DETAIL_COLS).eq('notice_id', id).limit(1).maybeSingle();
  if (!data && !error) {
    ({ data, error } = await db.from('sam_opportunities').select(DETAIL_COLS).eq('solicitation_number', id).limit(1).maybeSingle());
  }
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });

  const opp = shapeOpp(data);

  // ?intel=1 → return ONLY the reused-intelligence block (predecessor/agency/pricing).
  // Loaded on-demand by the drawer as a SECOND fetch so the base detail stays instant.
  if (request.nextUrl.searchParams.get('intel') === '1') {
    const intel = await buildIntel(opp.naics, opp.department, opp.title);
    return NextResponse.json({ success: true, intel });
  }

  // Bid Facts — the "Facts & features" grid. All real columns.
  const bidFacts = [
    { k: 'Set-aside', v: opp.setAsideLabel || 'Open (unrestricted)' },
    { k: 'NAICS', v: opp.naics || '—' },
    { k: 'PSC', v: opp.psc || '—' },
    { k: 'Notice type', v: opp.noticeType || '—' },
    { k: 'Response due', v: opp.deadline || '—' },
    { k: 'Posted', v: opp.posted || '—' },
    { k: 'Agency', v: opp.department || '—' },
    { k: 'Sub-agency', v: opp.subTier || '—' },
    { k: 'Place of performance', v: [opp.location.city, opp.location.state || opp.location.country].filter(Boolean).join(', ') || '—' },
    { k: 'Documents', v: opp.attachments.length ? `${opp.attachments.length} attachment${opp.attachments.length > 1 ? 's' : ''}` : (data.has_sow_doc ? 'SOW on file' : 'None posted') },
    { k: 'Contacts', v: opp.contacts.length ? `${opp.contacts.length} listed` : 'None listed' },
    { k: 'Solicitation #', v: opp.solicitation || '—' },
  ];

  // Similar opportunities (the flywheel) — same NAICS 3-digit subsector OR same agency,
  // active, not this one, deadline soonest. Real opps only.
  const nowIso = new Date().toISOString();
  let simQ = db.from('sam_opportunities')
    .select('notice_id, title, department, naics_code, set_aside_code, response_deadline, pop_state, pop_city')
    .eq('active', true).gt('response_deadline', nowIso)
    .neq('notice_id', opp.id)
    .order('response_deadline', { ascending: true })
    .limit(6);
  if (opp.naics) simQ = simQ.like('naics_code', `${String(opp.naics).slice(0, 3)}%`);
  else if (opp.department) simQ = simQ.eq('department', opp.department);
  const { data: sim } = await simQ;
  const similar = (sim || []).slice(0, 5).map((s: Record<string, unknown>) => ({
    id: s.notice_id,
    title: s.title,
    agency: s.department,
    naics: s.naics_code,
    setAside: s.set_aside_description || (s.set_aside_code ? (SET_LABEL[setGroupKey(s.set_aside_code as string)] || s.set_aside_code) : ''),
    deadline: s.response_deadline ? String(s.response_deadline).slice(0, 10) : null,
    location: [s.pop_city, s.pop_state].filter(Boolean).join(', '),
  }));

  return NextResponse.json({ success: true, opp, bidFacts, similar });
}
