/**
 * GET /api/app/buyer-detail?id=<federal_contacts.id>&email=<email>
 *
 * The ONE-CALL feed for the Opportunity Map Gov Buyer drawer (Gov Buyers dataset).
 * Mirrors /api/app/company-detail (companies) and /api/app/opportunity-detail (opps):
 * the drawer JS fetches this once and renders every section (the opportunities this
 * POC runs, their office/agency intel, the office roster, contact info) from the
 * response.
 *
 * MI-token authed — the same gate as /api/app/contacts-map (the Gov Buyers map is a
 * signed-in feature). Returns { success, buyer } or an honest 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getBuyerDetail } from '@/lib/gov-contacts/buyer-detail';
import { computeBuyerBehavior } from '@/lib/opportunities/buyer-behavior';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const email = (p.get('email') || '').trim().toLowerCase();

  const auth = requireMIAuthSession(request, email || null);
  if (!auth.ok) return auth.response;

  const id = (p.get('id') || '').trim();
  if (!id) {
    return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
  }

  try {
    const buyer = await getBuyerDetail(id);
    if (!buyer) {
      return NextResponse.json({ success: false, error: 'Buyer not found' }, { status: 404 });
    }
    // "How this buyer buys" (GOS #11) — the agency's contract_type mix as a small-business-fit signal.
    // Keyed on the DISPLAY agency ("Department of Defense") which is how recompete_opportunities stores
    // awarding_agency/sub_agency. Fail-soft: grounded:false → the drawer shows an honest placeholder.
    const behavior = await computeBuyerBehavior(buyer.agency);
    return NextResponse.json({ success: true, buyer: { ...buyer, behavior: behavior.grounded ? behavior : null } });
  } catch (e) {
    console.error('[buyer-detail] error:', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
