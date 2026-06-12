import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getPartnerReferralByCode,
  getPartnerReferralBySlug,
  PARTNER_REFERRAL_PROGRAMS,
  partnerSignupUrls,
} from '@/lib/mindy/partner-referrals';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const codeParam = searchParams.get('code') || searchParams.get('slug') || 'NCMBC';
  const program = getPartnerReferralByCode(codeParam) || getPartnerReferralBySlug(codeParam);

  if (!program) {
    return NextResponse.json({
      programs: PARTNER_REFERRAL_PROGRAMS.map((p) => ({
        ...p,
        urls: partnerSignupUrls(p),
      })),
    });
  }

  const supabase = getSupabase();
  const { data: signups, error } = await supabase
    .from('user_notification_settings')
    .select(
      'user_email, created_at, updated_at, briefings_enabled, trial_ends_at, trial_source, invitation_source, alerts_enabled, is_active, naics_codes',
    )
    .or(`invitation_source.eq.${program.invitationSource},trial_source.eq.${program.trialSource}`)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const rows = signups || [];
  const activeTrial = rows.filter(
    (r) => r.trial_ends_at && new Date(r.trial_ends_at).getTime() > now,
  );

  return NextResponse.json({
    program: {
      ...program,
      urls: partnerSignupUrls(program),
    },
    summary: {
      totalTagged: rows.length,
      activeTrial: activeTrial.length,
      withAlerts: rows.filter((r) => r.alerts_enabled).length,
      withNaics: rows.filter((r) => (r.naics_codes || []).length > 0).length,
    },
    signups: rows,
  });
}
