import Link from 'next/link';

export const metadata = {
  title: 'Mindy Enterprise — your data, your edge',
  description:
    'Enterprise adds a signed DPA, contractual zero-retention, SSO and audit logs, and an isolated workspace where your own past performance, teaming roster, and pipeline ground Mindy’s analysis.',
  robots: { index: true, follow: true },
};

/**
 * Enterprise program page — the paid tier that sits on top of /app/trust.
 *
 * WHY THIS LIVES UNDER /app/trust: prospects who ask "can our queries stay
 * private?" land on the trust page. That page's honest-scope section already
 * named organization-level workspaces as the thing we're building; this page is
 * where that link goes. Order matters — a reader sees the free, already-true
 * baseline FIRST, then the paid tier. Never the reverse, or every non-enterprise
 * user hears "so my data isn't private?" (see docs/PRD-data-trust-layer.md).
 *
 * THE HARD RULE (inherited from the Data Trust Layer PRD): make every claim TRUE
 * before publishing it. Capabilities are therefore explicitly marked `live` or
 * `building` and rendered with different pills. Do NOT relabel a `building` item
 * as live to make the page read better — the honesty IS the sales asset, and a
 * design-partner buyer is specifically buying influence over what gets built.
 *
 * Copy source of truth: docs/strategy/mindy-enterprise-onepager.md (keep in sync;
 * its internal note carries the verified DB facts behind the baseline claims).
 */

type Status = 'live' | 'building';

interface Capability {
  n: string;
  title: string;
  status: Status;
  lede?: string;
  points: { bold: string; rest: string }[];
  kicker?: string;
}

const CAPABILITIES: Capability[] = [
  {
    n: '1',
    title: 'Private Data Fusion',
    status: 'building',
    lede: 'An isolated workspace where you bring your own data alongside Mindy’s public and proprietary federal intelligence.',
    points: [
      {
        bold: 'Your past-performance library',
        rest: '— so bid/no-bid and capability analysis is grounded in what you’ve actually done',
      },
      {
        bold: 'Your teaming roster and relationships',
        rest: '— partner matching from your network, not a generic list',
      },
      {
        bold: 'Your active pipeline',
        rest: '— pursuits and stages, so Mindy’s read reflects your real position',
      },
    ],
    kicker:
      'Analysis no competitor can replicate, because it runs on assets only you have.',
  },
  {
    n: '2',
    title: 'Security & Trust',
    status: 'building',
    points: [
      {
        bold: 'A signed Data Processing Agreement',
        rest: 'and written data-handling terms',
      },
      {
        bold: 'Zero-retention, in writing',
        rest: '— billing already records counts, not the arguments you passed; Enterprise commits that contractually and bypasses our shared public-API response cache for your account',
      },
      {
        bold: 'SSO / SAML',
        rest: ', role-based access, and organization audit logs',
      },
      {
        bold: 'A security-review packet',
        rest: 'to fast-track your compliance team’s approval',
      },
    ],
    kicker:
      'Two-factor authentication, audit logging, login-abuse monitoring, and database-level row isolation are live today for every account — ask and we’ll send the full security overview.',
  },
  {
    n: '3',
    title: 'Capacity & Support',
    status: 'live',
    points: [
      {
        bold: 'A dedicated credit allotment and priority rate limits',
        rest: '— your agents never queue behind free traffic',
      },
      {
        bold: 'A multi-seat organization',
        rest: 'under one account, with shared billing',
      },
      {
        bold: 'A named account contact',
        rest: ', plus optional white-glove market workups delivered as a managed service',
      },
    ],
  },
];

const HOW: { term: string; detail: string }[] = [
  {
    term: 'Term',
    detail:
      'An annual agreement rather than metered credits — a predictable line item, not pay-as-you-go.',
  },
  {
    term: 'Boundary',
    detail:
      'An isolated tenant: your workspace, your data, your controls, walled from every other account.',
  },
  {
    term: 'Onboarding',
    detail:
      'The DPA and security packet are handled up front, so your team can green-light fast.',
  },
];

function StatusPill({ status }: { status: Status }) {
  if (status === 'live') {
    return (
      <span className="whitespace-nowrap rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
        Available now
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
      In build — design partners
    </span>
  );
}

export default function EnterprisePage() {
  return (
    <main className="min-h-screen bg-ground-deep text-slate-200">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link
          href="/app/trust"
          className="text-sm text-muted underline underline-offset-2 hover:text-ink-soft"
        >
          ← Data trust
        </Link>

        {/* Hero */}
        <div className="mt-6 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-emerald-400">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Enterprise program
        </div>
        <h1 className="mt-4 text-4xl font-bold text-white text-balance">
          Your data, your edge.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
          For teams that want Mindy’s federal-contracting intelligence grounded
          in their <span className="text-white">own private assets</span> — with
          the security controls and contractual terms an enterprise requires.
        </p>

        {/* The baseline — free, already true, and stated BEFORE the paid tier */}
        <section className="mt-12 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-6">
          <h2 className="text-lg font-semibold text-white">
            The baseline — already true, and it stays standard
          </h2>
          <p className="mt-3 leading-relaxed text-muted">
            <span className="text-white">
              When you use Mindy over MCP, connected to your own AI client, your
              strategy never reaches our servers.
            </span>{' '}
            The reasoning happens in your client and your model. Mindy only ever
            receives discrete public-data lookups: a NAICS code, an agency, a
            UEI. The comparison you’re actually making is assembled on your side,
            and we never see it.
          </p>
          <p className="mt-3 leading-relaxed text-muted">
            What we log for billing is the tool name, the credits it cost, and
            whether it succeeded —{' '}
            <span className="text-white">not the arguments you passed.</span>{' '}
            Those records are keyed to your account alone: never pooled across
            customers, never used to train anything shared.
          </p>
          <p className="mt-4 border-t border-emerald-500/20 pt-3 text-sm italic leading-relaxed text-slate-400">
            Using the Mindy web app instead is a different boundary — there, chat
            runs on our servers under the protections described on{' '}
            <Link
              href="/app/trust"
              className="underline underline-offset-2 hover:text-slate-300"
            >
              the data-trust page
            </Link>
            . Both are private to you; only MCP keeps the analysis itself
            entirely on your side.
          </p>
        </section>

        <p className="mt-4 rounded-xl bg-ground/50 px-6 py-4 text-center text-lg text-slate-300">
          Enterprise doesn’t unlock privacy — it{' '}
          <span className="font-semibold text-white">formalizes</span> it, and
          builds capability on top.
        </p>

        {/* What Enterprise adds */}
        <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-slate-500">
          What Enterprise adds
        </h2>
        <div className="mt-4 flex flex-col gap-4">
          {CAPABILITIES.map((c) => (
            <section
              key={c.n}
              className="rounded-xl border border-surface bg-ground/50 p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
                <h3 className="text-lg font-semibold text-white">
                  <span className="mr-2 text-slate-600">{c.n}</span>
                  {c.title}
                </h3>
                <StatusPill status={c.status} />
              </div>

              {c.lede && (
                <p className="mt-2 leading-relaxed text-muted">{c.lede}</p>
              )}

              <ul className="mt-3 flex flex-col gap-2">
                {c.points.map((p) => (
                  <li key={p.bold} className="flex gap-2.5 leading-relaxed">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600"
                    />
                    <span className="text-muted">
                      <span className="text-slate-200">{p.bold}</span> {p.rest}
                    </span>
                  </li>
                ))}
              </ul>

              {c.kicker && (
                <p className="mt-4 border-t border-surface pt-3 text-sm italic leading-relaxed text-slate-400">
                  {c.kicker}
                </p>
              )}
            </section>
          ))}
        </div>

        {/* How it works */}
        <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-slate-500">
          How it works
        </h2>
        <dl className="mt-4 flex flex-col gap-3">
          {HOW.map((h) => (
            <div
              key={h.term}
              className="flex flex-col gap-1 sm:flex-row sm:gap-4"
            >
              <dt className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500 sm:pt-1">
                {h.term}
              </dt>
              <dd className="leading-relaxed text-muted">{h.detail}</dd>
            </div>
          ))}
        </dl>

        {/* Design-partner program */}
        <section className="mt-12 rounded-xl border border-surface bg-ground/30 p-6">
          <h2 className="text-lg font-semibold text-white">
            Design-Partner Program
          </h2>
          <p className="mt-2 leading-relaxed text-muted">
            Mindy Enterprise is launching with a small number of design partners
            who help shape it. As an early partner you get:
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {[
              ['Founder pricing', 'locked for the term'],
              [
                'Direct input on the roadmap',
                '— the private-data and security capabilities get built around real requirements, starting with yours',
              ],
              ['First access', 'to each capability as it ships'],
            ].map(([bold, rest]) => (
              <li key={bold} className="flex gap-2.5 leading-relaxed">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600"
                />
                <span className="text-muted">
                  <span className="text-slate-200">{bold}</span> {rest}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-surface pt-3 text-sm italic leading-relaxed text-slate-400">
            Ideal for firms putting live pursuit strategy through Mindy who need
            their own data in the loop and their controls in writing.
          </p>
        </section>

        {/* Next step */}
        <div className="mt-10 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-6">
          <h2 className="text-base font-semibold text-white">Next step</h2>
          <p className="mt-2 leading-relaxed text-muted">
            A 20-minute scoping call to walk the data boundary, confirm which
            controls matter most to your team, and shape the design-partner
            terms.
          </p>
          <a
            href="mailto:support@getmindy.ai?subject=Mindy%20Enterprise%20%E2%80%94%20scoping%20call"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Request a scoping call
          </a>
        </div>

        <p className="mt-8 text-sm text-slate-600">
          Questions about how your data is handled today? Read{' '}
          <Link
            href="/app/trust"
            className="text-muted underline underline-offset-2 hover:text-ink-soft"
          >
            our data-trust promises
          </Link>{' '}
          or email{' '}
          <a
            href="mailto:support@getmindy.ai"
            className="text-muted underline underline-offset-2 hover:text-ink-soft"
          >
            support@getmindy.ai
          </a>
          .
        </p>
      </div>
    </main>
  );
}
