import Link from 'next/link';
import type { ReactNode } from 'react';

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

/*
 * Owner request 2026-11-16: "make the terms of service long and detailed so that we cover
 * everything that is going on." Every section below describes a feature that exists in the
 * product today (plans + 14-day card trial, early-upgrade bonus credits, credits/auto-recharge,
 * Team pools, Mindy in your AI (MCP / ChatGPT), AI drafting, contacts data, CRM push, shared
 * report links, alerts/SMS, ambassadors, referrals). Keep it in step with the product: when a
 * feature or price rule changes, change the matching section and the Last Updated date.
 * This is not a substitute for review by counsel.
 */

const LAST_UPDATED = 'November 16, 2026';

function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-2xl font-semibold text-(--mp-ink) pt-6 font-(family-name:--mp-font-serif)">
      {children}
    </h2>
  );
}
function H3({ id, children }: { id?: string; children: ReactNode }) {
  return <h3 id={id} className="scroll-mt-24 text-lg font-semibold text-(--mp-ink)">{children}</h3>;
}
function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-6 space-y-1">{children}</ul>;
}
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-(--mp-navy) hover:text-(--mp-navy-hover) underline">{children}</Link>
);

const SECTIONS: [string, string][] = [
  ['agreement', 'Agreement and who we are'],
  ['definitions', 'Definitions'],
  ['eligibility', 'Eligibility'],
  ['services', 'The Services'],
  ['accounts', 'Accounts and security'],
  ['plans', 'Plans, free trials and billing'],
  ['refunds', 'Refunds'],
  ['credits', 'Mindy credits'],
  ['ai-agents', 'Mindy in your AI (MCP, ChatGPT and API access)'],
  ['data', 'Government data, accuracy and estimates'],
  ['ai-output', 'AI-generated content'],
  ['contacts', 'Contact information and outreach'],
  ['your-content', 'Your content and Company Vault'],
  ['integrations', 'Third-party services and integrations'],
  ['sharing', 'Shared links and reports'],
  ['communications', 'Emails, alerts and notifications'],
  ['sms-terms', 'SMS / text message terms'],
  ['programs', 'Referral, Ambassador and promotional programs'],
  ['events', 'Events, training and coaching'],
  ['acceptable-use', 'Acceptable use'],
  ['fair-use', 'Fair use, limits and monitoring'],
  ['ip', 'Intellectual property'],
  ['feedback', 'Feedback and beta features'],
  ['privacy', 'Privacy and security'],
  ['government', 'Government contracting, compliance and export'],
  ['termination', 'Suspension and termination'],
  ['warranties', 'Disclaimer of warranties'],
  ['liability', 'Limitation of liability'],
  ['indemnity', 'Indemnification'],
  ['disputes', 'Disputes and governing law'],
  ['changes', 'Changes to the Services and these Terms'],
  ['general', 'General terms'],
  ['contact', 'Contact information'],
];

export default function TermsPage() {
  let n = 0;
  const num = () => `${++n}. `;
  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">Terms of Service</h1>
        <p className="text-(--mp-muted) mb-10">Last Updated: {LAST_UPDATED}</p>

        <div className="space-y-6 leading-relaxed">
          <p>
            Welcome to Mindy. These Terms of Service (&quot;Terms&quot;) are a binding agreement between you and
            GovConEdu LLC (&quot;GovCon Giants,&quot; &quot;Mindy,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
            and govern your access to and use of getmindy.ai, the Mindy app, the Opportunity Map, Mindy in your AI,
            our emails and text messages, and every other website, product and service we provide (together, the
            &quot;Services&quot;).
          </p>
          <p>
            <strong className="text-(--mp-ink)">
              Please read these Terms carefully. By creating an account, starting a trial, making a purchase, or
              otherwise using the Services, you agree to these Terms and to our{' '}
              <A href="/privacy">Privacy Policy</A>. If you do not agree, do not use the Services.
            </strong>
          </p>

          <nav aria-label="Contents" className="rounded-xl border border-(--mp-line) bg-(--mp-surface) p-5">
            <p className="m-0 font-semibold text-(--mp-ink)">Contents</p>
            <ol className="mt-3 grid gap-1 pl-6 sm:grid-cols-2 list-decimal">
              {SECTIONS.map(([id, label]) => (
                <li key={id}><a href={`#${id}`} className="text-(--mp-navy) hover:text-(--mp-navy-hover)">{label}</a></li>
              ))}
            </ol>
          </nav>

          <H2 id="agreement">{num()}Agreement and who we are</H2>
          <p>
            Mindy is a federal contracting intelligence product operated by GovConEdu LLC, a Georgia limited
            liability company doing business as GovCon Giants and GovCon Giants AI. If you use the Services on
            behalf of a company or other organization, you represent that you have authority to bind that
            organization to these Terms, and &quot;you&quot; means both you and that organization.
          </p>
          <p>
            Some programs have additional terms, such as the <A href="/legal/referral-terms">Referral Program &amp;
            Credits Terms</A> and the <A href="/ambassadors">Mindy Ambassador Program</A>. Those terms are part of
            these Terms. If they conflict, the program terms control for that program only. A separate written
            agreement signed by us (for example, an Enterprise order form) controls where it conflicts with these
            Terms.
          </p>

          <H2 id="definitions">{num()}Definitions</H2>
          <UL>
            <li><strong className="text-(--mp-ink)">Account</strong> means your Mindy account and any login used to access it.</li>
            <li><strong className="text-(--mp-ink)">Plan</strong> means Free, Pro, Team, Enterprise, a credit-only plan, or any other offering you sign up for.</li>
            <li><strong className="text-(--mp-ink)">Credits</strong> means the prepaid units used to run metered Mindy tools, described in Section 8.</li>
            <li><strong className="text-(--mp-ink)">Your Content</strong> means information you give us, such as your profile, company details, UEI, keywords, uploaded documents, Company Vault entries, saved searches, pursuits, notes and messages.</li>
            <li><strong className="text-(--mp-ink)">Output</strong> means anything the Services generate for you, including search results, maps, reports, scores, estimates, briefings and AI-drafted text.</li>
            <li><strong className="text-(--mp-ink)">Public Data</strong> means information we collect from government and other public sources, such as SAM.gov, USASpending.gov, agency forecasts, the Federal Register and similar sources.</li>
          </UL>

          <H2 id="eligibility">{num()}Eligibility</H2>
          <UL>
            <li>You must be at least 18 years old and able to form a binding contract.</li>
            <li>The Services are intended for business and professional use related to government contracting.</li>
            <li>
              You may not use the Services if you are barred from doing so under U.S. law, including if you are on a
              U.S. government sanctions or restricted-party list.
            </li>
            <li>
              You may not use the Services if we previously terminated your Account for violating these Terms, unless we
              agree in writing.
            </li>
          </UL>

          <H2 id="services">{num()}The Services</H2>
          <p>The Services include, among other things:</p>
          <UL>
            <li>The Mindy app, including opportunity matching, market research, forecasts, recompetes, contractor and buyer intelligence, pipeline and pursuit tracking, and settings</li>
            <li>The Opportunity Map and its saved searches, watchlist, saved opportunities and alerts</li>
            <li>Daily and weekly email alerts and briefings, and optional text message alerts</li>
            <li>AI features, including Ask Mindy, bid/no-bid analysis and proposal drafting</li>
            <li>Mindy in your AI: tools you can use from Claude, ChatGPT, Cursor and other AI assistants or by API</li>
            <li>Legacy tools and products (such as Federal Market Assassin, Content Reaper and the Federal Contractor Database), training, webinars, bootcamps and downloadable resources</li>
          </UL>
          <p>
            Features differ by Plan. Some features (for example Players, the M-Win score, saving to a CRM and the
            proposal workspace) are available only on paid Plans or during a trial. We describe what each Plan includes
            on our <A href="/pricing">pricing page</A>; that description may change as described in Section 31.
          </p>
          <p>
            Mindy is not affiliated with, endorsed by, or acting for the U.S. government or any government agency. Mindy is
            not a law firm, accounting firm or financial adviser, and nothing in the Services is legal, tax, accounting or
            financial advice.
          </p>

          <H2 id="accounts">{num()}Accounts and security</H2>
          <UL>
            <li>Provide accurate, current and complete information, and keep it up to date.</li>
            <li>
              Keep your login, passwords, one-time codes, API keys and connected-AI authorizations secure. Do not share
              them. You are responsible for everything done through your Account, including by AI assistants or tools you
              connect to it.
            </li>
            <li>One person per login. Team plans allow the number of users stated for your Plan; each user needs their own login.</li>
            <li>Tell us right away at admin@getmindy.ai if you believe your Account has been accessed without permission.</li>
            <li>
              We may require additional sign-in verification (such as a one-time code or a Google, Microsoft or Apple
              sign-in) and may sign you out or reset access to protect your Account.
            </li>
            <li>
              For Team and Enterprise Plans, the organization&apos;s owner or administrator controls the workspace and may
              add or remove members and see shared pipeline, pursuits and usage.
            </li>
          </UL>

          <H2 id="plans">{num()}Plans, free trials and billing</H2>
          <H3>Payments</H3>
          <UL>
            <li>Payments are processed by Stripe. By paying, you also agree to Stripe&apos;s terms.</li>
            <li>Prices are in U.S. dollars and exclude taxes unless stated. You are responsible for applicable taxes.</li>
            <li>You authorize us to charge your payment method for all fees when due, including renewals.</li>
            <li>If a payment fails, we may retry it, suspend paid features, or move your Account to the Free Plan until it is paid.</li>
          </UL>
          <H3>Subscriptions and renewal</H3>
          <UL>
            <li>Paid Plans are billed monthly or annually and renew automatically for the same period until cancelled.</li>
            <li>You can cancel anytime in Settings → Billing or by emailing admin@getmindy.ai. Cancellation takes effect at the end of the current paid period; you keep access until then.</li>
            <li>We may change Plan prices. Price changes apply from your next renewal after we give you notice.</li>
            <li>Plan changes: upgrades take effect immediately; we may charge a prorated amount. Downgrades take effect at the next renewal.</li>
          </UL>
          <H3 id="trial">14-day free trial</H3>
          <UL>
            <li>Pro and Team Plans may start with a 14-day free trial. A payment card is required to start a trial.</li>
            <li>You are not charged during the trial. We will remind you before it ends.</li>
            <li>
              <strong className="text-(--mp-ink)">Unless you cancel before the trial ends, your card is charged automatically for the Plan and billing period you chose</strong>{' '}
              (for example $149 per month for Pro, or the full annual price for an annual Plan), and the subscription renews as described above.
            </li>
            <li>Trials are for new customers. We may limit trials to one per person, organization or payment method, and may end a trial early if we detect abuse.</li>
            <li>Some trials are granted directly (for example through a partner) without a card. Those end on the stated date and move to the Free Plan unless you buy a Plan.</li>
          </UL>
          <H3 id="early-upgrade">Upgrading early from a trial</H3>
          <UL>
            <li>While on a card trial you may choose to upgrade early. Your card is charged immediately and your trial ends at that moment.</li>
            <li>Trials and upgrades may include promotional bonus credits as offered in the app. Bonus credits are added only after any required payment succeeds, at most once per person, and are promotional credits under Section 8.</li>
            <li>If the payment fails, nothing is charged, no bonus is added and your trial continues.</li>
            <li>An early upgrade is a purchase and is final under Section 7.</li>
          </UL>
          <H3>Legacy and grandfathered purchases</H3>
          <p>
            If you bought an earlier product or bundle (for example a lifetime or one-time product), you keep the access
            we promised at purchase for as long as we offer that product or a reasonable replacement. &quot;Lifetime&quot; means
            the lifetime of the product, not of the purchaser.
          </p>

          <H2 id="refunds">{num()}Refunds</H2>
          <p>
            <strong className="text-(--mp-ink)">All sales are final. We do not offer refunds,</strong> including for unused time,
            partial billing periods, unused credits, renewals you forgot to cancel, or upgrades from a trial. You are not
            charged during a free trial, so please cancel before it ends if you do not want to continue.
          </p>
          <p>
            If a technical problem on our side prevents you from accessing something you paid for, contact
            admin@getmindy.ai within 7 days of purchase and we will work to fix it. Nothing in this Section limits any
            right you have under applicable law that cannot be waived.
          </p>

          <H2 id="credits">{num()}Mindy credits</H2>
          <p>
            Some Mindy features, including Mindy tools used inside AI assistants, use credits. Credits are held either on
            your individual account or, for Team plans, in a shared pool for your organization.
          </p>
          <H3>Individual credits</H3>
          <UL>
            <li>Monthly credit plans add the plan&apos;s credits each time a monthly payment is processed.</li>
            <li>
              Some individual annual plans add the full year of credits up front when the annual payment is processed. Other
              plans, such as Mindy Pro, add their credit allowance each month, including when billed annually.
            </li>
            <li>One-time top-ups add credits when the payment is processed.</li>
            <li>New accounts may receive a one-time allotment of free credits.</li>
            <li>Unused credits on your individual account carry forward while your account remains open.</li>
          </UL>
          <H3>Team credit pools</H3>
          <UL>
            <li>Team plans use a shared pool. Requests made by Team members draw on the pool, not on their individual balances.</li>
            <li>
              The pool is replenished up to the plan&apos;s monthly allowance on the plan&apos;s configured funding schedule,
              including for Team plans billed annually. Unused monthly allowance does not accumulate beyond that limit.
            </li>
            <li>A Team member whose requests draw on a Team pool may not also receive an individual Mindy Pro allowance.</li>
          </UL>
          <H3>How credits are used</H3>
          <UL>
            <li>Each tool uses a set number of credits per billable request. Current costs are shown in your Mindy account. We may change tool costs going forward; changes do not affect credits already used.</li>
            <li>A completed billable request may use credits even when it finds no matching records.</li>
            <li>Requests that are refused, and requests that perform no billable work, are not charged.</li>
          </UL>
          <H3 id="auto-recharge">Auto-recharge</H3>
          <UL>
            <li>
              If you turn on auto-recharge, you authorize us to charge your saved payment method for the credit package you
              selected whenever your balance falls below the threshold you set, up to any limits you set.
            </li>
            <li>Each auto-recharge is a separate final purchase. You can turn auto-recharge off at any time in your account.</li>
            <li>We may pause auto-recharge if a payment fails or we detect unusual activity.</li>
          </UL>
          <H3>Cancellation</H3>
          <p>
            Cancelling a subscription stops future credit allowances after the current billing period ends. It does not
            automatically remove credits already on your individual account.
          </p>
          <H3>Value and transfers</H3>
          <UL>
            <li>
              Credits have no cash value and are not refundable, except as described in Section 7 or as required by applicable
              law. Nothing in this section limits any rights you have under applicable consumer law.
            </li>
            <li>
              Credits may not be sold or transferred to another person. We may make authorized administrative adjustments,
              including moving credits between accounts that belong to the same customer.
            </li>
            <li>Free, promotional, bonus, referral or complimentary credits may be changed or withdrawn at any time, and are used before or after paid credits as we determine.</li>
            <li>If your Account is closed or terminated, any remaining credits are forfeited.</li>
          </UL>

          <H2 id="ai-agents">{num()}Mindy in your AI (MCP, ChatGPT and API access)</H2>
          <UL>
            <li>
              You can connect Mindy to AI assistants such as Claude, ChatGPT and Cursor by signing in (OAuth) or with an API
              key. When you connect, you authorize that assistant to call Mindy tools on your behalf and to use your credits.
            </li>
            <li>You are responsible for every request made through your connection or key, including requests an AI assistant decides to make on its own.</li>
            <li>Keep API keys secret. You can revoke a key or a connection at any time in your account; revoke it right away if it may be exposed.</li>
            <li>The AI assistant is a third-party product with its own terms and privacy practices. We do not control what it does with Mindy results once they are returned to it.</li>
            <li>
              Tools that change something outside Mindy (for example adding contacts to your CRM) act only on accounts you
              connect and authorize. Review what an assistant proposes before you approve it.
            </li>
            <li>Tool names, inputs, outputs and credit costs may change. We may add, change or retire tools.</li>
          </UL>

          <H2 id="data">{num()}Government data, accuracy and estimates</H2>
          <UL>
            <li>
              Much of what Mindy shows comes from Public Data. Government sources can be incomplete, delayed, inconsistent or
              wrong, and they can change after we copy them. We may also combine, classify or summarize that data, and those
              steps can introduce errors.
            </li>
            <li>
              <strong className="text-(--mp-ink)">Always confirm details in the official source</strong> (for example the
              solicitation on SAM.gov) before you rely on them. Deadlines, amendments, set-asides, eligibility, contacts and
              submission instructions in the official notice control.
            </li>
            <li>
              Numbers such as estimated contract values (including M-Estimate), win-probability and fit scores (including
              M-Win), market sizes, competition measures, incumbent identification and forecasts are estimates based on
              available data and models. They are not guarantees, quotes or predictions you should rely on alone.
            </li>
            <li>A result that is missing, empty or shown as unavailable does not mean an opportunity, company or market does not exist.</li>
            <li>We are not responsible for missed deadlines, lost bids or other outcomes based on information shown in the Services.</li>
          </UL>

          <H2 id="ai-output">{num()}AI-generated content</H2>
          <UL>
            <li>
              Some features use artificial intelligence provided by us and by third-party AI providers to answer questions,
              summarize documents, score opportunities and draft content such as proposals, capability statements, compliance
              matrices, emails and posts.
            </li>
            <li>
              AI Output can be inaccurate, incomplete, outdated or inappropriate, and may look confident when it is wrong. It
              may resemble content generated for other users.
            </li>
            <li>
              <strong className="text-(--mp-ink)">You are responsible for reviewing, correcting and approving any Output before you use, submit or send it</strong>,
              including any proposal or response you submit to a government buyer. You are responsible for the accuracy of
              every representation, certification and price in what you submit.
            </li>
            <li>Do not use AI Output as legal, accounting, tax or compliance advice.</li>
            <li>As between you and us, you own the Output generated for you, subject to our rights in the Services and in any Public Data or Mindy materials included in it.</li>
          </UL>

          <H2 id="contacts">{num()}Contact information and outreach</H2>
          <UL>
            <li>
              The Services may show names, titles, emails and phone numbers of government buyers, small business offices and
              companies, collected from public sources. This information may be out of date or wrong.
            </li>
            <li>
              Use contact information only for legitimate, professional government-contracting purposes. You must follow all
              laws that apply to your outreach, including anti-spam, telemarketing and privacy laws (such as CAN-SPAM and the
              TCPA), each agency&apos;s rules about contacting its staff, and any communication restrictions in a solicitation.
            </li>
            <li>Do not use contact information for bulk unsolicited messaging, harassment, resale, or to build a competing database.</li>
            <li>Respect &quot;no contact&quot; periods: during an active procurement, communicate only through the channels the solicitation allows.</li>
          </UL>

          <H2 id="your-content">{num()}Your content and Company Vault</H2>
          <UL>
            <li>You keep ownership of Your Content.</li>
            <li>
              You give us a worldwide, non-exclusive license to host, store, copy, process, transmit and display Your Content
              as needed to provide, secure and improve the Services for you, including sending it to the third-party
              providers that help us run the Services (such as hosting, email and AI providers).
            </li>
            <li>You confirm you have the rights to upload Your Content and that it does not violate anyone&apos;s rights or any law or contract.</li>
            <li>
              <strong className="text-(--mp-ink)">Do not upload classified information, Controlled Unclassified Information (CUI),
              export-controlled technical data, or other information you are not permitted to share with a commercial cloud
              service.</strong> The Services are not authorized to store or process that kind of information.
            </li>
            <li>We may use aggregated or de-identified data (which does not identify you or your company) to measure and improve the Services and to publish statistics, such as totals of contracts won by Mindy members.</li>
            <li>You can delete Your Content or ask us to delete your Account. We may keep limited records as required by law, for billing, or for security.</li>
          </UL>

          <H2 id="integrations">{num()}Third-party services and integrations</H2>
          <UL>
            <li>
              The Services work with third-party products, such as Google, Microsoft and Apple sign-in, Stripe, email and text
              providers, AI providers, AI assistants, mapping providers and CRMs such as GoHighLevel. Your use of those products
              is governed by their own terms.
            </li>
            <li>
              If you connect a CRM by giving us an access token, you authorize us to create and update records in that CRM when
              you ask Mindy to. Updates may overwrite existing fields. You are responsible for your CRM account and for keeping
              your token secure; you can disconnect at any time.
            </li>
            <li>Calendar files (.ics) and exports we provide are for your convenience; check dates against the official source.</li>
            <li>We are not responsible for third-party products, their availability, or what they do with information you send them.</li>
          </UL>

          <H2 id="sharing">{num()}Shared links and reports</H2>
          <UL>
            <li>
              Some features create a shareable link, such as a market report link or an opportunity share link. Anyone who has
              the link can open it without signing in. Share it only with people you want to see it.
            </li>
            <li>We may keep shared links available after your subscription ends, and we may remove them at any time.</li>
            <li>If you share a report with a client, you are responsible for how you present it, including making clear that figures are estimates based on public data.</li>
          </UL>

          <H2 id="communications">{num()}Emails, alerts and notifications</H2>
          <UL>
            <li>
              By creating an Account you agree to receive transactional and service emails, such as sign-in codes, receipts,
              trial reminders, opportunity alerts, briefings and account notices. You can change alert frequency or turn
              alerts off in Settings.
            </li>
            <li>We may also send product updates and offers. You can unsubscribe from marketing emails using the link in each message.</li>
            <li>Alerts are a convenience. They may be delayed, incomplete or not delivered, and they do not replace checking official sources.</li>
            <li>You agree that notices, agreements and disclosures we provide electronically satisfy any requirement that they be in writing.</li>
          </UL>

          <H2 id="sms-terms">{num()}SMS / text message terms</H2>
          <p>By opting in to receive SMS messages from Mindy / GovCon Giants, you agree to the following:</p>
          <UL>
            <li>You consent to receive automated text messages at the phone number provided</li>
            <li>Message frequency varies based on your subscription (up to 1 message per day for daily briefings, plus alerts about pursuits you track)</li>
            <li>Message and data rates may apply depending on your mobile carrier</li>
            <li>SMS is not required to purchase any products or services</li>
            <li>You can opt out at any time by replying STOP to any message</li>
            <li>For help, reply HELP or contact admin@getmindy.ai</li>
          </UL>
          <p>
            We will not share your phone number with third parties for marketing purposes. See our{' '}
            <A href="/privacy">Privacy Policy</A> for more details.
          </p>

          <H2 id="programs">{num()}Referral, Ambassador and promotional programs</H2>
          <UL>
            <li>The Referral Program is governed by the <A href="/legal/referral-terms">Referral Program &amp; Credits Terms</A>.</li>
            <li>
              The <A href="/ambassadors">Mindy Ambassador Program</A> is by application and approval. Ambassadors receive the
              access and benefits described on that page and in their acceptance email, and must meet its posting, disclosure
              and conduct standards. Ambassadors must clearly disclose their connection to Mindy in every post, as required by
              the FTC Endorsement Guides, and must not make claims a reader cannot verify or guarantee contract wins. We may
              end an ambassador&apos;s participation as described in the program terms.
            </li>
            <li>
              Promotions, coupons, event credits and bonus credits are subject to the terms stated with the offer, are limited
              to one per person or organization unless stated, have no cash value, and may be changed or ended at any time.
              We may withhold or reverse a promotional benefit obtained through abuse, duplicate accounts or fraud.
            </li>
          </UL>

          <H2 id="events">{num()}Events, training and coaching</H2>
          <UL>
            <li>Webinars, bootcamps, live events, onboarding calls and coaching are educational. Dates, speakers and content may change.</li>
            <li>We may record live events and calls and use recordings for training and marketing; we will tell you when a session is recorded.</li>
            <li>Course and training materials are licensed to you for your own use and may not be shared, resold or republished.</li>
            <li>Results discussed in training, case studies or testimonials are not typical or guaranteed.</li>
          </UL>

          <H2 id="acceptable-use">{num()}Acceptable use</H2>
          <p>You agree not to, and not to let anyone else:</p>
          <UL>
            <li>Use the Services for any unlawful, fraudulent or deceptive purpose, including bid rigging, collusion, or misrepresenting your size, status, certifications or past performance</li>
            <li>Share your Account, credentials, API keys or connections with anyone not authorized under your Plan</li>
            <li>Resell, sublicense, rent or redistribute the Services or Output as a product or data feed, unless your Plan or a written agreement allows it</li>
            <li>Scrape, crawl, bulk-download or systematically extract data from the Services, including through AI assistants or API calls designed to copy our databases or proprietary content (such as playbooks, training or podcast material)</li>
            <li>Use the Services or Output to build or train a competing product or AI model</li>
            <li>Get around plan limits, credit charges, rate limits, access controls or security measures, or create multiple Accounts to obtain extra trials or free credits</li>
            <li>Attempt to gain unauthorized access to our systems, other users&apos; data, or connected accounts; probe, scan or test for vulnerabilities without our written permission</li>
            <li>Upload malware or content that is illegal, infringing, defamatory, harassing or that you have no right to share</li>
            <li>Interfere with or overload the Services, or use automated systems to access them except through tools and connections we provide</li>
            <li>Remove proprietary notices, or misrepresent Output as coming from the government or as an official record</li>
            <li>Impersonate any person or organization, including a government agency or official</li>
          </UL>

          <H2 id="fair-use">{num()}Fair use, limits and monitoring</H2>
          <UL>
            <li>Plans described as &quot;unlimited&quot; are subject to fair use for one normal user (or the number of users on your Plan). We may limit usage that is far above normal or that affects other users.</li>
            <li>We may set rate limits, daily caps and report limits, and may change them to protect the Services.</li>
            <li>We may monitor usage to enforce these Terms, prevent fraud and abuse, and keep the Services secure and reliable.</li>
          </UL>

          <H2 id="ip">{num()}Intellectual property</H2>
          <p>
            The Services, including the software, design, databases and compilations, maps, scoring methods, reports,
            training and podcast content, playbooks, and the names Mindy, GovCon Giants, M-Estimate, M-Win and related logos,
            are owned by GovConEdu LLC or its licensors and are protected by copyright, trademark, database and other laws.
            Public Data itself is not ours, but our selection, organization and enhancement of it are.
          </p>
          <p>
            Subject to these Terms and your Plan, we grant you a limited, non-exclusive, non-transferable, revocable license
            to use the Services for your own internal business purposes. You may use Output in your own business, including
            in proposals and in reports you share with your clients, but you may not republish our databases or proprietary
            content in bulk. All rights not expressly granted are reserved.
          </p>

          <H2 id="feedback">{num()}Feedback and beta features</H2>
          <UL>
            <li>If you send us ideas, suggestions or feedback, we may use them without restriction or payment to you.</li>
            <li>
              Features marked beta, preview, prototype or early access are provided as-is, may change or be removed at any
              time, and may not be supported. Do not rely on them for critical work.
            </li>
          </UL>

          <H2 id="privacy">{num()}Privacy and security</H2>
          <p>
            Our <A href="/privacy">Privacy Policy</A> explains how we collect, use and share personal information. We use
            reasonable safeguards to protect Your Content, but no system is completely secure, and we cannot guarantee that
            unauthorized access will never occur. You are responsible for your own devices, connections and backups.
          </p>

          <H2 id="government">{num()}Government contracting, compliance and export</H2>
          <UL>
            <li>
              You are solely responsible for complying with the laws and rules that apply to your contracting activities,
              including the Federal Acquisition Regulation (FAR), agency supplements, small business size and set-aside rules,
              SAM.gov registration, ethics, procurement integrity and organizational conflict of interest rules.
            </li>
            <li>
              If you are a government employee or contracting officer, use the Services only as your agency&apos;s rules
              allow. Mindy estimates and counts are tools for research, not substitutes for your agency&apos;s required
              analysis or official records.
            </li>
            <li>You may not use or export the Services in violation of U.S. export control and sanctions laws.</li>
            <li>We do not guarantee that you will win government contracts. Success depends on many factors outside our control.</li>
          </UL>

          <H2 id="termination">{num()}Suspension and termination</H2>
          <UL>
            <li>You may stop using the Services and close your Account at any time.</li>
            <li>
              We may suspend or terminate your access, remove content, revoke API keys or connections, or withhold credits if
              we reasonably believe you violated these Terms, failed to pay, created risk or legal exposure for us or others, or
              if required by law. Where reasonable, we will give notice first.
            </li>
            <li>We may discontinue a product or feature. If we discontinue a paid Plan you are on, we will give reasonable notice.</li>
            <li>
              When your Account ends, your right to use the Services stops, unused credits are forfeited, and we may delete Your
              Content after a reasonable period. Sections that by their nature should survive (including ownership, payment
              obligations, disclaimers, limitations of liability, indemnity and disputes) survive termination.
            </li>
          </UL>

          <H2 id="warranties">{num()}Disclaimer of warranties</H2>
          <p>
            THE SERVICES, OUTPUT AND PUBLIC DATA ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY
            KIND, WHETHER EXPRESS, IMPLIED OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, TITLE, NON-INFRINGEMENT AND ACCURACY. WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, TIMELY,
            SECURE OR ERROR-FREE, THAT DATA OR OUTPUT WILL BE ACCURATE OR COMPLETE, OR THAT ANY ALERT WILL BE DELIVERED.
          </p>
          <p>
            <strong className="text-(--mp-ink)">Government contracting disclaimer:</strong> Our tools and content are for
            educational and informational purposes only. We do not guarantee that you will win government contracts.
          </p>

          <H2 id="liability">{num()}Limitation of liability</H2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, GOVCONEDU LLC AND ITS OWNERS, OFFICERS, EMPLOYEES, CONTRACTORS, AGENTS,
            PARTNERS AND LICENSORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR
            PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, CONTRACTS, BIDS, BUSINESS OPPORTUNITIES, GOODWILL OR DATA,
            ARISING OUT OF OR RELATED TO THE SERVICES OR THESE TERMS, EVEN IF WE WERE ADVISED OF THE POSSIBILITY.
          </p>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THE
            SERVICES OR THESE TERMS IS LIMITED TO THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICES IN THE 12 MONTHS
            BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS ($100). Some jurisdictions do not allow
            certain limitations, so some of these may not apply to you.
          </p>

          <H2 id="indemnity">{num()}Indemnification</H2>
          <p>
            You agree to defend, indemnify and hold harmless GovConEdu LLC and its owners, officers, employees, contractors and
            agents from any claims, damages, losses, liabilities, costs and expenses (including reasonable attorneys&apos; fees)
            arising from (a) your use of the Services or Output, (b) Your Content, (c) your outreach to contacts, (d) proposals,
            bids or representations you submit, (e) your violation of these Terms or any law, or (f) your violation of anyone
            else&apos;s rights.
          </p>

          <H2 id="disputes">{num()}Disputes and governing law</H2>
          <UL>
            <li>
              These Terms are governed by the laws of the State of Georgia, United States, without regard to its conflict of law
              rules.
            </li>
            <li>
              Before filing a claim, you agree to contact us at admin@getmindy.ai and try to resolve the dispute informally for
              at least 30 days.
            </li>
            <li>
              Any dispute that is not resolved informally will be brought only in the state or federal courts located in Georgia,
              and you and we consent to the personal jurisdiction of those courts. Either party may bring an individual claim in
              small claims court if it qualifies.
            </li>
            <li>
              To the extent permitted by law, claims must be brought individually and not as a plaintiff or class member in any
              class or representative action.
            </li>
            <li>Any claim must be brought within one year after it arises, to the extent permitted by law.</li>
          </UL>

          <H2 id="changes">{num()}Changes to the Services and these Terms</H2>
          <UL>
            <li>We continuously change the Services, including adding, changing and removing features, data sources, tools and credit costs.</li>
            <li>
              We may update these Terms. We will post the updated Terms here and change the &quot;Last Updated&quot; date. For
              material changes, we will also give notice by email or in the Services. Changes apply from the date posted, or a
              later date we state.
            </li>
            <li>Your continued use of the Services after changes take effect means you accept them. If you do not agree, stop using the Services and cancel your Plan.</li>
          </UL>

          <H2 id="general">{num()}General terms</H2>
          <UL>
            <li><strong className="text-(--mp-ink)">Entire agreement.</strong> These Terms, the Privacy Policy and any program or order terms referenced here are the entire agreement between you and us about the Services.</li>
            <li><strong className="text-(--mp-ink)">Assignment.</strong> You may not assign these Terms without our written consent. We may assign them, including in a merger, acquisition or sale of assets.</li>
            <li><strong className="text-(--mp-ink)">Severability.</strong> If any part of these Terms is found unenforceable, the rest stays in effect, and the unenforceable part is enforced to the maximum extent allowed.</li>
            <li><strong className="text-(--mp-ink)">No waiver.</strong> Our failure to enforce a provision is not a waiver of it.</li>
            <li><strong className="text-(--mp-ink)">Force majeure.</strong> We are not responsible for delays or failures caused by events outside our reasonable control, including outages of government systems such as SAM.gov or of our service providers.</li>
            <li><strong className="text-(--mp-ink)">Independent parties.</strong> No partnership, joint venture, employment or agency relationship is created by these Terms.</li>
            <li><strong className="text-(--mp-ink)">Notices.</strong> We may send notices to the email on your Account or show them in the Services. You may send notices to admin@getmindy.ai.</li>
            <li><strong className="text-(--mp-ink)">Headings.</strong> Headings are for convenience only.</li>
          </UL>

          <H2 id="contact">{num()}Contact information</H2>
          <p>If you have questions about these Terms, please contact us:</p>
          <ul className="list-none space-y-1">
            <li><strong className="text-(--mp-ink)">GovConEdu LLC</strong> (GovCon Giants · Mindy)</li>
            <li>Email: admin@getmindy.ai</li>
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
