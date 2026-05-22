/**
 * GET /api/app/pricing-intel?naics=541512
 *
 * Lightweight pricing intelligence endpoint for the new Estimating
 * section. Wraps the existing fetchPricingIntel() helper so the
 * PricingIntelPanel doesn't have to call the full /api/reports/
 * generate-all (which generates 10 reports and takes 60+ seconds).
 *
 * Pro-gated via verifyMIAccess. Free users get 402 with an upgrade
 * payload matching the Mindy Analyst pattern (c9004f4).
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchPricingIntel } from '@/lib/utils/calc-rates';
import { verifyMIAccess } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const naics = url.searchParams.get('naics');

  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }
  if (!naics) {
    return NextResponse.json({ error: 'naics parameter required' }, { status: 400 });
  }

  // Pro gate. verifyMIAccess returns { tier, email, isStaff, ... } —
  // free users see a 402 upgrade teaser matching the Mindy Analyst
  // pattern (c9004f4). Staff bypass the tier check.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      {
        upgrade_required: true,
        message: 'Pricing Intel is included with Mindy Pro',
        teaser: {
          sample_categories: ['Senior Engineer', 'Project Manager', 'Cybersecurity Analyst'],
          note: 'Pro shows full labor category breakdown, GSA vs commercial rate spread, and price-to-win guidance.',
        },
      },
      { status: 402 }
    );
  }

  try {
    const data = await fetchPricingIntel(naics);
    if (!data || data.laborCategories.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'No pricing data found for this NAICS code. Try a broader or sibling code (e.g. 541512 → 541511).',
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/app/pricing-intel] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
