import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — Mindy',
  description: 'Privacy Policy for Mindy by GovCon Giants — how we collect, use, and protect your information.',
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-4">Privacy Policy</h1>
        <p className="text-slate-500 mb-10">Last Updated: March 9, 2026</p>

        <div className="space-y-6 leading-relaxed">
          <p>
            GovConEdu LLC (&quot;GovCon Giants,&quot; &quot;Mindy,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to
            protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and
            safeguard your information when you visit getmindy.ai, govcongiants.com, shop.govcongiants.com,
            mi.govcongiants.com, and use our services.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">1. Information We Collect</h2>

          <h3 className="text-lg font-semibold text-white">Personal Information</h3>
          <p>We may collect personal information that you voluntarily provide to us when you:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Register for an account</li>
            <li>Purchase our products or services</li>
            <li>Subscribe to our email list or SMS notifications</li>
            <li>Register for webinars or bootcamps</li>
            <li>Contact us with inquiries</li>
          </ul>
          <p>This information may include:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Name</li>
            <li>Email address</li>
            <li>Phone number</li>
            <li>Company name</li>
            <li>Payment information (processed securely via Stripe)</li>
          </ul>

          <h3 className="text-lg font-semibold text-white">Usage Information</h3>
          <p>
            We automatically collect certain information when you visit our website, including your IP
            address, browser type, operating system, referring URLs, and information about how you interact
            with our site.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Provide, maintain, and improve our services</li>
            <li>Process transactions and send related information</li>
            <li>Send you marketing and promotional communications (with your consent)</li>
            <li>Send you SMS notifications and alerts (with your explicit consent)</li>
            <li>Respond to your comments, questions, and customer service requests</li>
            <li>Monitor and analyze trends, usage, and activities</li>
            <li>Detect, investigate, and prevent fraudulent transactions and other illegal activities</li>
          </ul>

          <h2 id="sms-communications" className="text-2xl font-semibold text-white pt-6">
            3. SMS / Text Message Communications
          </h2>
          <p>
            By providing your phone number and opting in to receive SMS communications, you consent to
            receive text messages from Mindy / GovCon Giants. These messages may include:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Daily intelligence briefings with government contracting opportunities</li>
            <li>Alerts about expiring contracts and recompete opportunities</li>
            <li>Important updates about your account or purchases</li>
            <li>Webinar and bootcamp reminders</li>
          </ul>

          <h3 className="text-lg font-semibold text-white">SMS Opt-In and Consent</h3>
          <p>You must explicitly opt in to receive SMS messages from us. We collect your consent through:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Checking a checkbox or clicking a button indicating your consent to receive SMS messages</li>
            <li>Enabling SMS notifications in your account settings</li>
            <li>Providing your phone number during checkout with SMS opt-in selected</li>
          </ul>
          <p>
            <strong className="text-white">Message frequency:</strong> Varies based on your subscription.
            Daily briefing subscribers receive 1 message per day. Other notifications are sent as needed.
          </p>
          <p>
            <strong className="text-white">Message and data rates may apply.</strong> Check with your
            mobile carrier for details.
          </p>

          <h3 className="text-lg font-semibold text-white">How to Opt Out of SMS</h3>
          <p>You can opt out of receiving SMS messages at any time by:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Replying STOP to any message you receive from us</li>
            <li>Updating your preferences in your account settings</li>
            <li>Contacting us at hello@govconedu.com</li>
          </ul>
          <p>
            After opting out, you will receive one final confirmation message. You will no longer receive
            SMS messages from us unless you opt in again.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">4. Email Communications</h2>
          <p>By providing your email address, you may receive:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Daily intelligence briefings</li>
            <li>Product updates and announcements</li>
            <li>Marketing and promotional content</li>
            <li>Transactional emails (receipts, confirmations)</li>
          </ul>
          <p>
            You can unsubscribe from marketing emails at any time by clicking the &quot;unsubscribe&quot;
            link at the bottom of any email.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">5. Information Sharing</h2>
          <p>We do not sell your personal information. We may share your information with:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong className="text-white">Service Providers:</strong> Companies that help us operate
              our business (payment processing, email delivery, SMS delivery, analytics)
            </li>
            <li>
              <strong className="text-white">Legal Requirements:</strong> When required by law or to
              protect our rights
            </li>
            <li>
              <strong className="text-white">Business Transfers:</strong> In connection with a merger,
              acquisition, or sale of assets
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-white pt-6">6. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your personal
            information. However, no method of transmission over the Internet is 100% secure, and we cannot
            guarantee absolute security.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">7. Your Rights</h2>
          <p>Depending on your location, you may have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate information</li>
            <li>Request deletion of your information</li>
            <li>Opt out of marketing communications</li>
            <li>Opt out of SMS communications</li>
          </ul>
          <p>To exercise these rights, contact us at hello@govconedu.com.</p>

          <h2 className="text-2xl font-semibold text-white pt-6">8. Children&apos;s Privacy</h2>
          <p>
            Our services are not intended for individuals under 18 years of age. We do not knowingly
            collect personal information from children.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">9. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by
            posting the new Privacy Policy on this page and updating the &quot;Last Updated&quot; date.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">10. Contact Us</h2>
          <p>If you have questions about this Privacy Policy, please contact us:</p>
          <ul className="list-none space-y-1">
            <li>
              <strong className="text-white">GovConEdu LLC</strong>
            </li>
            <li>Email: hello@govconedu.com</li>
          </ul>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800">
          <Link href="/" className="text-purple-400 hover:text-purple-300 font-medium">
            &larr; Back to Mindy
          </Link>
        </div>
      </div>
    </main>
  );
}
