import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { getAffiliatePartnerTotals } from '@/lib/mindy/affiliate-commissions';
import {
  DEFAULT_AFFILIATE_PERCENT,
  formatCentsUsd,
  getPartnerReferralByCode,
  getPartnerReferralBySlug,
  PARTNER_REFERRAL_PROGRAMS,
  partnerSignupUrls,
} from '@/lib/mindy/partner-referrals';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function getSupabase() {
  // Pure read-only analytics (GET, no writes) → read replica to keep off the primary.
  return getReadClient();
}


/** Paginated read — PostgREST caps responses at 1,000 rows silently. See docs/engineering/postgrest-1000-row-cap.md */
async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error };
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return { data: out, error: null };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const codeParam = searchParams.get('code') || searchParams.get('slug');
  const program = codeParam
    ? (getPartnerReferralByCode(codeParam) || getPartnerReferralBySlug(codeParam))
    : null;

  if (!program) {
    const programs = await Promise.all(
      PARTNER_REFERRAL_PROGRAMS.map(async (p) => {
        const affiliate = await getAffiliatePartnerTotals(p);
        return {
          ...p,
          urls: partnerSignupUrls(p),
          affiliate: {
            ...affiliate,
            grossFormatted: formatCentsUsd(affiliate.grossCents),
            commissionFormatted: formatCentsUsd(affiliate.commissionCents),
            monthlyRunRateFormatted: formatCentsUsd(affiliate.monthlyCommissionRunRateCents),
            affiliatePer149SubFormatted: formatCentsUsd(
              Math.round(14900 * p.affiliatePercent / 100),
            ),
            yourNetPer149SubFormatted: formatCentsUsd(
              Math.round(14900 * (100 - p.affiliatePercent) / 100),
            ),
          },
        };
      }),
    );

    return NextResponse.json({
      defaultAffiliatePercent: DEFAULT_AFFILIATE_PERCENT,
      programs,
    });
  }

  const supabase = getSupabase();
  // Every figure below (totalTagged, activeTrial, paidConversions, conversion rate)
  // is a COUNT of this read — an unpaginated fetch would cap a successful partner
  // program at exactly 1,000 referrals and understate its conversion denominator.
  const { data: signups, error } = await readAllRows<{
    user_email: string; created_at: string; updated_at: string | null;
    briefings_enabled: boolean | null; trial_ends_at: string | null;
    trial_source: string | null; invitation_source: string | null;
    alerts_enabled: boolean | null; is_active: boolean | null;
    naics_codes: string[] | null; paid_status: boolean | null;
  }>((from, to) => supabase
    .from('user_notification_settings')
    .select(
      'user_email, created_at, updated_at, briefings_enabled, trial_ends_at, trial_source, invitation_source, alerts_enabled, is_active, naics_codes, paid_status',
    )
    .or(`invitation_source.eq.${program.invitationSource},trial_source.eq.${program.trialSource}`)
    .order('created_at', { ascending: false })
    .range(from, to));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const affiliate = await getAffiliatePartnerTotals(program);
  const now = Date.now();
  const rows = signups || [];
  const activeTrial = rows.filter(
    (r) => r.trial_ends_at && new Date(r.trial_ends_at).getTime() > now,
  );
  const paidConversions = rows.filter((r) => r.paid_status === true).length;

  return NextResponse.json({
    defaultAffiliatePercent: DEFAULT_AFFILIATE_PERCENT,
    program: {
      ...program,
      urls: partnerSignupUrls(program),
      affiliate: {
        ...affiliate,
        grossFormatted: formatCentsUsd(affiliate.grossCents),
        commissionFormatted: formatCentsUsd(affiliate.commissionCents),
        monthlyRunRateFormatted: formatCentsUsd(affiliate.monthlyCommissionRunRateCents),
        yourNetPer149SubFormatted: formatCentsUsd(
          Math.round(14900 * (100 - program.affiliatePercent) / 100),
        ),
        affiliatePer149SubFormatted: formatCentsUsd(
          Math.round(14900 * program.affiliatePercent / 100),
        ),
      },
    },
    summary: {
      totalTagged: rows.length,
      activeTrial: activeTrial.length,
      withAlerts: rows.filter((r) => r.alerts_enabled).length,
      withNaics: rows.filter((r) => (r.naics_codes || []).length > 0).length,
      paidConversions,
      affiliatePayingCustomers: affiliate.payingCustomers,
      affiliateCommissionOwed: formatCentsUsd(affiliate.commissionCents),
      affiliateMonthlyRunRate: formatCentsUsd(affiliate.monthlyCommissionRunRateCents),
    },
    signups: rows,
  });
}
