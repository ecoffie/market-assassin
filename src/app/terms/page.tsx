import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — Mindy',
  description: 'Terms of Service for Mindy by GovCon Giants.',
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-4">Terms of Service</h1>
        <p className="text-slate-500 mb-10">Last Updated: March 9, 2026</p>

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

          <h2 className="text-2xl font-semibold text-white pt-6">1. Services</h2>
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

          <h2 className="text-2xl font-semibold text-white pt-6">2. Account Registration</h2>
          <p>To access certain features, you may need to create an account. You agree to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Provide accurate, current, and complete information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Promptly update your information if it changes</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>

          <h2 className="text-2xl font-semibold text-white pt-6">3. Purchases and Payments</h2>
          <p>When you purchase our products or services:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>All payments are processed securely through Stripe</li>
            <li>Prices are in US dollars unless otherwise stated</li>
            <li>You agree to pay all charges at the prices in effect when incurred</li>
            <li>Digital products are delivered immediately upon payment confirmation</li>
          </ul>

          <h3 className="text-lg font-semibold text-white">Refund Policy</h3>
          <p>
            Due to the digital nature of our products, all sales are final. However, if you experience
            technical issues preventing access to your purchase, please contact us at hello@getmindy.ai
            within 7 days of purchase.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">4. Subscriptions</h2>
          <p>Some services are offered on a subscription basis:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Subscriptions automatically renew unless cancelled</li>
            <li>You may cancel at any time through your account settings or by contacting us</li>
            <li>Cancellation takes effect at the end of the current billing period</li>
            <li>No refunds are provided for partial billing periods</li>
          </ul>

          <h2 id="sms-terms" className="text-2xl font-semibold text-white pt-6">
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
            <Link href="/privacy" className="text-purple-400 hover:text-purple-300 underline">
              Privacy Policy
            </Link>{' '}
            for more details.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">6. Intellectual Property</h2>
          <p>
            All content, features, and functionality of our services are owned by GovConEdu LLC and are
            protected by copyright, trademark, and other intellectual property laws.
          </p>
          <p>
            You may not reproduce, distribute, modify, or create derivative works from our content without
            express written permission. Purchased products are licensed for your personal or internal
            business use only.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">7. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use our services for any unlawful purpose</li>
            <li>Share your account credentials with others</li>
            <li>Resell or redistribute our products without authorization</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Interfere with the proper functioning of our services</li>
            <li>Use automated systems to access our services without permission</li>
          </ul>

          <h2 className="text-2xl font-semibold text-white pt-6">8. Disclaimer of Warranties</h2>
          <p>
            Our services are provided &quot;as is&quot; and &quot;as available&quot; without warranties of
            any kind, either express or implied. We do not guarantee that our services will be
            uninterrupted, error-free, or completely secure.
          </p>
          <p>
            <strong className="text-white">Government Contracting Disclaimer:</strong> Our tools and
            content are for educational and informational purposes only. We do not guarantee that you will
            win government contracts. Success in government contracting depends on many factors beyond our
            control.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">9. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, GovConEdu LLC shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages, or any loss of profits or revenues,
            whether incurred directly or indirectly, or any loss of data, use, goodwill, or other
            intangible losses resulting from your use of our services.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">10. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless GovConEdu LLC, its officers, directors, employees,
            and agents from any claims, damages, losses, or expenses arising from your use of our services
            or violation of these Terms.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">11. Changes to Terms</h2>
          <p>
            We may modify these Terms at any time. We will notify you of material changes by posting the
            updated Terms on our website. Your continued use of our services after such changes
            constitutes acceptance of the new Terms.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">12. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the State of
            Georgia, United States, without regard to its conflict of law provisions.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">13. Contact Information</h2>
          <p>If you have questions about these Terms, please contact us:</p>
          <ul className="list-none space-y-1">
            <li>
              <strong className="text-white">GovConEdu LLC</strong>
            </li>
            <li>Email: hello@getmindy.ai</li>
          </ul>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 flex gap-6">
          <Link href="/" className="text-purple-400 hover:text-purple-300 font-medium">
            &larr; Back to Mindy
          </Link>
          <Link href="/privacy" className="text-purple-400 hover:text-purple-300 font-medium">
            Privacy Policy
          </Link>
        </div>
      </div>
    </main>
  );
}
