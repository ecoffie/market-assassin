/**
 * Recompete (Awarded) detail intel — the on-demand second fetch for the Awarded drawer,
 * mirroring `opportunity-detail?intel=1` for open opps and `recompete-task-orders` for the
 * task-order stream.
 *
 * COMPOUND (GOS #9): the Awarded drawer REPLICATES the opp drawer's market-intelligence
 * sections (agency intel + pricing) and modifies content for an AWARDED contract. The recompete
 * row already carries the incumbent + real contract value + expiry, so this endpoint supplies
 * ONLY the two sections the row does NOT carry:
 *   - `agency`  → agency priorities + pain points   (getUnifiedAgencyIntelligence, keyed on agency)
 *   - `pricing` → what vendors charge here           (getPricingIntel, keyed on NAICS)
 * We DELIBERATELY do not return `valueRange`/`predecessor` here — the recompete has a REAL
 * contract value + a known incumbent already, so an M-Estimate value range would be redundant
 * (justified N/A per GOS #9c). The BD roster ("other contacts at this agency") is loaded
 * client-side by the shared `loadRoster()` (same as the open-opp drawer), not here.
 *
 * Reuses the SAME `buildOppIntel()` engine the opp drawer uses — no new intel machinery — and
 * simply drops the two contract-specific sections on the client. Fail-soft per section (a slow
 * or empty tool yields that section null; the drawer collapses it silently).
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildOppIntel } from '@/lib/opportunities/opp-intel';
import { computeBuyerBehavior } from '@/lib/opportunities/buyer-behavior';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const naics = (p.get('naics') || '').trim() || null;
  const agency = (p.get('agency') || '').trim() || null;
  const title = (p.get('title') || '').trim() || null;

  // Nothing to key on → an honest empty intel (drawer collapses the sections), not an error.
  if (!naics && !agency) {
    return NextResponse.json({ success: true, intel: { agency: null, pricing: null, behavior: null } });
  }

  try {
    // buildOppIntel returns { predecessor, agency, pricing, valueRange }. The Awarded drawer only
    // wants agency + pricing — the incumbent + contract value are already on the row in hand, so
    // predecessor/valueRange are dropped here (GOS #9c: consciously N/A for an awarded contract).
    // `behavior` = "How this buyer buys" (GOS #11) — the agency's contract_type mix as a small-business
    // -fit signal (PO=SAP-friendly, delivery-order=vehicle-gated). Computed in parallel, fail-soft.
    const [intel, behavior] = await Promise.all([
      // estimate:false — a recompete carries its OWN real contract value; the DERIVED M-Estimate
      // (predecessor + comparable band) is open-opps-only (Eric 2026-08-03) and its predecessor
      // inference is the wrong-value bug class. This drawer only wants agency + pricing.
      buildOppIntel(naics, agency, title, 14000, null, null, { estimate: false }),
      computeBuyerBehavior(agency, naics),
    ]);
    return NextResponse.json({
      success: true,
      intel: {
        agency: intel.agency || null,
        pricing: intel.pricing || null,
        behavior: behavior.grounded ? behavior : null,
      },
    });
  } catch (err) {
    // Fail-soft: surface nothing rather than a 500 — the drawer's ceiling/incumbent/task-order
    // sections are still fully rendered from the row in hand.
    console.error('[recompete-detail] intel build failed:', err);
    return NextResponse.json({ success: true, intel: { agency: null, pricing: null, behavior: null } });
  }
}
