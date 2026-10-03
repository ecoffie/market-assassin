import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Referral Program & Credits Terms — Mindy',
  description: 'Terms for the Mindy MCP referral program and credits.',
};

export default function ReferralTerms() {
  return (
    <main className="min-h-dvh bg-(--mp-paper) text-(--mp-ink)">
      <div className="mx-auto max-w-2xl px-5 py-12 sm:px-6">
        <h1 className="text-2xl font-bold font-(family-name:--mp-font-serif)">Referral Program &amp; Credits Terms</h1>
        <p className="mt-2 text-[13px] text-(--mp-muted)">
          These are program terms referenced from the Mindy Terms of Service. They do not replace our
          Privacy Policy or Terms of Service, which continue to govern.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-(--mp-ink) font-(family-name:--mp-font-serif)">Referral Program</h2>
        <dl className="mt-3 space-y-3 text-[14px] leading-relaxed text-(--mp-body)">
          <div><dt className="font-semibold text-(--mp-ink)">Eligibility.</dt><dd>Any Mindy account holder may refer others using their personal referral link. The program is for genuine referrals of new users only.</dd></div>
          <div><dt className="font-semibold text-(--mp-ink)">The reward.</dt><dd>When a person you refer creates a Mindy account and completes their first verified sign-in (via OAuth — Google/Microsoft/Apple — or multi-factor authentication), you and your referred friend each receive 100 Mindy MCP credits.</dd></div>
          <div><dt className="font-semibold text-(--mp-ink)">Qualifying rules.</dt><dd>The reward is granted only after a verified authenticated session; an unverified email signup alone does not qualify. A referred person can generate only one referral reward, ever (first referrer wins). Self-referral is not permitted. Each referrer may earn rewards for up to 25 referred users.</dd></div>
          <div><dt className="font-semibold text-(--mp-ink)">No cash value.</dt><dd>Referral credits have no cash value, are non-transferable, are not redeemable for money, and may expire.</dd></div>
          <div><dt className="font-semibold text-(--mp-ink)">Fraud &amp; revocation.</dt><dd>Mindy may withhold, reverse, or revoke referral credits and suspend participation where it detects fraud, abuse, self-dealing, fake or duplicate accounts, automated signups, or attempts to circumvent these rules. Mindy may modify or end the program, or change the reward or cap, at any time, with prospective effect.</dd></div>
        </dl>

        <h2 className="mt-8 text-lg font-semibold text-(--mp-ink) font-(family-name:--mp-font-serif)">Credits</h2>
        <dl className="mt-3 space-y-3 text-[14px] leading-relaxed text-(--mp-body)">
          <div><dt className="font-semibold text-(--mp-ink)">What credits are.</dt><dd>Mindy MCP credits are a prepaid unit of access used to run metered tools. They are debited only when a tool call succeeds.</dd></div>
          <div><dt className="font-semibold text-(--mp-ink)">No cash value.</dt><dd>Credits have no cash value, are non-transferable and non-refundable except as required by law, cannot be redeemed for money, and confer no ownership or property right.</dd></div>
          <div><dt className="font-semibold text-(--mp-ink)">Grants &amp; expiry.</dt><dd>Credits may be granted by purchase, subscription allowance, promotion, or referral. Free, promotional, and referral credits may expire and may be revoked for abuse. Purchased credits are governed by the applicable plan and refund terms.</dd></div>
          <div><dt className="font-semibold text-(--mp-ink)">Balance &amp; billing.</dt><dd>A tool call that would exceed your available balance is declined before it runs; you are never charged into a negative balance. Charges are handled by our payment processor (Stripe).</dd></div>
        </dl>

        <p className="mt-10 text-[12px] text-(--mp-muted)">
          Questions? <a href="mailto:support@getmindy.ai" className="underline underline-offset-2 hover:text-(--mp-muted)">support@getmindy.ai</a>
        </p>
      </div>
    </main>
  );
}
