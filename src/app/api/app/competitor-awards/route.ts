/**
 * /api/app/competitor-awards — recent federal awards for a competitor.
 *
 * Competitor Intel showed a list of primes with no intel on what they've
 * actually won. This surfaces "what they won recently" using the SAME
 * BigQuery recipient engine that powers the /contractors SEO pages — so
 * we reuse the data (and its 30-day cache) we already built, instead of
 * a redundant live USASpending call.
 *
 * Flow: competitor name → recipientSlug() → getRecipientBySlug() (UEI +
 * totals) → getRecentAwardsForRecipient() + getTopAgenciesForRecipient().
 *
 * GET ?email=&name=<competitor name>
 *   → { success, recipient: {...}, awards: [...], topAgencies: [...] }
 *
 * Pro-gated. BQ queries are cached; if the BQ daily quota is exhausted,
 * queryCached degrades gracefully (serves stale cache or empty) so this
 * never 500s.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyMIAccess } from '@/lib/api-auth';
import {
  recipientSlug,
  getRollupBySlug,
  getRecentAwardsForRecipient,
  getTopAgenciesForRecipient,
} from '@/lib/bigquery/recipients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const email = (request.nextUrl.searchParams.get('email') || '').trim();
  const name = (request.nextUrl.searchParams.get('name') || '').trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      { upgrade_required: true, message: 'Competitor award history is included with Mindy Pro' },
      { status: 402 },
    );
  }

  try {
    const slug = recipientSlug(name);
    const recipient = await getRollupBySlug(slug, true); // liveBq: authed Mindy
    if (!recipient) {
      // Not found in the federal-awards dataset (or BQ quota degraded to
      // empty). Honest empty response — the UI shows "no award history".
      return NextResponse.json({ success: true, found: false, awards: [], topAgencies: [] });
    }

    // Parent-rollup competitor view: aggregate across the org's whole UEI set.
    const [awards, topAgencies] = await Promise.all([
      getRecentAwardsForRecipient(recipient.child_ueis, recipient.rollup_uei, 8, true), // liveBq
      getTopAgenciesForRecipient(recipient.child_ueis, recipient.rollup_uei, 5, true), // liveBq
    ]);

    return NextResponse.json({
      success: true,
      found: true,
      recipient: {
        name: recipient.rollup_name,
        uei: recipient.rollup_uei,
        slug,
        totalObligated: recipient.total_obligated,
        awardCount: recipient.award_count,
        distinctAgencyCount: recipient.distinct_agency_count,
        lastActionDate: recipient.last_action_date,
      },
      awards: awards.map(a => ({
        awardId: a.award_id,
        description: (a.description || '').slice(0, 200),
        amount: a.obligation_amount,
        agency: a.awarding_agency || a.awarding_office || '',
        naicsCode: a.naics_code || '',
        naicsDescription: a.naics_description || '',
        actionDate: a.action_date,
        popEndDate: a.pop_end_date,
      })),
      topAgencies: topAgencies.map(t => ({
        agency: t.awarding_agency,
        amount: t.total_amount,
        pctOfTotal: t.pct_of_total,
      })),
    });
  } catch (err) {
    console.error('[competitor-awards] failed:', err);
    return NextResponse.json({ success: true, found: false, awards: [], topAgencies: [] });
  }
}
