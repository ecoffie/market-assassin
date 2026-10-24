import Link from 'next/link';

export const metadata = {
  // Self-canonical. Without this the ROOT layout's `alternates: { canonical: '/' }`
  // default applies and this page tells Google to index the homepage instead of
  // itself. Measured on production 2026-09-21 by crawling all 36,070 sitemap
  // URLs: this page canonicalised to https://getmindy.ai.
  alternates: { canonical: 'https://getmindy.ai/terms' },
  title: 'Terms of Service — Mindy',
  description: 'Terms of Service for Mindy by GovCon Giants.',
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">Terms of Service</h1>
        <p className="text-(--mp-muted) mb-10">Last Updated: October 24, 2026</p>

        <div className="space-y-6 leading-relaxed">
          <p>
            Welcome to Mindy. These Terms of Service (&quot;Terms&quot;) govern your access to and use of
            the websites, products, and services provided by GovConEdu LLC (&quot;GovCon Giants,&quot;
            &quot;Mindy,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
          </p>
          <p>
            By accessing or using our services, you agree to be bound by these Terms. If you do not agree
            to these Terms, do not use our services.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">1. Services</h2>
          <p>
            GovCon Giants and Mindy provide educational resources, tools, and services related to
            government contracting, including but not limited to:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Online courses and training programs</li>
            <li>Software tools (Federal Market Assassin, Content Generator, Recompete Tracker, Mindy, etc.)</li>
            <li>Daily intelligence briefings via email and SMS</li>
            <li>Webinars and bootcamps</li>
            <li>Downloadable resources and templates</li>
          </ul>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">2. Account Registration</h2>
          <p>To access certain features, you may need to create an account. You agree to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Provide accurate, current, and complete information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Promptly update your information if it changes</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">3. Purchases and Payments</h2>
          <p>When you purchase our products or services:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>All payments are processed securely through Stripe</li>
            <li>Prices are in US dollars unless otherwise stated</li>
            <li>You agree to pay all charges at the prices in effect when incurred</li>
            <li>Digital products are delivered immediately upon payment confirmation</li>
          </ul>

          <h3 className="text-lg font-semibold text-(--mp-ink)">Refund Policy</h3>
          <p>
            Due to the digital nature of our products, all sales are final. However, if you experience
            technical issues preventing access to your purchase, please contact us at hello@getmindy.ai
            within 7 days of purchase.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">4. Subscriptions and Mindy Credits</h2>
          <p>Some services are offered on a subscription basis:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Subscriptions automatically renew unless cancelled</li>
            <li>You may cancel at any time through your account settings or by contacting us</li>
            <li>Cancellation takes effect at the end of the current billing period</li>
            <li>No refunds are provided for partial billing periods</li>
          </ul>

          <h3 id="credits" className="text-lg font-semibold text-(--mp-ink)">Mindy Credits</h3>
          <p>
            Some Mindy features, including Mindy tools used inside AI assistants, use credits. Credits are
            held either on your individual account or, for Team plans, in a shared pool for your organization.
          </p>

          <h4 className="font-semibold text-(--mp-ink)">Individual credits</h4>
          <ul className="list-disc pl-6 space-y-1">
            <li>Monthly credit plans add the plan&apos;s credits each time a monthly payment is processed.</li>
            <li>
              Some individual annual plans add the full year of credits up front when the annual payment is
              processed. Other plans, such as Mindy Pro, add their credit allowance each month, including when
              billed annually.
            </li>
            <li>One-time top-ups add credits when the payment is processed.</li>
            <li>New accounts may receive a one-time allotment of free credits.</li>
            <li>Unused credits on your individual account carry forward while your account remains open.</li>
          </ul>

          <h4 className="font-semibold text-(--mp-ink)">Team credit pools</h4>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Team plans use a shared pool. Requests made by Team members draw on the pool, not on their
              individual balances.
            </li>
            <li>
              The pool is replenished up to the plan&apos;s monthly allowance on the plan&apos;s configured funding
              schedule, including for Team plans billed annually. Unused monthly allowance does not accumulate
              beyond that limit.
            </li>
            <li>A Team member whose requests draw on a Team pool may not also receive an individual Mindy Pro allowance.</li>
          </ul>

          <h4 className="font-semibold text-(--mp-ink)">How credits are used</h4>
          <ul className="list-disc pl-6 space-y-1">
            <li>Each tool uses a set number of credits per billable request. Current costs are shown in your Mindy account. We may change tool costs going forward; changes do not affect credits already used.</li>
            <li>A completed billable request may use credits even when it finds no matching records.</li>
            <li>Requests that are refused, and requests that perform no billable work, are not charged.</li>
          </ul>

          <h4 className="font-semibold text-(--mp-ink)">Cancellation</h4>
          <p>
            Cancelling a subscription stops future credit allowances after the current billing period ends. It
            does not automatically remove credits already on your individual account.
          </p>

          <h4 className="font-semibold text-(--mp-ink)">Value and transfers</h4>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Credits have no cash value and are not refundable, except as described in Section 3 or as required
              by applicable law. Nothing in this section limits any rights you have under applicable consumer law.
            </li>
            <li>
              Credits may not be sold or transferred to another person. We may make authorized administrative
              adjustments, including moving credits between accounts that belong to the same customer.
            </li>
            <li>Free, promotional, or complimentary credits may be changed or withdrawn at any time.</li>
          </ul>

          <h2 id="sms-terms" className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">
            5. SMS / Text Message Terms
          </h2>
          <p>By opting in to receive SMS messages from Mindy / GovCon Giants, you agree to the following:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>You consent to receive automated text messages at the phone number provided</li>
            <li>Message frequency varies based on your subscription (up to 1 message per day for daily briefings)</li>
            <li>Message and data rates may apply depending on your mobile carrier</li>
            <li>SMS is not required to purchase any products or services</li>
            <li>You can opt out at any time by replying STOP to any message</li>
            <li>For help, reply HELP or contact hello@getmindy.ai</li>
          </ul>
          <p>
            We will not share your phone number with third parties for marketing purposes. See our{' '}
            <Link href="/privacy" className="text-(--mp-navy) hover:text-(--mp-navy-hover) underline">
              Privacy Policy
            </Link>{' '}
            for more details.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">6. Intellectual Property</h2>
          <p>
            All content, features, and functionality of our services are owned by GovConEdu LLC and are
            protected by copyright, trademark, and other intellectual property laws.
          </p>
          <p>
            You may not reproduce, distribute, modify, or create derivative works from our content without
            express written permission. Purchased products are licensed for your personal or internal
            business use only.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">7. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use our services for any unlawful purpose</li>
            <li>Share your account credentials with others</li>
            <li>Resell or redistribute our products without authorization</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Interfere with the proper functioning of our services</li>
            <li>Use automated systems to access our services without permission</li>
          </ul>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">8. Disclaimer of Warranties</h2>
          <p>
            Our services are provided &quot;as is&quot; and &quot;as available&quot; without warranties of
            any kind, either express or implied. We do not guarantee that our services will be
            uninterrupted, error-free, or completely secure.
          </p>
          <p>
            <strong className="text-(--mp-ink)">Government Contracting Disclaimer:</strong> Our tools and
            content are for educational and informational purposes only. We do not guarantee that you will
            win government contracts. Success in government contracting depends on many factors beyond our
            control.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">9. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, GovConEdu LLC shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages, or any loss of profits or revenues,
            whether incurred directly or indirectly, or any loss of data, use, goodwill, or other
            intangible losses resulting from your use of our services.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">10. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless GovConEdu LLC, its officers, directors, employees,
            and agents from any claims, damages, losses, or expenses arising from your use of our services
            or violation of these Terms.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">11. Changes to Terms</h2>
          <p>
            We may modify these Terms at any time. We will notify you of material changes by posting the
            updated Terms on our website. Your continued use of our services after such changes
            constitutes acceptance of the new Terms.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">12. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the State of
            Georgia, United States, without regard to its conflict of law provisions.
          </p>

          <h2 className="text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">13. Contact Information</h2>
          <p>If you have questions about these Terms, please contact us:</p>
          <ul className="list-none space-y-1">
            <li>
              <strong className="text-(--mp-ink)">GovConEdu LLC</strong>
            </li>
            <li>Email: hello@getmindy.ai</li>
          </ul>
        </div>

        <div className="mt-12 pt-8 border-t border-(--mp-line) flex gap-6">
          <Link href="/" className="text-(--mp-navy) hover:text-(--mp-navy-hover) font-medium">
            &larr; Back to Mindy
          </Link>
          <Link href="/privacy" className="text-(--mp-navy) hover:text-(--mp-navy-hover) font-medium">
            Privacy Policy
          </Link>
        </div>
      </div>
    </main>
  );
}
