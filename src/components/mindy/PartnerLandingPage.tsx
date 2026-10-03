'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { getPartnerReferralBySlug, type PartnerReferralProgram } from '@/lib/mindy/partner-referrals';
import { storePartnerRef } from '@/lib/mindy/partner-referral-client';

interface PartnerLandingPageProps {
  slug: string;
}

export function PartnerLandingPage({ slug }: PartnerLandingPageProps) {
  const program = getPartnerReferralBySlug(slug);

  useEffect(() => {
    if (program) storePartnerRef(program.code);
  }, [program]);

  if (!program) {
    return (
      <main className="flex items-center justify-center px-6 py-24 text-(--mp-ink)">
        <p className="text-(--mp-muted)">Partner program not found.</p>
      </main>
    );
  }

  const appSignup = `/app/signup?ref=${program.code}`;
  const alertsSignup = `/alerts/signup?ref=${program.code}`;

  return (
    <main className="text-(--mp-ink)">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="text-center mb-10">
          <MindyLogo size={56} className="mx-auto mb-4" />
          <p className="text-(--mp-accent) text-xs font-bold tracking-[0.18em] uppercase mb-2">
            {program.name} Partner Offer
          </p>
          <h1 className="font-(family-name:--mp-font-serif) text-3xl md:text-4xl font-bold mb-4 text-(--mp-ink)">
            {program.trialDays} days of Mindy Pro — free for {program.name} contractors
          </h1>
          <p className="text-(--mp-body) text-lg leading-relaxed max-w-2xl mx-auto">
            Keyword-matched federal alerts, market research, recompete intelligence, and Proposal Assist —
            grounded in real SAM.gov and USASpending data.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-10">
          <Link
            href={appSignup}
            className="block bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white transition-colors p-6 text-center font-semibold"
          >
            Create Mindy account
            <span className="block text-white text-sm font-normal mt-2">
              Full platform · {program.trialDays}-day Pro trial
            </span>
          </Link>
          <Link
            href={alertsSignup}
            className="block border border-(--mp-line) bg-(--mp-surface) text-(--mp-ink) hover:border-(--mp-ink) hover:bg-(--mp-wash) transition-colors p-6 text-center font-semibold"
          >
            Start with free alerts
            <span className="block text-(--mp-muted) text-sm font-normal mt-2">
              Daily SAM.gov matches · upgrade anytime
            </span>
          </Link>
        </div>

        <div className="border border-(--mp-line) bg-(--mp-wash) p-5 text-sm text-(--mp-muted)">
          <p className="mb-2">
            <strong className="text-(--mp-ink)">Partner code:</strong> {program.code}
          </p>
          <p className="mb-2">{program.description}</p>
          <p>
            Signups through this page are tagged for {program.name} so we can measure results and support your contractor base.
          </p>
        </div>
      </div>
    </main>
  );
}

export function getPartnerProgramForSlug(slug: string): PartnerReferralProgram | null {
  return getPartnerReferralBySlug(slug);
}
