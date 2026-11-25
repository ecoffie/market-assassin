'use client';

/**
 * /pricing — three plans, little text (modeled on Fyxer's pricing page, Nov 2026).
 * Pro and Team start a 14-day free trial (card required); Enterprise goes to sales.
 * No Free plan on this page. Credit allowances come from the server constants as props.
 *
 * Trial-click pass (2026-11-16): only ~4% of pricing visitors clicked a trial button, and all
 * three trials so far were Pro monthly. So the hero now leads with the free trial and its own
 * button, Pro is the highlighted plan, monthly billing is the default, and every trial button
 * says "$0 today" (the charge only comes after 14 days).
 * The credit-only MCP plans keep their own page at /mcp/pricing.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import MemberProof from '@/components/public-site/MemberProof';
import LogoMarquee from '@/components/public-site/LogoMarquee';
import NoRefundNote from '@/components/NoRefundNote';
import { trackTrialClick } from '@/lib/ga4';
import {
  TRIAL_UPGRADE_ENDPOINT, TRIAL_UPGRADE_SUCCESS_TEXT, TRIAL_UPGRADE_TITLE,
  trialUpgradeChargeNote, type TrialUpgradeOffer,
} from '@/lib/billing/trial-upgrade-offer';
import {
  PRO_ANNUAL_USD, PRO_MONTHLY_USD, PRO_TRIAL_ANNUAL, PRO_TRIAL_MONTHLY, SALES_URL,
  TEAM_ANNUAL_PER_MONTH, TEAM_ANNUAL_USD, TEAM_MONTHLY_USD, TEAM_TRIAL_ANNUAL, TEAM_TRIAL_MONTHLY, pctOff,
} from './app-plan-links';
// Team seat card (owner mockup 2026-11-25) — DISPLAY ONLY, PROPOSED, off unless
// NEXT_PUBLIC_TEAM_SEAT_PRICING === 'on'. Never reads billing; see team-seat-pricing.ts.
import {
  TEAM_SEAT_PRICING, isTeamSeatPricingEnabled, teamSeatCtaHref, teamSeatOption, teamSeatTakesPayment,
  type TeamSeatOptionId,
} from '@/lib/public-site/team-seat-pricing';

type Feature = [title: string, detail: React.ReactNode];
type Plan = {
  name: string; tag: string; featured?: boolean;
  price: string | null; was?: string; per: string; trial: boolean;
  cta: string; href: string; outline?: boolean;
  lead: string; base: string; features: Feature[];
  /** Omitted = no allowance to show (never a made-up number). */
  usage?: [title: string, detail: string];
  /** A non-trial button that still takes money (gets the no-refund note). */
  takesPayment?: boolean;
  footer?: React.ReactNode;
  /** Set for signed-in users: this card is the plan they are on now. */
  current?: boolean;
};

type MePlan = 'free' | 'pro' | 'team' | 'enterprise';
const PLAN_NAME: Record<MePlan, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
const BILLING_URL = '/app?panel=settings&section=credits&tab=billing';
const RANK: Record<string, number> = { Pro: 1, Team: 2, Enterprise: 3 };
const PLAN_RANK: Record<MePlan, number> = { free: 0, pro: 1, team: 2, enterprise: 3 };

/**
 * Signed-in view (Eric 2026-11-13: "when i click to upgrade it does not show the current plan").
 * The plan's own card says "Your plan" with a non-link "Current plan" button; a paying member is
 * never sent to another trial checkout — a higher plan says "Upgrade to …" and a lower one
 * "Manage your plan", both to billing. Free / signed-out users see the page unchanged.
 */
export function applyCurrentPlan(plans: Plan[], me: MePlan | null): Plan[] {
  if (!me || me === 'free') return plans;
  const mine = PLAN_RANK[me];
  return plans.map((p) => {
    const r = RANK[p.name] ?? 0;
    if (r === mine) return { ...p, current: true, trial: false };
    if (p.name === 'Enterprise') return p; // stays "Speak to sales"
    return { ...p, trial: false, href: BILLING_URL, cta: r > mine ? `Upgrade to ${p.name}` : 'Manage your plan' };
  });
}

/**
 * The trial offer to show on the signed-in user's current-plan card: their Stripe trial for
 * that same plan, if the server returned one. Partner (no-card) trials have no Stripe
 * subscription, so the server returns no offer and nothing is shown.
 */
export function trialOfferForCard(planName: string, me: MePlan | null, offers: TrialUpgradeOffer[] | null): TrialUpgradeOffer | null {
  if (!me || !offers?.length) return null;
  if (PLAN_NAME[me] !== planName) return null;
  return offers.find((o) => o.tier === me) ?? null;
}

/** "Upgrade now, get +500 credits" on the current-plan card, with a confirm step. */
function TrialUpgradeBox({ offer, email, token, onDone }: {
  offer: TrialUpgradeOffer; email: string; token: string; onDone: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(TRIAL_UPGRADE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': token },
        credentials: 'same-origin',
        body: JSON.stringify({ email, subscriptionId: offer.subscriptionId }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) onDone();
      else setErr(j?.error || 'Could not upgrade right now. Nothing was charged.');
    } catch {
      setErr('Could not upgrade right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tu" data-testid="pricing-trial-upgrade">
      <p className="tu-h">{TRIAL_UPGRADE_TITLE}</p>
      <p className="tu-n">{trialUpgradeChargeNote(offer.amount, offer.interval)}</p>
      {confirm ? (
        <div className="tu-row">
          <button type="button" className="tu-go" onClick={go} disabled={busy}>{busy ? 'Upgrading…' : 'Confirm: charge my card now'}</button>
          <button type="button" className="tu-no" onClick={() => setConfirm(false)} disabled={busy}>Keep my trial</button>
        </div>
      ) : (
        <button type="button" className="tu-go" onClick={() => setConfirm(true)}>Upgrade now</button>
      )}
      <NoRefundNote style={{ margin: '8px 0 0' }} />
      {err && <p className="tu-err" role="alert">{err}</p>}
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** A credit-only (MCP) plan for the dropdown under the cards. */
export type CreditPlan = {
  id: string; label: string; credits: number;
  monthlyUsd: number; monthlyHref: string;
  annualPerMonthUsd: number | null; annualHref: string | null;
};

/**
 * "Only need Mindy in your AI?" — the credit-only plans as a dropdown on /pricing instead of a
 * link to a separate page (Eric 2026-11-16). Follows the page's Monthly/Annual toggle.
 */
function CreditPlansDropdown({ plans, annual }: { plans: CreditPlan[]; annual: boolean }) {
  if (!plans.length) return null;
  return (
    <details className="credits-dd" data-testid="credit-plans-dropdown">
      <summary>Only need Mindy inside Claude, ChatGPT or Cursor? <span>See credit-only plans</span></summary>
      <div className="cdd-grid">
        {plans.map((p) => {
          const useAnnual = annual && p.annualPerMonthUsd != null && !!p.annualHref;
          return (
            <div className="cdd-card" key={p.id}>
              <h3>{p.label}</h3>
              <div className="cdd-price"><b>${fmt(useAnnual ? p.annualPerMonthUsd! : p.monthlyUsd)}</b><span>/ mo{useAnnual ? ', billed annually' : ''}</span></div>
              <p className="cdd-cr">{fmt(p.credits)} credits / month</p>
              <a className="cta outline" href={useAnnual ? p.annualHref! : p.monthlyHref}>Get {p.label}</a>
              <NoRefundNote />
            </div>
          );
        })}
      </div>
      <p className="cdd-fine">Same tools on every plan; you&apos;re charged only for successful calls. No app included. <Link href="/mcp/pricing">Compare credit plans in detail</Link>.</p>
    </details>
  );
}

/**
 * "2 users | 5 users" on the Team card (seat variant only). A radio group: one tab stop, arrow
 * keys move and select, aria-checked carries the state. Server-renders the default (2 users), so
 * without JavaScript the card is complete and correct; the toggle only changes the price, button
 * and first feature.
 */
export function TeamSeatToggle({ value, onChange }: { value: TeamSeatOptionId; onChange: (id: TeamSeatOptionId) => void }) {
  const opts = TEAM_SEAT_PRICING.options;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, step: number) => {
    const i = (from + step + opts.length) % opts.length;
    onChange(opts[i].id);
    refs.current[i]?.focus();
  };
  return (
    <div className="seat-pick" role="radiogroup" aria-label="Team size" data-testid="team-seat-toggle">
      {opts.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            className={on ? 'on' : ''} data-seat={o.id}
            ref={(el) => { refs.current[i] = el; }}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

type Cell = boolean | string;
type CompareGroup = [group: string, rows: Array<[label: React.ReactNode, pro: Cell, team: Cell, ent: Cell]>];

export default function SimplePricing({ proCredits, teamCredits, forecastsLabel, faqs, creditPlans = [] }: {
  proCredits: number; teamCredits: number; forecastsLabel: string; faqs: { q: string; a: string }[];
  creditPlans?: CreditPlan[];
}) {
  const [annual, setAnnual] = useState(false);
  // Team seat card (held behind NEXT_PUBLIC_TEAM_SEAT_PRICING until Eric approves). Display only.
  const seatOn = isTeamSeatPricingEnabled();
  const [seatId, setSeatId] = useState<TeamSeatOptionId>(TEAM_SEAT_PRICING.defaultOption);
  const seatOpt = seatOn ? teamSeatOption(seatId) : null;
  // Same token every Mindy page sends; /api/app/me verifies it server-side. Any failure leaves the
  // public page as is (never guesses a plan).
  const [me, setMe] = useState<MePlan | null>(null);
  // A signed-in Pro/Team user in a Stripe trial may upgrade now for bonus credits. Looked up
  // only for those plans; any failure shows no offer (never a guessed one).
  const [session, setSession] = useState<{ email: string; token: string } | null>(null);
  const [offers, setOffers] = useState<TrialUpgradeOffer[] | null>(null);
  const [upgraded, setUpgraded] = useState(false);
  useEffect(() => {
    let t: string | null = null;
    try { t = localStorage.getItem('mi_beta_auth_token'); } catch { /* private mode */ }
    if (!t) return;
    const token = t;
    let live = true;
    fetch('/api/app/me', { headers: { 'x-mi-auth-token': token }, credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d?.email || !d.plan || !(d.plan in PLAN_NAME)) return;
        setMe(d.plan as MePlan);
        if (d.plan !== 'pro' && d.plan !== 'team') return;
        setSession({ email: d.email, token });
        return fetch(`${TRIAL_UPGRADE_ENDPOINT}?email=${encodeURIComponent(d.email)}`, {
          headers: { 'x-mi-auth-token': token }, credentials: 'same-origin',
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((o) => { if (live && o?.success && Array.isArray(o.offers)) setOffers(o.offers as TrialUpgradeOffer[]); });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const maxPct = pctOff(TEAM_ANNUAL_USD, TEAM_MONTHLY_USD);

  const basePlans: Plan[] = [
    {
      // The seat variant moves "Most popular" + the highlighted border to Team (owner mockup).
      name: 'Pro', tag: 'For solo contractors and small firms going after federal work.', featured: !seatOn,
      price: annual ? `$${fmt(Math.round(PRO_ANNUAL_USD / 12))}` : `$${PRO_MONTHLY_USD}`,
      was: annual ? `$${PRO_MONTHLY_USD}` : undefined,
      per: annual ? '/ mo, billed annually' : '/ mo, billed monthly', trial: true,
      cta: 'Start free trial', href: annual ? PRO_TRIAL_ANNUAL : PRO_TRIAL_MONTHLY,
      lead: 'Find and win your own contracts.', base: 'Everything you need to start',
      features: [
        ['Opportunities matched to you', <>Daily alerts and briefings for the industries, keywords and agencies you choose (industries are set by <Link href="/glossary/naics-code">NAICS codes</Link>).</>],
        ['Contracts coming back, 12 months out', <>Contracts the government will bid again (<Link href="/glossary/recompete">recompetes</Link>), with the company that holds the contract now.</>],
        ['Market research', 'Who buys, who wins and what they spend.'],
        ['Mindy in your AI', 'Use Mindy inside Claude, ChatGPT or Cursor.'],
      ],
      usage: ['Monthly usage included', `${fmt(proCredits)} credits / month`],
    },
    {
      name: 'Team', tag: 'Built for business development teams working several markets at once.',
      price: annual ? `$${fmt(TEAM_ANNUAL_PER_MONTH)}` : `$${TEAM_MONTHLY_USD}`,
      was: annual ? `$${TEAM_MONTHLY_USD}` : undefined,
      per: annual ? '/ mo, billed annually' : '/ mo, billed monthly', trial: true,
      cta: 'Start free trial', href: annual ? TEAM_TRIAL_ANNUAL : TEAM_TRIAL_MONTHLY,
      lead: 'Win more as a team.', base: 'All Pro features, plus',
      features: [
        ['Up to 5 users', 'One plan for your whole team.'],
        ['Shared pipeline', 'Everyone sees the same pursuits and deadlines.'],
        ['Team dashboard and roles', 'See who is working what.'],
        ['Onboarding call', 'We set up your markets with you.'],
      ],
      usage: ['Monthly usage included', `${fmt(teamCredits)} credits / month, shared by the team`],
      footer: <>10 or more users? <a href={SALES_URL}>Talk to us for a volume quote</a></>,
    },
    {
      name: 'Enterprise', tag: 'For large prime contractors, APEX Accelerators (government contracting help centers) and agencies rolling Mindy out at scale.',
      price: null, per: 'Annual contract, priced for your organization', trial: false,
      cta: 'Speak to sales', href: SALES_URL, outline: true,
      lead: 'Fit Mindy to your organization.', base: 'All Team features, plus',
      features: [
        ['Seats for every client or sub', 'Roll out to your whole program on one invoice.'],
        ['API and data feeds', 'High-volume access for your own tools.'],
        ['Contract terms', 'SSO, service levels and a dedicated manager.'],
      ],
      usage: ['Monthly usage included', 'Agreed in your contract'],
    },
  ];

  // Team seat card (owner mockup): the chosen size sets the Team card's price, button and first
  // feature. Monthly only, no trial line, no credit allowance (none approved — never a made-up
  // number). The button goes to its configured checkout, or to sales while that is empty.
  const withSeats = (p: Plan): Plan => (p.name !== 'Team' || !seatOpt ? p : {
    ...p,
    featured: true,
    price: `$${fmt(seatOpt.monthlyUsd)}`,
    was: undefined,
    per: seatOpt.per,
    trial: false,
    takesPayment: teamSeatTakesPayment(seatOpt),
    cta: seatOpt.cta,
    href: teamSeatCtaHref(seatOpt),
    lead: TEAM_SEAT_PRICING.lead,
    base: TEAM_SEAT_PRICING.base,
    features: [seatOpt.firstFeature, ...TEAM_SEAT_PRICING.features],
    usage: undefined,
    footer: undefined,
  });
  const plans = applyCurrentPlan(basePlans.map(withSeats), me);
  const byName = Object.fromEntries(plans.map((p) => [p.name, p]));

  // Full breakdown (Fyxer's "A plan to suit every need"). Same claims as the cards above and the
  // old plan cards: change a feature here only when the product changes.
  const compare: CompareGroup[] = [
    ['Find opportunities', [
      ['Daily opportunity alerts', true, true, true],
      ['AI-matched daily briefings', true, true, true],
      [<>Unlimited industries (<Link href="/glossary/naics-code">NAICS codes</Link>) and keywords</>, true, true, true],
      ['Target agency filtering', true, true, true],
      ['Weekly market deep dives', true, true, true],
    ]],
    ['Competitive intelligence', [
      [<>Alerts on contracts coming back to bid (<Link href="/glossary/recompete">recompetes</Link>), 12 months out</>, true, true, true],
      ['The company that holds the contract now', true, true, true],
      ['Competitor tracking', true, true, true],
      ['Agency spending analysis', true, true, true],
      [`${forecastsLabel} agency forecasts`, true, true, true],
    ]],
    ['Mindy in your AI', [
      ['Use Mindy in Claude, ChatGPT or Cursor', true, true, true],
      // Seat variant: today's Team allowance belongs to today's $499 plan, and no per-seat allowance
      // is approved, so the Team cell says so instead of showing a number (unknown is never zero).
      ['Monthly credits', `${fmt(proCredits)}`, seatOn ? 'To be confirmed' : `${fmt(teamCredits)}, shared`, 'Custom'],
      ['High-volume API and data feeds', false, false, true],
    ]],
    ['Team', [
      ['Users', '1', 'Up to 5', 'Custom'],
      ['Shared pipeline and pursuits', false, true, true],
      ['Team dashboard', false, true, true],
      ['Role-based access', false, true, true],
    ]],
    ['Support', [
      ['Email support', true, true, true],
      ['Priority response (24 hours)', true, true, true],
      ['Onboarding call', false, true, true],
      ['SSO, service levels and a dedicated manager', false, false, true],
    ]],
  ];
  const cell = (c: Cell) => (c === true ? <span className="yes" aria-label="Included">✓</span>
    : c === false ? <span className="no" aria-label="Not included">—</span> : <span>{c}</span>);

  return (
    <main className="sp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {seatOn ? (
        <>
          {/* Own style tag, so the live page's CSS (and its rendered output) is untouched when off. */}
          <style dangerouslySetInnerHTML={{ __html: SEAT_CSS }} />
          <section className="hero" data-testid="seat-pricing-header">
            <h1>{TEAM_SEAT_PRICING.header.title}</h1>
            <p className="sub">{TEAM_SEAT_PRICING.header.sub}</p>
            {me && <p className="you">You&apos;re on the <b>{PLAN_NAME[me]}</b> plan.{me !== 'free' && <> <a href={BILLING_URL}>Manage billing</a></>}</p>}
          </section>
        </>
      ) : (
      <section className="hero">
        <h1>Try Mindy Pro free for 14 days</h1>
        {(!me || me === 'free') && (
          <>
            <p className="sub">$0 today. Cancel anytime before day 14 and you won&apos;t be charged.</p>
            <a className="cta hero-cta" href={annual ? PRO_TRIAL_ANNUAL : PRO_TRIAL_MONTHLY}
              onClick={() => trackTrialClick('pro', annual ? 'annual' : 'monthly', 'hero')}>Start my free trial</a>
            <NoRefundNote style={{ margin: '8px 0 0' }} />
          </>
        )}
        {me ? (
          <p className="you">You&apos;re on the <b>{PLAN_NAME[me]}</b> plan.{me !== 'free' && <> <a href={BILLING_URL}>Manage billing</a></>}</p>
        ) : <MemberProof />}
      </section>
      )}

      {/* The seat variant is monthly only (owner mockup: "Monthly. Annual plans include training and onboarding."). */}
      {!seatOn && (
      <div className="toggle" role="group" aria-label="Billing period">
        <button type="button" className={!annual ? 'on' : ''} aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
        <button type="button" className={annual ? 'on' : ''} aria-pressed={annual} onClick={() => setAnnual(true)}>Annual (up to {maxPct}% off)</button>
      </div>
      )}

      <section className="cards" id="plans">
        {plans.map((p) => (
          <article key={p.name} className={`card ${p.featured ? 'featured' : ''} ${p.current ? 'current' : ''}`}>
            <h2>{p.name}{p.current ? <span className="mine">Your plan</span> : p.featured && <span className="pop">Most popular</span>}</h2>
            <p className="tag">{p.tag}</p>
            {p.name === 'Team' && seatOpt && !p.current && <TeamSeatToggle value={seatOpt.id} onChange={setSeatId} />}
            {p.price ? (
              <div className="price"><span className="now">{p.price}</span>{p.was && <span className="was">{p.was}</span>}</div>
            ) : (
              <div className="price"><span className="now sales">Speak to sales</span></div>
            )}
            <p className="per">{p.per}</p>
            {p.trial && <p className="trial"><b>$0 today</b> · 14 days free</p>}
            {p.current
              ? <span className="cta is-current" aria-current="true">Current plan</span>
              : <a className={`cta ${p.outline ? 'outline' : ''}`} href={p.href} onClick={p.trial ? () => trackTrialClick(p.name === 'Team' ? 'team' : 'pro', annual ? 'annual' : 'monthly', 'card') : undefined}>{p.cta}</a>}
            {p.current && upgraded && <p className="tu-ok" role="status">{TRIAL_UPGRADE_SUCCESS_TEXT}</p>}
            {p.current && !upgraded && session && (() => {
              const offer = trialOfferForCard(p.name, me, offers);
              return offer ? <TrialUpgradeBox offer={offer} email={session.email} token={session.token} onDone={() => { setUpgraded(true); setOffers([]); }} /> : null;
            })()}
            {/* Next to every button that takes money (Eric 2026-11-12: "add the no refunds line under each trial button"). */}
            {(p.trial || (p.takesPayment && !p.current)) && <NoRefundNote style={{ margin: '-14px 0 18px' }} />}
            <p className="lead">{p.lead}</p>
            <p className="base">{p.base}</p>
            <ul>
              {p.features.map(([t, d]) => (
                <li key={t}><span className="tick" aria-hidden="true">✓</span><span><b>{t}</b><small>{d}</small></span></li>
              ))}
            </ul>
            {p.usage && <div className="usage"><span className="ul">{p.usage[0]}</span><b>{p.usage[1]}</b></div>}
            {p.footer && <p className="foot">{p.footer}</p>}
          </article>
        ))}
      </section>

      {seatOn && (
        <p className="seat-foot">{TEAM_SEAT_PRICING.footer} <a href={`mailto:${TEAM_SEAT_PRICING.contactEmail}`}>{TEAM_SEAT_PRICING.contactEmail}</a></p>
      )}

      <p className="fine">
        Card required for the trial. No charge for 14 days, and you can cancel anytime before it ends.
        After that, all sales final.
      </p>

      <CreditPlansDropdown plans={creditPlans} annual={annual} />

      <LogoMarquee />

      <section className="cmp" aria-labelledby="cmp-h">
        <h2 id="cmp-h">A plan to suit every need</h2>
        <div className="cmp-scroll">
          <table>
            <thead>
              <tr><th scope="col"><span className="sr">Feature</span></th><th scope="col">Pro</th><th scope="col" className="hl">Team</th><th scope="col">Enterprise</th></tr>
            </thead>
            {compare.map(([group, rows]) => (
              <tbody key={group}>
                <tr className="grp"><th scope="rowgroup" colSpan={4}>{group}</th></tr>
                {rows.map(([label, a, b, c], i) => (
                  <tr key={i}><th scope="row">{label}</th><td>{cell(a)}</td><td className="hl">{cell(b)}</td><td>{cell(c)}</td></tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr><th scope="row"><span className="sr">Get started</span></th>
                {(['Pro', 'Team', 'Enterprise'] as const).map((n) => {
                  const p = byName[n];
                  return (
                    <td key={n} className={n === 'Team' ? 'hl' : undefined}>
                      {p.current
                        ? <span className="cta is-current" aria-current="true">Current plan</span>
                        : <a className={`cta ${p.outline ? 'outline' : ''}`} href={p.href} onClick={p.trial ? () => trackTrialClick(n === 'Team' ? 'team' : 'pro', annual ? 'annual' : 'monthly', 'table') : undefined}>{p.cta}</a>}
                      {(p.trial || (p.takesPayment && !p.current)) && <NoRefundNote />}
                    </td>
                  );
                })}</tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="faq">
        <h2>Questions</h2>
        {faqs.map((f) => (
          <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
        ))}
      </section>
    </main>
  );
}

const CSS = `
.sp{max-width:1120px;margin:0 auto;padding:56px 16px 80px;font-family:var(--mp-font-sans);color:var(--mp-ink)}
.sp .hero{text-align:center;margin-bottom:28px}
.sp .hero h1{font-family:var(--mp-font-serif);font-weight:700;font-size:clamp(40px,6vw,68px);line-height:1.05;letter-spacing:-.02em;margin:0}
.sp .toggle{display:flex;justify-content:center;gap:4px;margin:0 auto 32px;padding:4px;width:max-content;max-width:100%;border:1px solid var(--mp-line);border-radius:999px;background:var(--mp-surface)}
.sp .toggle button{border:0;background:transparent;padding:8px 18px;border-radius:999px;font:500 14px var(--mp-font-sans);color:var(--mp-muted);cursor:pointer}
.sp .toggle button.on{background:var(--mp-navy);color:var(--mp-surface)}
.sp .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:stretch}
@media (max-width:900px){.sp .cards{grid-template-columns:1fr}}
.sp .card{display:flex;flex-direction:column;background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:18px;padding:28px}
.sp .card.featured{border:2px solid var(--mp-navy)}
.sp .card h2{font-family:var(--mp-font-serif);font-size:28px;font-weight:700;margin:0 0 10px}
.sp .tag{color:var(--mp-muted);font-size:15px;line-height:1.5;margin:0 0 22px;min-height:45px}
.sp .price{display:flex;align-items:baseline;gap:8px}
.sp .price .now{font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1}
.sp .price .now.sales{font-family:var(--mp-font-serif);font-size:32px}
.sp .price .was{color:var(--mp-faint);font-size:16px;text-decoration:line-through}
.sp .per{color:var(--mp-muted);font-size:14px;margin:6px 0 0}
.sp .trial{font-size:14px;margin:6px 0 0;color:var(--mp-ink)}
.sp .cta{display:block;text-align:center;margin:18px 0 24px;padding:12px 16px;border-radius:10px;background:var(--mp-navy);color:var(--mp-surface);font-weight:600;text-decoration:none}
.sp .cta:hover{background:var(--mp-navy-hover)}
.sp .cta.outline{background:transparent;color:var(--mp-ink);border:1.5px solid var(--mp-ink)}
.sp .cta.outline:hover{background:var(--mp-wash)}
.sp .cta.is-current{background:var(--mp-wash);color:var(--mp-muted);border:1px solid var(--mp-line);cursor:default}
.sp .card.current{border:2px solid var(--mp-ok)}
.sp .card h2 .mine{margin-left:10px;vertical-align:middle;font:600 12px var(--mp-font-sans);color:var(--mp-ok);border:1px solid var(--mp-ok);border-radius:999px;padding:3px 10px}
.sp .tu{margin:-8px 0 22px;border:1px solid var(--mp-ok-line);border-radius:12px;padding:14px 16px;background:var(--mp-ok-bg)}
.sp .tu-h{margin:0;font-weight:600;font-size:15px}
.sp .tu-n{margin:4px 0 10px;font-size:13px;color:var(--mp-body);line-height:1.5}
.sp .tu-row{display:flex;flex-wrap:wrap;gap:8px}
.sp .tu-go{border:0;border-radius:10px;padding:10px 14px;background:var(--mp-navy);color:var(--mp-surface);font:600 14px var(--mp-font-sans);cursor:pointer}
.sp .tu-go:hover{background:var(--mp-navy-hover)}
.sp .tu-go:disabled,.sp .tu-no:disabled{opacity:.6;cursor:default}
.sp .tu-no{border:1px solid var(--mp-line);border-radius:10px;padding:10px 14px;background:var(--mp-surface);color:var(--mp-ink);font:500 14px var(--mp-font-sans);cursor:pointer}
.sp .tu-err{margin:8px 0 0;font-size:13px;color:var(--mp-warn)}
.sp .tu-ok{margin:-8px 0 22px;font-size:14px;color:var(--mp-ok);font-weight:600}
.sp .you{margin:14px 0 0;font-size:16px;color:var(--mp-body)}
.sp .hero .sub{margin:14px auto 0;font-size:18px;line-height:1.5;color:var(--mp-body);max-width:560px}
.sp .hero .hero-cta{display:inline-block;margin:20px 0 0;padding:14px 32px;font-size:17px}
.sp .hero .hero-cta + p{max-width:420px;margin-left:auto !important;margin-right:auto !important}
.sp .card h2 .pop{margin-left:10px;vertical-align:middle;font:600 12px var(--mp-font-sans);color:var(--mp-navy);border:1px solid var(--mp-navy);border-radius:999px;padding:3px 10px}
.sp .you a{color:var(--mp-navy);margin-left:6px}
.sp .lead{font-weight:600;margin:0}
.sp .base{color:var(--mp-muted);font-size:13px;margin:2px 0 12px}
.sp .card ul{list-style:none;margin:0 0 22px;padding:0;display:grid;gap:12px}
.sp .card li{display:flex;gap:10px;font-size:14px;line-height:1.4}
.sp .card li .tick{color:var(--mp-ok);font-weight:700}
.sp .card li b{display:block;font-weight:600}
.sp .card li small{display:block;color:var(--mp-muted);font-size:13px}
.sp .card li small a,.sp .cmp th[scope=row] a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.sp .usage{margin-top:auto;border:1px solid var(--mp-line);border-radius:12px;padding:14px 16px;background:var(--mp-wash);display:grid;gap:4px}
.sp .usage .ul{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mp-muted)}
.sp .usage b{font-size:14px;font-weight:600}
.sp .foot{text-align:center;font-size:14px;color:var(--mp-muted);margin:16px 0 0}
.sp .foot a,.sp .fine a{color:var(--mp-navy)}
.sp .fine{text-align:center;color:var(--mp-muted);font-size:13px;line-height:1.6;max-width:640px;margin:28px auto 0}
.sp .credits-dd{max-width:900px;margin:24px auto 0;border:1px solid var(--mp-line);border-radius:14px;background:var(--mp-surface)}
.sp .credits-dd summary{cursor:pointer;padding:16px 20px;font-size:15px;color:var(--mp-body);text-align:center;list-style:none}
.sp .credits-dd summary::-webkit-details-marker{display:none}
.sp .credits-dd summary span{color:var(--mp-navy);font-weight:600;margin-left:6px}
.sp .credits-dd summary span::after{content:' ▾'}
.sp .credits-dd[open] summary span::after{content:' ▴'}
.sp .cdd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:4px 20px 8px}
@media (max-width:700px){.sp .cdd-grid{grid-template-columns:1fr}}
.sp .cdd-card{border:1px solid var(--mp-line);border-radius:12px;padding:18px;background:var(--mp-wash)}
.sp .cdd-card h3{margin:0;font-family:var(--mp-font-serif);font-size:20px}
.sp .cdd-price{display:flex;align-items:baseline;gap:6px;margin:8px 0 0}
.sp .cdd-price b{font-size:28px}
.sp .cdd-price span{color:var(--mp-muted);font-size:13px}
.sp .cdd-cr{margin:4px 0 0;font-size:14px;font-weight:600}
.sp .cdd-card .cta{margin:14px 0 4px}
.sp .seat-pick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:4px;margin:0 0 14px;border-radius:12px;background:var(--mp-wash)}
.sp .seat-pick button{min-height:44px;border:0;border-radius:9px;background:transparent;font:inherit;font-size:14px;font-weight:600;color:var(--mp-muted);cursor:pointer}
.sp .seat-pick button.on{background:var(--mp-surface);color:var(--mp-ink);box-shadow:0 1px 3px rgba(18,16,14,.12)}
.sp .seat-pick button:focus-visible{outline:3px solid var(--mp-navy);outline-offset:2px}
.sp .cdd-fine{margin:0;padding:8px 20px 18px;text-align:center;font-size:13px;color:var(--mp-muted)}
.sp .cdd-fine a{color:var(--mp-navy)}
.sp .cmp{margin:80px 0 0}
.sp .cmp h2{font-family:var(--mp-font-serif);font-size:clamp(28px,3.4vw,40px);font-weight:700;text-align:center;margin:0 0 28px}
.sp .cmp-scroll{overflow-x:auto;border:1px solid var(--mp-line);border-radius:18px;background:var(--mp-surface)}
.sp .cmp table{width:100%;min-width:640px;border-collapse:collapse;font-size:14px}
.sp .cmp th,.sp .cmp td{padding:14px 18px;border-bottom:1px solid var(--mp-hair);text-align:center;vertical-align:middle}
.sp .cmp th[scope=row]{text-align:left;font-weight:500;color:var(--mp-body);width:40%}
.sp .cmp thead th{font-family:var(--mp-font-serif);font-size:22px;font-weight:700;padding:22px 18px;color:var(--mp-ink)}
.sp .cmp .grp th{text-align:left;font-size:16px;font-weight:700;color:var(--mp-ink);padding-top:26px;background:var(--mp-surface)}
.sp .cmp .hl{background:var(--mp-navy-wash)}
.sp .cmp .yes{color:var(--mp-ok);font-weight:700;font-size:16px}
.sp .cmp .no{color:var(--mp-faint)}
.sp .cmp tfoot td,.sp .cmp tfoot th{border-bottom:0;padding:20px 14px}
.sp .cmp tfoot .cta{margin:0}
.sp .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.sp .faq{max-width:760px;margin:64px auto 0}
.sp .faq h2{font-family:var(--mp-font-serif);font-size:32px;font-weight:700;text-align:center;margin:0 0 20px}
.sp details{border-top:1px solid var(--mp-line);padding:16px 0}
.sp details:last-child{border-bottom:1px solid var(--mp-line)}
.sp summary{cursor:pointer;font-weight:600}
.sp details p{color:var(--mp-body);line-height:1.6;margin:10px 0 0}
`;

/** Seat variant only (rendered in its own <style> tag when NEXT_PUBLIC_TEAM_SEAT_PRICING is on). */
const SEAT_CSS = `
.sp .seat-pick{display:flex;gap:4px;margin:0 0 18px;padding:4px;width:100%;max-width:280px;border:1px solid var(--mp-line);border-radius:999px;background:var(--mp-wash)}
.sp .seat-pick button{flex:1 1 0;min-height:40px;border:0;background:transparent;padding:8px 12px;border-radius:999px;font:500 14px var(--mp-font-sans);color:var(--mp-muted);cursor:pointer;white-space:nowrap}
.sp .seat-pick button.on{background:var(--mp-navy);color:var(--mp-surface)}
.sp .seat-pick button:focus-visible{outline:2px solid var(--mp-navy);outline-offset:2px}
.sp .seat-foot{text-align:center;margin:28px 0 0;font-size:15px;color:var(--mp-body)}
.sp .seat-foot a{color:var(--mp-navy);font-weight:600;overflow-wrap:anywhere}
`;
