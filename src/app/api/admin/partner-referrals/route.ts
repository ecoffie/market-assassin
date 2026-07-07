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
  const { data: signups, error } = await supabase
    .from('user_notification_settings')
    .select(
      'user_email, created_at, updated_at, briefings_enabled, trial_ends_at, trial_source, invitation_source, alerts_enabled, is_active, naics_codes, paid_status',
    )
    .or(`invitation_source.eq.${program.invitationSource},trial_source.eq.${program.trialSource}`)
    .order('created_at', { ascending: false });

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
