'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { getPartnerReferralBySlug } from '@/lib/mindy/partner-referrals';
import { storePartnerRef } from '@/lib/mindy/partner-referral-client';

const PROGRAM = getPartnerReferralBySlug('ncmbc')!;
const APP_SIGNUP = `/app/signup?ref=${PROGRAM.code}`;
const ALERTS_SIGNUP = `/alerts/signup?ref=${PROGRAM.code}`;

export default function NcmbcPartnerPage() {
  useEffect(() => {
    storePartnerRef(PROGRAM.code);
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="text-center mb-10">
          <MindyLogo size={56} className="mx-auto mb-4" />
          <p className="text-violet-300 text-sm font-semibold tracking-wide uppercase mb-2">
            NCMBC Partner Offer
          </p>
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            30 days of Mindy Pro — free for NCMBC contractors
          </h1>
          <p className="text-slate-300 text-lg leading-relaxed max-w-2xl mx-auto">
            Keyword-matched federal alerts, market research, recompete intelligence, and Proposal Assist —
            grounded in real SAM.gov and USASpending data.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-10">
          <Link
            href={APP_SIGNUP}
            className="block rounded-2xl bg-violet-600 hover:bg-violet-500 transition-colors p-6 text-center font-semibold"
          >
            Create Mindy account
            <span className="block text-violet-200 text-sm font-normal mt-2">Full platform · 30-day Pro trial</span>
          </Link>
          <Link
            href={ALERTS_SIGNUP}
            className="block rounded-2xl border border-slate-700 hover:border-violet-500 transition-colors p-6 text-center font-semibold"
          >
            Start with free alerts
            <span className="block text-slate-400 text-sm font-normal mt-2">Daily SAM.gov matches · upgrade anytime</span>
          </Link>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          <p className="mb-2">
            <strong className="text-slate-200">Partner code:</strong> {PROGRAM.code}
          </p>
          <p>
            Signups through this page are tagged for NCMBC so we can measure results and support your contractor base.
          </p>
        </div>
      </div>
    </main>
  );
}
