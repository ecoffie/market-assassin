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
        <p className="text-slate-500 mb-10">Last Updated: July 17, 2026</p>

        <div className="space-y-6 leading-relaxed">
          <p>
            GovConEdu LLC (&quot;GovCon Giants,&quot; &quot;Mindy,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to
            protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and
            safeguard your information when you visit getmindy.ai, govcongiants.com, shop.govcongiants.com,
            and use our services.
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
            <li>Contacting us at hello@getmindy.ai</li>
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

          <h2 className="text-2xl font-semibold text-white pt-6">6. Where Your Data Is Stored</h2>
          <p>
            Your account data, saved research, and usage records are stored in our PostgreSQL database
            hosted by Supabase in the United States (AWS US-West-2, Oregon), with a read replica in the
            same region. Our application is hosted on Vercel. Payment details are processed and stored by
            Stripe &mdash; we never store full card numbers on our systems.
          </p>
          <p>
            We implement appropriate technical and organizational measures to protect your personal
            information. However, no method of transmission over the Internet is 100% secure, and we cannot
            guarantee absolute security.
          </p>

          <h2 id="data-retention" className="text-2xl font-semibold text-white pt-6">
            7. Data Retention
          </h2>
          <p>We keep your information only as long as we need it for the purpose it was collected:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong className="text-white">Account information</strong> (name, email, company, targeting
              preferences) &mdash; for as long as your account is active.
            </li>
            <li>
              <strong className="text-white">Saved work</strong> (research, market reports, proposal drafts,
              pipeline, contacts) &mdash; for as long as your account is active, so you can return to it.
            </li>
            <li>
              <strong className="text-white">Usage and billing records</strong> (tool-call logs, credit
              ledger) &mdash; retained while your account is active, because they are the audit trail behind
              your balance and invoices.
            </li>
            <li>
              <strong className="text-white">Authentication tokens</strong> &mdash; access tokens expire
              after 1 hour, refresh tokens after 60 days, and authorization codes after 5 minutes and are
              single-use. Revoking a connection invalidates them immediately.
            </li>
            <li>
              <strong className="text-white">Email and SMS delivery records</strong> &mdash; kept while your
              account is active so we can honor unsubscribe and STOP requests and prove consent.
            </li>
          </ul>
          <p>
            <strong className="text-white">Deletion.</strong> You can ask us to delete your account and its
            data at any time by emailing hello@getmindy.ai. We action deletion requests within 30 days.
            Deleting your account removes your saved work and activity records. We may retain a minimal
            record of a transaction where tax, accounting, or legal obligations require it, and we may keep
            anonymized, aggregated statistics that cannot identify you.
          </p>

          <h2 id="ai-processing" className="text-2xl font-semibold text-white pt-6">
            8. AI Processing and Model Providers
          </h2>
          <p>
            Mindy is an AI product. To answer your questions, extract requirements from solicitations, and
            draft proposal content, we send the relevant text to third-party large language model providers.
            Depending on the task, that may include <strong className="text-white">OpenAI</strong>,{' '}
            <strong className="text-white">Anthropic</strong>, <strong className="text-white">Groq</strong>,
            and <strong className="text-white">xAI</strong>. We use multiple providers so the service stays
            available when any one of them is rate-limited or down.
          </p>
          <p>
            <strong className="text-white">Sensitive content is restricted to a narrower set.</strong> When
            a request involves your own business information &mdash; your capability statements, past
            performance, personnel details, or a proposal draft grounded in them &mdash; we classify it as
            sensitive and route it only to providers we have vetted as{' '}
            <strong className="text-white">not training on our data</strong>. Sensitive content is never
            sent to xAI. This restriction is enforced in our code, not by policy alone: a configuration
            change cannot override it.
          </p>
          <p>
            We do not use your business information to train our own models. We do not sell it. Public
            federal data returned to you (SAM.gov notices, USASpending awards, and similar) is government
            data, not your data, and carries no such restriction.
          </p>

          <h2 id="mcp-connector" className="text-2xl font-semibold text-white pt-6">
            9. The Mindy Connector for AI Assistants (MCP)
          </h2>
          <p>
            Mindy can be connected to AI assistants that support the Model Context Protocol (MCP), including
            Claude, at <span className="font-mono text-slate-300">https://mcp.getmindy.ai/mcp</span>. If you
            connect it:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              You authorize the connection through a standard OAuth consent screen. We never receive your
              credentials for the AI assistant, and the assistant never receives your Mindy password.
            </li>
            <li>
              The assistant can then call Mindy tools on your behalf. Most tools only read data. Two write:
              one generates a market report and saves it to your account, and one adds contacts to a CRM you
              have connected. Tools that write are declared as such, so your assistant asks before running
              them.
            </li>
            <li>
              We log each tool call &mdash; which tool, when, and what it cost in credits &mdash; because
              that is your billing record. We do not store the surrounding conversation, and Mindy does not
              read your chat history, memory, or files.
            </li>
            <li>
              Anything a tool sends back to your assistant is then handled under that assistant vendor&apos;s
              privacy policy, not ours. Disconnecting the connector in your assistant&apos;s settings revokes
              its access immediately.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-white pt-6">10. Your Rights</h2>
          <p>Depending on your location, you may have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate information</li>
            <li>Request deletion of your information</li>
            <li>Opt out of marketing communications</li>
            <li>Opt out of SMS communications</li>
          </ul>
          <p>To exercise these rights, contact us at hello@getmindy.ai.</p>

          <h2 className="text-2xl font-semibold text-white pt-6">11. Children&apos;s Privacy</h2>
          <p>
            Our services are not intended for individuals under 18 years of age. We do not knowingly
            collect personal information from children.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">12. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by
            posting the new Privacy Policy on this page and updating the &quot;Last Updated&quot; date.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-6">13. Contact Us</h2>
          <p>If you have questions about this Privacy Policy, please contact us:</p>
          <ul className="list-none space-y-1">
            <li>
              <strong className="text-white">GovConEdu LLC</strong>
            </li>
            <li>Email: hello@getmindy.ai</li>
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
