/**
 * GET /api/gov-buyer/supplier-activation
 *
 * The reach gap and the supplier outreach list — PRD §5, the Gold Coast bridge.
 * Market Research proves the market exists; this helps the buyer activate it.
 *
 * Query:
 *   email    required — gov_buyer email (session-verified)
 *   naics    required
 *   state, setAside, agency, keyword — scope, same semantics as the sibling routes
 *   format   'json' (default) | 'csv'
 *   onlyNew  'true' to restrict the CSV to firms not in the sampled award record
 *
 * Auth: gov_buyer only (requireGovBuyer).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireGovBuyer } from '@/lib/gov-buyer/auth';
import { runMarketResearch } from '@/lib/gov-buyer/market-research';
import { getProcurementHistory, type ProcurementHistory } from '@/lib/gov-buyer/acquisition-context';
import { buildSupplierActivation, activationToCsv } from '@/lib/gov-buyer/supplier-activation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email');
  const naics = sp.get('naics');

  const auth = await requireGovBuyer(request, email);
  if (!auth.ok) return auth.response;
  if (!naics) {
    return NextResponse.json({ success: false, error: 'naics is required' }, { status: 400 });
  }

  const state = sp.get('state') || undefined;
  const setAside = sp.get('setAside') || undefined;
  const agency = sp.get('agency') || undefined;
  const keyword = sp.get('keyword') || undefined;
  const format = (sp.get('format') || 'json').toLowerCase();

  try {
    // The pool and the award record are independent reads. A history failure
    // must not fail the whole request — it degrades the reach gap to
    // "not computable", which the caveat then states plainly.
    const [research, history] = await Promise.all([
      runMarketResearch({ naics, state, setAside, limit: 500 }),
      getProcurementHistory({ naics, agency, state, keyword, limit: 100 })
        .catch((): ProcurementHistory | null => null),
    ]);

    const activation = buildSupplierActivation({
      research, history, naics, officeLabel: agency,
    });

    if (format === 'csv') {
      const scope = [
        `NAICS ${naics}`,
        agency || null,
        state ? state.toUpperCase() : 'nationwide',
        setAside || 'all small businesses',
      ].filter(Boolean).join(' · ');

      const csv = activationToCsv({
        activation, naics, scope,
        preparedBy: auth.email,
        onlyNotInSample: sp.get('onlyNew') === 'true',
      });
      const file = `Supplier_Outreach_${naics}${state ? '_' + state.toUpperCase() : ''}.csv`;
      return new NextResponse(csv, {
        headers: {
          // BOM so Excel reads UTF-8 correctly on open.
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file}"`,
        },
      });
    }

    return NextResponse.json({ success: true, ...activation });
  } catch (err) {
    console.error('[gov-buyer/supplier-activation]', err);
    return NextResponse.json(
      { success: false, error: 'Supplier activation query failed' },
      { status: 500 },
    );
  }
}
