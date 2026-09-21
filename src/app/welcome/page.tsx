/**
 * /welcome — the INTENT ROUTER for a new account. NOT an onboarding surface.
 *
 * Built minimal on purpose (2026-08-25): the urgent failure was new accounts landing in
 * `/app/onboarding`, the legacy profile builder. The resolver
 * (`src/lib/mindy/post-signup-destination.ts`) now sends unknown-intent signups here, so
 * this route must exist and be a valid, useful destination TODAY.
 *
 * ⚠️ DELIBERATELY NOT BUILT YET: the full company-personalization flow. Designing it before
 * measuring which profile fields real users actually populate — and which have a downstream
 * consumer in matching, alerts, MCP or proposals — would just re-create 1,793 lines of
 * legacy onboarding in a new place. That measurement is the next audit.
 *
 * ⚠️ Company setup must NEVER be mandatory merely to browse the Map or connect MCP. Each
 * choice below is a peer, and the page is skippable by construction — every option is a
 * link out, none is a gate.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { safeNext } from '@/lib/mindy/safe-next';
import { ChoiceLink, type WelcomeChoice } from './choice-link';

export const metadata: Metadata = {
  title: 'Welcome to Mindy',
  description: 'Find federal opportunities, connect Mindy to your AI, or personalize it for your company.',
  robots: { index: false, follow: false },   // a post-signup router has no business in search
};

const CHOICES = [
  {
    href: '/opportunity-map',
    eyebrow: 'Explore the market',
    body: 'Find opportunities, forecasts, recompetes and the buyers behind them.',
    cta: 'Open the Map',
    primary: true,
    choice: 'explore_map' as WelcomeChoice,
  },
  {
    href: '/mcp/setup',
    eyebrow: 'Use Mindy in ChatGPT or Claude',
    body: "Connect Mindy's procurement intelligence to the AI you already use.",
    cta: 'Connect Mindy',
    primary: false,
    choice: 'connect_mcp' as WelcomeChoice,
  },
  {
    href: '/welcome/company',
    eyebrow: 'Personalize Mindy for my company',
    body: 'Tell Mindy what you sell so your market, alerts and recommendations get sharper.',
    cta: 'Set up my company',
    primary: false,
    choice: 'personalize_company' as WelcomeChoice,
  },
];

/**
 * ⚠️ THE ROUTER MUST NOT SWALLOW INTENT. A user can arrive here carrying a `next` — e.g.
 * an OAuth signup whose destination was unusable, or someone who reached /welcome from a
 * Maps action. Choosing "Explore the market" should return them THERE, not to a generic
 * map. `safeNext` validates it (it arrived in a user-editable URL) and rejects anything
 * pointing back at a legacy surface.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.next === 'string' ? sp.next : null;
  // Only the Map choice honours `next` — an MCP or company-setup choice is a NEW intent
  // the user just expressed, and overriding it with an old one would be the same
  // "ignore what they told us" mistake in a different place.
  const mapHref = raw ? safeNext(raw, '/opportunity-map') : '/opportunity-map';
  const carry = raw ? `?next=${encodeURIComponent(safeNext(raw, '/opportunity-map'))}` : '';

  return (
    <main className="min-h-dvh bg-[#0b1020] px-6 py-16 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">Welcome to Mindy</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">What would you like to do first?</h1>
        <p className="mt-3 text-base text-slate-300">
          You can do any of these now, and the rest whenever you like.
        </p>

        <ul className="mt-10 space-y-4">
          {CHOICES.map((c) => (
            <li key={c.href}>
              <ChoiceLink
                choice={c.choice}
                intent={typeof sp.intent === 'string' ? sp.intent : null}
                next={raw}
                href={
                  c.href === '/opportunity-map' ? mapHref
                  : c.href === '/welcome/company' ? `${c.href}${carry}`
                  : c.href
                }
                className={[
                  'block rounded-2xl border p-6 transition',
                  c.primary
                    ? 'border-emerald-500/60 bg-emerald-500/10 hover:border-emerald-400'
                    : 'border-white/10 bg-white/[0.04] hover:border-white/25',
                ].join(' ')}
              >
                <span className="text-lg font-semibold">{c.eyebrow}</span>
                <span className="mt-1 block text-sm text-slate-300">{c.body}</span>
                <span className={['mt-4 inline-block text-sm font-semibold', c.primary ? 'text-emerald-300' : 'text-slate-200'].join(' ')}>
                  {c.cta} →
                </span>
              </ChoiceLink>
            </li>
          ))}
        </ul>

        {/* Skippable by construction — nothing here gates the product. */}
        <p className="mt-10 text-sm text-slate-400">
          Not sure yet? <Link href={mapHref} className="text-emerald-300 underline underline-offset-4">Just show me the map</Link>.
        </p>
      </div>
    </main>
  );
}
