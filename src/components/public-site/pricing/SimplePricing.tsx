'use client';

/**
 * /pricing — three plans, little text (modeled on Fyxer's pricing page, Nov 2026).
 * Pro and Team start a 14-day free trial (card required); Enterprise goes to sales.
 * No Free plan on this page. Credit allowances come from the server constants as props.
 * The credit-only MCP plans keep their own page at /mcp/pricing.
 */
import { useEffect, useState } from 'react';
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

type Feature = [title: string, detail: string];
type Plan = {
  name: string; tag: string; featured?: boolean;
  price: string | null; was?: string; per: string; trial: boolean;
  cta: string; href: string; outline?: boolean;
  lead: string; base: string; features: Feature[];
  usage: [title: string, detail: string];
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

type Cell = boolean | string;
type CompareGroup = [group: string, rows: Array<[label: string, pro: Cell, team: Cell, ent: Cell]>];

export default function SimplePricing({ proCredits, teamCredits, forecastsLabel, faqs }: {
  proCredits: number; teamCredits: number; forecastsLabel: string; faqs: { q: string; a: string }[];
}) {
  const [annual, setAnnual] = useState(true);
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
      name: 'Pro', tag: 'For solo contractors and small firms going after federal work.',
      price: annual ? `$${fmt(Math.round(PRO_ANNUAL_USD / 12))}` : `$${PRO_MONTHLY_USD}`,
      was: annual ? `$${PRO_MONTHLY_USD}` : undefined,
      per: annual ? '/ mo, billed annually' : '/ mo, billed monthly', trial: true,
      cta: 'Start 14-day trial', href: annual ? PRO_TRIAL_ANNUAL : PRO_TRIAL_MONTHLY,
      lead: 'Find and win your own contracts.', base: 'Everything you need to start',
      features: [
        ['Opportunities matched to you', 'Daily alerts and briefings for your NAICS, keywords and agencies.'],
        ['Recompetes, 12 months out', 'Contracts coming back to market, with the incumbent.'],
        ['Market research', 'Who buys, who wins and what they spend.'],
        ['Mindy in your AI', 'Use Mindy inside Claude, ChatGPT or Cursor.'],
      ],
      usage: ['Monthly usage included', `${fmt(proCredits)} credits / month`],
    },
    {
      name: 'Team', tag: 'Built for BD teams working several markets at once.', featured: true,
      price: annual ? `$${fmt(TEAM_ANNUAL_PER_MONTH)}` : `$${TEAM_MONTHLY_USD}`,
      was: annual ? `$${TEAM_MONTHLY_USD}` : undefined,
      per: annual ? '/ mo, billed annually' : '/ mo, billed monthly', trial: true,
      cta: 'Start 14-day trial', href: annual ? TEAM_TRIAL_ANNUAL : TEAM_TRIAL_MONTHLY,
      lead: 'Win more as a team.', base: 'All Pro features, plus',
      features: [
        ['Up to 5 users', 'One plan for your whole BD team.'],
        ['Shared pipeline', 'Everyone sees the same pursuits and deadlines.'],
        ['Team dashboard and roles', 'See who is working what.'],
        ['Onboarding call', 'We set up your markets with you.'],
      ],
      usage: ['Monthly usage included', `${fmt(teamCredits)} credits / month, shared by the team`],
      footer: <>10 or more users? <a href={SALES_URL}>Talk to us for a volume quote</a></>,
    },
    {
      name: 'Enterprise', tag: 'For primes, APEX Accelerators and agencies rolling Mindy out at scale.',
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

  const plans = applyCurrentPlan(basePlans, me);
  const byName = Object.fromEntries(plans.map((p) => [p.name, p]));

  // Full breakdown (Fyxer's "A plan to suit every need"). Same claims as the cards above and the
  // old plan cards: change a feature here only when the product changes.
  const compare: CompareGroup[] = [
    ['Find opportunities', [
      ['Daily opportunity alerts', true, true, true],
      ['AI-matched daily briefings', true, true, true],
      ['Unlimited NAICS codes and keywords', true, true, true],
      ['Target agency filtering', true, true, true],
      ['Weekly market deep dives', true, true, true],
    ]],
    ['Competitive intelligence', [
      ['Recompete alerts, 12 months out', true, true, true],
      ['Incumbent visibility', true, true, true],
      ['Competitor tracking', true, true, true],
      ['Agency spending analysis', true, true, true],
      [`${forecastsLabel} agency forecasts`, true, true, true],
    ]],
    ['Mindy in your AI', [
      ['Use Mindy in Claude, ChatGPT or Cursor', true, true, true],
      ['Monthly credits', `${fmt(proCredits)}`, `${fmt(teamCredits)}, shared`, 'Custom'],
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
      <section className="hero">
        <h1>Plans that grow with you</h1>
        {me ? (
          <p className="you">You&apos;re on the <b>{PLAN_NAME[me]}</b> plan.{me !== 'free' && <> <a href={BILLING_URL}>Manage billing</a></>}</p>
        ) : <MemberProof />}
      </section>

      <div className="toggle" role="group" aria-label="Billing period">
        <button type="button" className={!annual ? 'on' : ''} aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
        <button type="button" className={annual ? 'on' : ''} aria-pressed={annual} onClick={() => setAnnual(true)}>Annual (up to {maxPct}% off)</button>
      </div>

      <section className="cards" id="plans">
        {plans.map((p) => (
          <article key={p.name} className={`card ${p.featured ? 'featured' : ''} ${p.current ? 'current' : ''}`}>
            <h2>{p.name}{p.current && <span className="mine">Your plan</span>}</h2>
            <p className="tag">{p.tag}</p>
            {p.price ? (
              <div className="price"><span className="now">{p.price}</span>{p.was && <span className="was">{p.was}</span>}</div>
            ) : (
              <div className="price"><span className="now sales">Speak to sales</span></div>
            )}
            <p className="per">{p.per}</p>
            {p.trial && <p className="trial">14 day free trial</p>}
            {p.current
              ? <span className="cta is-current" aria-current="true">Current plan</span>
              : <a className={`cta ${p.outline ? 'outline' : ''}`} href={p.href} onClick={p.trial ? () => trackTrialClick(p.name === 'Team' ? 'team' : 'pro', annual ? 'annual' : 'monthly', 'card') : undefined}>{p.cta}</a>}
            {p.current && upgraded && <p className="tu-ok" role="status">{TRIAL_UPGRADE_SUCCESS_TEXT}</p>}
            {p.current && !upgraded && session && (() => {
              const offer = trialOfferForCard(p.name, me, offers);
              return offer ? <TrialUpgradeBox offer={offer} email={session.email} token={session.token} onDone={() => { setUpgraded(true); setOffers([]); }} /> : null;
            })()}
            {/* Next to every button that takes money (Eric 2026-11-12: "add the no refunds line under each trial button"). */}
            {p.trial && <NoRefundNote style={{ margin: '-14px 0 18px' }} />}
            <p className="lead">{p.lead}</p>
            <p className="base">{p.base}</p>
            <ul>
              {p.features.map(([t, d]) => (
                <li key={t}><span className="tick" aria-hidden="true">✓</span><span><b>{t}</b><small>{d}</small></span></li>
              ))}
            </ul>
            <div className="usage"><span className="ul">{p.usage[0]}</span><b>{p.usage[1]}</b></div>
            {p.footer && <p className="foot">{p.footer}</p>}
          </article>
        ))}
      </section>

      <p className="fine">
        Card required for the trial. No charge for 14 days, and you can cancel anytime before it ends.
        After that, all sales final. Running AI agents only? <Link href="/mcp/pricing">See credit-only plans</Link>.
      </p>

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
                {rows.map(([label, a, b, c]) => (
                  <tr key={label}><th scope="row">{label}</th><td>{cell(a)}</td><td className="hl">{cell(b)}</td><td>{cell(c)}</td></tr>
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
                      {p.trial && <NoRefundNote />}
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
.sp .you a{color:var(--mp-navy);margin-left:6px}
.sp .lead{font-weight:600;margin:0}
.sp .base{color:var(--mp-muted);font-size:13px;margin:2px 0 12px}
.sp .card ul{list-style:none;margin:0 0 22px;padding:0;display:grid;gap:12px}
.sp .card li{display:flex;gap:10px;font-size:14px;line-height:1.4}
.sp .card li .tick{color:var(--mp-ok);font-weight:700}
.sp .card li b{display:block;font-weight:600}
.sp .card li small{display:block;color:var(--mp-muted);font-size:13px}
.sp .usage{margin-top:auto;border:1px solid var(--mp-line);border-radius:12px;padding:14px 16px;background:var(--mp-wash);display:grid;gap:4px}
.sp .usage .ul{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mp-muted)}
.sp .usage b{font-size:14px;font-weight:600}
.sp .foot{text-align:center;font-size:14px;color:var(--mp-muted);margin:16px 0 0}
.sp .foot a,.sp .fine a{color:var(--mp-navy)}
.sp .fine{text-align:center;color:var(--mp-muted);font-size:13px;line-height:1.6;max-width:640px;margin:28px auto 0}
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
