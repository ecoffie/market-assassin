import Link from 'next/link';

export const metadata = {
  title: 'Your data is yours — Mindy',
  description:
    'How Mindy protects the information in your vault: workspace isolation, database-level access control, no model training on your data, and one-click export or delete.',
  robots: { index: true, follow: true },
};

/**
 * Data Trust page (Phase 2). Customer-facing, plain-language. Every claim maps
 * to a shipped, verified control (Phase 1 enforcement) — no promise we can't
 * point to in code. Lives inside /app, matches the app's dark-slate theme.
 */

interface Promise {
  claim: string;
  how: string;
  detail: string;
}

const PROMISES: Promise[] = [
  {
    claim: 'Only you can see your vault',
    how: 'Database-level row security',
    detail:
      'Every company profile, past-performance record, capability, team member, and uploaded document is tied to your account and readable only by our authenticated server on your behalf. It is enforced by the database itself (row-level security), not just by app code — so even a bug can’t hand your data to anyone else.',
  },
  {
    claim: 'We don’t train AI models on your data',
    how: 'No-training provider tiers',
    detail:
      'When Mindy uses AI to help draft a proposal or match your evidence, your data is sent only to business API tiers that contractually do not train their models on it. Your vault is never used to improve a model that another company could query.',
  },
  {
    claim: 'The AI only ever sees your own data',
    how: 'Permission-filtered retrieval',
    detail:
      'When Mindy retrieves your capabilities and past performance to ground an answer, the search is scoped to your account at the source. The model is handed your rows and only your rows — it cannot reach across into anyone else’s vault.',
  },
  {
    claim: 'Your files stay private',
    how: 'Private storage, signed links',
    detail:
      'Resumes, capability statements, and pricing documents you upload go into private storage. They’re never public. Each download is served through a short-lived signed link that only you can request.',
  },
  {
    claim: 'You can export everything, anytime',
    how: 'One-click JSON export',
    detail:
      'Your vault is yours to take with you. Export your complete data as a single file whenever you want — no support ticket, no waiting.',
  },
  {
    claim: 'You can delete everything, anytime',
    how: 'Permanent, files included',
    detail:
      'Delete your vault yourself and it’s gone — every record and every uploaded file, permanently. If you close your account, your vault is removed with it.',
  },
];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
    >
      <circle cx="12" cy="12" r="11" fill="#10b981" fillOpacity="0.15" />
      <path
        d="M7.5 12.5l3 3 6-6.5"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TrustPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* Hero — the thesis, stated plainly */}
        <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-emerald-400">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Data trust
        </div>
        <h1 className="mt-4 text-4xl font-bold text-white text-balance">
          Your data is yours.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-400">
          You put your most sensitive information into Mindy — your company
          details, real contract history, team, and documents. Here’s exactly how
          we protect it, and what you can do with it. Every promise below is
          something we’ve built and can point to, not a slogan.
        </p>

        {/* Promises — claim → the mechanism that backs it */}
        <div className="mt-12 flex flex-col gap-4">
          {PROMISES.map((p) => (
            <section
              key={p.claim}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-6"
            >
              <div className="flex items-start gap-3">
                <CheckIcon />
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold text-white">
                      {p.claim}
                    </h2>
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                      {p.how}
                    </span>
                  </div>
                  <p className="mt-2 leading-relaxed text-slate-400">
                    {p.detail}
                  </p>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Honest scope — the measured note that builds more trust than overclaiming */}
        <section className="mt-10 rounded-xl border border-slate-800 bg-slate-900/30 p-6">
          <h2 className="text-base font-semibold text-white">
            What we’re still building
          </h2>
          <p className="mt-2 leading-relaxed text-slate-400">
            We’re honest about the roadmap. For teams and agencies that need it,
            we’re adding organization-level workspaces and, where a contract
            requires it, deployment inside your own government-authorized cloud
            environment. Mindy provides the secure application; your prime or
            hosting partner carries the FedRAMP boundary. Ask us — we’ll tell you
            exactly where a capability stands today.
          </p>
        </section>

        {/* Actions — the page is operable, not just readable */}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/app?panel=vault"
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Go to your vault
          </Link>
          <Link
            href="/privacy"
            className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-5 py-2.5 font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            Read the full privacy policy
          </Link>
        </div>

        <p className="mt-8 text-sm text-slate-600">
          Questions about how your data is handled? Email{' '}
          <a
            href="mailto:service@govcongiants.com"
            className="text-slate-400 underline underline-offset-2 hover:text-slate-300"
          >
            service@govcongiants.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
