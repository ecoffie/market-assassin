/**
 * POST /api/app/market-report — generate a shareable market-research report from
 * the Opportunity Map search (the "Generate report" button).
 *
 * Market research on the map: the search already answers who's buying / who holds
 * it now / who to call, live. This route freezes that market into a client-ready
 * `/reports/<id>` deliverable — the link a user hands a client, and the flywheel
 * (reading is free/public, every respond action on it prompts sign-in).
 *
 * The engine already exists: `generateMarketReport` (src/mcp/tools/market-report.ts)
 * runs keyword-coverage → top-agencies → competition → recompetes → forecasts,
 * PERSISTS to `market_reports`, and hands back `deliverable.url`. This route is a
 * thin auth+gate wrapper — no report logic is reimplemented here.
 *
 * Pro-gated (Eric 2026-08-01): generating runs real USASpending compute, so it's a
 * Pro feature. Free tier gets a 402 teaser the UI renders as an upgrade wall.
 * READING a generated report stays free/public (that's /reports/<id>, ungated).
 *
 * Honest degradation (Eric 2026-08-01): generate ANYWAY when a source is thin — the
 * report renders the honest gap ("total market $ is thin for this keyword, run by
 * NAICS") rather than blocking the deliverable. Competition/recompetes/forecasts are
 * still grounded. We only 422 when NOTHING grounded (an empty report isn't a link).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { verifyMIAccess } from '@/lib/api-auth';
import { generateMarketReport } from '@/mcp/tools/market-report';
import { recordSearchAxes } from '@/lib/search-history';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // live USASpending + recompetes + forecasts

export async function POST(request: NextRequest) {
  let body: { keyword?: string; naics?: string; psc?: string; agency?: string; set_aside?: string; state?: string; client_name?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  const naics = typeof body.naics === 'string' ? body.naics.trim() : '';
  const psc = typeof body.psc === 'string' ? body.psc.trim() : '';
  const agency = typeof body.agency === 'string' ? body.agency.trim() : '';
  const setAside = typeof body.set_aside === 'string' ? body.set_aside.trim() : '';
  const state = typeof body.state === 'string' ? body.state.trim() : '';
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';

  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
  // A market needs at least one axis: keyword, NAICS, or PSC (Cybersecurity is PSC-only).
  if (!keyword && !naics && !psc) {
    return NextResponse.json({ success: false, error: 'keyword, naics, or psc required' }, { status: 400 });
  }

  // Auth gate: a real session for this email.
  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  // Tier gate: generating is Pro (real compute). Free tier → 402 teaser the UI
  // renders as the upgrade wall. Reading a report (/reports/<id>) stays free.
  const access = await verifyMIAccess(email);
  const isPro = access.tier === 'pro' || access.isStaff === true;
  if (!isPro) {
    return NextResponse.json(
      {
        success: false,
        teaser: true,
        error: 'Market reports are a Mindy Pro feature',
        upgrade_url: '/market-intelligence',
      },
      { status: 402 }
    );
  }

  // What did they actually look for? Logged per AXIS (keyword / naics / psc / agency /
  // set-aside / state), fire-and-forget, AFTER the tier gate so only real generations
  // count. This is the path that had ZERO keyword rows in user_search_history — the
  // blind spot that made an 18-keyword sample look like the whole picture.
  recordSearchAxes(email, 'market_report', {
    keyword: keyword || undefined,
    naics: naics || undefined,
    psc: psc || undefined,
    agency: agency || undefined,
    set_aside: setAside || undefined,
  }, { state: state || null, client_name: clientName || null });

  try {
    const report = await generateMarketReport({
      keyword: keyword || undefined,
      naics: naics || undefined,
      psc: psc || undefined,          // Cybersecurity is PSC-defined (DJ01/DJ10)
      agency: agency || undefined,    // scope the whole report to the saved agency
      set_aside: setAside || undefined,
      state: state || undefined,
      client_name: clientName || undefined,
      // The verified caller OWNS the saved report (never from args) — this is what
      // makes the engine persist + mint the /reports/<id> url.
      userEmail: email,
    });

    // Nothing grounded → not a deliverable worth a client link (honest miss).
    // A THIN axis (e.g. keyword market-size sparse) is NOT this case — the report
    // still grounds competition/recompetes/forecasts and renders the honest gap.
    if (!report.deliverable.url) {
      return NextResponse.json(
        {
          success: false,
          grounded: false,
          error:
            'No federal market data found for this search. Try a broader keyword, a 6-digit NAICS, or remove the state filter.',
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      url: report.deliverable.url,
      report_id: report.deliverable.report_id,
      subject: report.subject,
      summary: report.summary,
      // The UI surfaces the honest-gap note when an axis came back thin.
      degraded: report._meta?.degraded ?? false,
      sections_grounded: report._meta?.sections_grounded ?? null,
    });
  } catch (err) {
    console.error('[market-report] generate failed:', err);
    return NextResponse.json(
      { success: false, error: 'Report generation failed. Try again shortly.' },
      { status: 500 }
    );
  }
}
