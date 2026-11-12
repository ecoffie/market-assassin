'use client';

/**
 * One pricing surface for both products, rendered at BOTH /pricing (app tab first) and
 * /mcp/pricing (MCP-credit tab first). The two URLs stay live and indexable; only the
 * default tab differs.
 *
 * Every checkout link here is the one the old pages used — do not retype them from a
 * mockup. App links are the Pro monthly/annual payment links that /pricing always had;
 * MCP plan links come from the live /api/mcp/catalog, with the same static fallback the
 * old /mcp/pricing page shipped (keep in sync with SUBSCRIPTION_PLANS in packages.ts).
 *
 * Credit allowances are passed in from the server constants (PRO_MONTHLY_CREDITS etc.),
 * never hardcoded here — a pricing page that promises a number the grant cron doesn't pay
 * is the failure tier-credits.unit.test.ts exists to stop.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import MemberProof from '@/components/public-site/MemberProof';
import { UPGRADE_OFFER_LABEL, UPGRADE_OFFER_PARAM, withUpgradePromo } from '@/lib/billing/upgrade-offer';
import Link from 'next/link';
import NoRefundNote from '@/components/NoRefundNote';
import type { Catalog, Pkg, SubPlan, Tool } from '@/app/mcp/catalog-ui';
import { exampleCost, toolCr, workupCostFrom, workups } from '@/app/mcp/catalog-ui';

export type PricingTab = 'app' | 'mcp';

export interface UnifiedPricingProps {
  initialTab: PricingTab;
  /** PRO_MONTHLY_CREDITS from packages.ts */
  proCredits: number;
  /** TEAM_MONTHLY_CREDITS from packages.ts */
  teamCredits: number;
  /** SIGNUP_CREDITS from credits.ts */
  signupCredits: number;
  /** forecastsLabel from marketing-stats.ts, e.g. "33,000+" */
  forecastsLabel: string;
  /** FAQ entries rendered on the page (the /pricing JSON-LD mirrors these). */
  faqs: { q: string; a: string }[];
}

// ---- Links (unchanged from the previous pages) ----
const PRO_CHECKOUT_MONTHLY = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C'; // $149/mo
const PRO_CHECKOUT_ANNUAL = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D'; // $1,490/yr
const TEAMS_CONTACT_URL = '/contact-sales';
// 14-day trial payment links (created 2026-11-12; each carries metadata.tier for the webhook,
// because a trial checkout completes at $0 and amount/price fallbacks cannot identify it).
// Env vars override. The trial copy shows only when a link is set.
const PRO_TRIAL_MONTHLY = process.env.NEXT_PUBLIC_PRO_TRIAL_CHECKOUT_MONTHLY || 'https://buy.stripe.com/7sYcN64Au4QWcFv70QfnO18';
const PRO_TRIAL_ANNUAL = process.env.NEXT_PUBLIC_PRO_TRIAL_CHECKOUT_ANNUAL || 'https://buy.stripe.com/fZudRaff82IO48Z5WMfnO19';
const PRO_TRIAL = !!(PRO_TRIAL_MONTHLY && PRO_TRIAL_ANNUAL);
// Team annual: $4,027/yr = $335.58/mo, 33% off $499 x 12 ($5,988). Team checkout links (14-day
// trial) come from env; until they are set, Team stays "Contact Sales".
const TEAM_TRIAL_MONTHLY = process.env.NEXT_PUBLIC_TEAM_TRIAL_CHECKOUT_MONTHLY || 'https://buy.stripe.com/eVq28s8QK3MS34VdpefnO1a';
const TEAM_TRIAL_ANNUAL = process.env.NEXT_PUBLIC_TEAM_TRIAL_CHECKOUT_ANNUAL || 'https://buy.stripe.com/3cI9AU2sm5V020R2KAfnO1b';
const TEAM_ANNUAL_USD = 4027;
const TEAM_ANNUAL_PER_MONTH = 335.58;
const TEAM_ANNUAL_PCT = Math.round((1 - TEAM_ANNUAL_USD / (499 * 12)) * 100); // 33
const ENTERPRISE_CONTACT_URL = '/contact-sales';
const REFERRALS_URL = '/app?panel=settings&section=credits&tab=referrals';
const GOVWIN_URL = '/compare/govwin';

const PLANS_FALLBACK: SubPlan[] = [
  { id: 'entry',  label: 'Entry',  creditsPerMonth: 500,   monthly: { priceId: 'price_1TuxApK5zyiZ50PB8iMg8WqG', usd: 99,  credits: 500,   checkoutUrl: 'https://buy.stripe.com/bJe5kEff8erw20R0CsfnO0Y' }, annual: { priceId: 'price_1TuyGyK5zyiZ50PBUfIkFbvD', usd: 990,  usdPerMonth: 83,  credits: 6000,   checkoutUrl: 'https://buy.stripe.com/9B6eVed70bfkdJz1GwfnO12' } },
  { id: 'mid',    label: 'Mid',    creditsPerMonth: 2000,  monthly: { priceId: 'price_1TuxApK5zyiZ50PBPV40eCvG', usd: 249, credits: 2000,  checkoutUrl: 'https://buy.stripe.com/8x29AUgjcfvA5d30CsfnO0Z' }, annual: { priceId: 'price_1TuyGyK5zyiZ50PBaBguu8be', usd: 2490, usdPerMonth: 208, credits: 24000,  checkoutUrl: 'https://buy.stripe.com/bJeeVeaYSgzE8pf2KAfnO13' } },
  { id: 'growth', label: 'Growth', creditsPerMonth: 3500,  monthly: { priceId: 'price_1UG0qlK5zyiZ50PBQLTBrEAV', usd: 399, credits: 3500,  checkoutUrl: 'https://buy.stripe.com/3cI9AU3wq3MS5d3clafnO16' }, annual: { priceId: 'price_1UG0qlK5zyiZ50PBkT40I5mP', usd: 3990, usdPerMonth: 333, credits: 42000,  checkoutUrl: 'https://buy.stripe.com/fZufZiff80AGcFvdpefnO17' } },
  { id: 'agency', label: 'Agency', creditsPerMonth: 10000, monthly: { priceId: 'price_1TuxAqK5zyiZ50PBJUdzoobH', usd: 999, credits: 10000, checkoutUrl: 'https://buy.stripe.com/8x2eVe1oi6Z434VdpefnO10' }, annual: { priceId: 'price_1TuyGzK5zyiZ50PBkxhPLK5J', usd: 9990, usdPerMonth: 833, credits: 120000, checkoutUrl: 'https://buy.stripe.com/4gM00k6IC0AGcFvetifnO14' } },
];
const TOPUP_FALLBACK: Pkg = { id: 'refill', credits: 1000, usd: 119, label: 'Top-up — 1,000 credits', checkoutUrl: 'https://buy.stripe.com/28EfZi5Ey97cgVL3OEfnO15' };

const MCP_META: Record<string, { tag: string; badge?: string; color?: 'navy' | 'ink' }> = {
  entry: { tag: 'The on-ramp for project-based federal BD.' },
  mid: { tag: 'The daily-driver — work opportunities every day.', badge: '✦ Best for daily use', color: 'navy' },
  growth: { tag: 'For working several markets at once.', badge: 'High volume', color: 'ink' },
  agency: { tag: 'For shops running many pursuits at once.', badge: 'High volume', color: 'ink' },
};

/** Plan-finder tasks — priced per opportunity from the live catalog. */
const TASKS: { id: string; label: string; note: string; tools: string[]; on: boolean }[] = [
  { id: 'find', label: 'Find & filter opportunities', note: 'Live SAM search · NAICS + keywords', tools: ['search_sam_opportunities'], on: true },
  { id: 'incumbent', label: 'Vet the incumbent', note: 'Who holds it + contractor profile', tools: ['get_solicitation_incumbent', 'get_contractor_profile'], on: true },
  { id: 'price', label: 'Price the bid', note: 'GSA labor rates p25/p50/p75', tools: ['get_pricing_intel'], on: true },
  { id: 'playbook', label: 'Draft a win strategy', note: 'Proprietary winning playbook', tools: ['get_winning_playbook'], on: false },
  { id: 'teaming', label: 'Build a teaming shortlist', note: 'Who-can-win scan + partner profiles', tools: ['find_capable_contractors', 'get_contractor_profile', 'get_contractor_profile'], on: false },
  { id: 'proposal', label: 'Draft the proposal', note: 'Matrix → draft → compliance referee', tools: ['extract_compliance_matrix', 'draft_proposal', 'referee_proposal_compliance'], on: false },
];

const fmt = (n: number) => n.toLocaleString('en-US');

// ---- Plan card model ----
type Feature = [label: string, level: 0 | 1 | 2, tag?: string];
interface CardModel {
  name: string;
  tag: string;
  badge?: string;
  color?: 'navy' | 'ink';
  price: number;
  was?: number;
  per: string;
  href: string;
  cta: string;
  /** The signed-in user's plan: shows a "Your plan" badge and a non-link "Current plan" button. */
  current?: boolean;
  pill?: string;
  note?: string;
  credits: [string, string, string];
  tree: [string, string][];
  secs: [string, Feature[]][];
}

const Check = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.3l2.3 2.3 4.7-5" /></svg>
);
const Cross = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
);

/** A button that goes straight to payment (Stripe or our /checkout redirect). */
const isSaleHref = (href: string) => /buy\.stripe\.com|\/checkout\//.test(href);

function PlanCard({ p, compact }: { p: CardModel; compact?: boolean }) {
  return (
    <div className={`plan ${p.color || ''} ${p.current ? 'is-current' : ''}`}>
      <div className="plan-top">
        <div className="pname"><h3>{p.name}</h3>{p.current ? <span className="badge badge-current">Your plan</span> : p.badge && <span className="badge">{p.badge}</span>}</div>
        <div className="tagline">{p.tag}</div>
        <div className="price">
          {p.was !== undefined && <span className="was">${fmt(p.was)}</span>}
          <span className="now">${fmt(p.price)}</span>
          <span className="per">{p.per}</span>
        </div>
        {p.current
          ? <span className="cta cta-current" aria-current="true">Current plan</span>
          : <a className="cta" href={p.href}>{p.cta}{p.pill && <span className="pill">{p.pill}</span>}</a>}
        {!p.current && isSaleHref(p.href) && <NoRefundNote />}
        {p.note && <div className="subnote">{p.note}</div>}
      </div>
      <div className="credits">
        <div className="main"><span className="ico">+</span><span><b>{p.credits[0]} {p.credits[1]}</b> <small>{p.credits[2]}</small></span></div>
        <div className="tree">{p.tree.map(([a, b]) => <div key={a + b}><b>{a}</b> <span>{b}</span></div>)}</div>
      </div>
      {!compact && p.secs.map(([title, items]) => (
        <div className="sec" key={title}>
          <h4>{title}</h4>
          {items.map(([label, level, tg]) => level === 0
            ? <div className="item no" key={label}><span className="x"><Cross /></span>{label}</div>
            : <div className={`item ${level === 2 ? 'hl' : ''}`} key={label}><span className="ck"><Check /></span>{label}{tg && <span className="tag">{tg}</span>}</div>)}
        </div>
      ))}
    </div>
  );
}

export default function UnifiedPricing({ initialTab, proCredits, teamCredits, signupCredits, forecastsLabel, faqs }: UnifiedPricingProps) {
  const [tab, setTab] = useState<PricingTab>(initialTab);
  const [cmpTab, setCmpTab] = useState<PricingTab>(initialTab);
  const [annual, setAnnual] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set(TASKS.filter((t) => t.on).map((t) => t.id)));
  const [opps, setOpps] = useState(20);
  const [openFaq, setOpenFaq] = useState<Set<number>>(new Set());
  const [cat, setCat] = useState<Catalog | null>(null);

  useEffect(() => {
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setCat({ tools: j.tools || [], packages: j.packages || [], subscriptionPlans: j.subscriptionPlans || [], signupCredits: j.signupCredits ?? signupCredits, proMonthlyCredits: j.proMonthlyCredits ?? proCredits, tierCredits: j.tierCredits });
      })
      .catch(() => { /* static fallback */ });
  }, [signupCredits, proCredits]);

  // Signed in (Eric 2026-11-06): "show what plan I'm currently on and the upgrade". The token is the
  // same one every Mindy page sends; /api/app/me verifies it server-side and returns plan + credits.
  const [me, setMe] = useState<{ plan: 'free' | 'pro' | 'team' | 'enterprise' | null; credits: number | null } | null>(null);
  useEffect(() => {
    let t: string | null = null;
    try { t = localStorage.getItem('mi_beta_auth_token'); } catch { /* private mode */ }
    if (!t) return;
    fetch('/api/app/me', { headers: { 'x-mi-auth-token': t }, credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.email) setMe({ plan: d.plan ?? null, credits: typeof d.credits === 'number' ? d.credits : null }); })
      .catch(() => { /* stays the public page */ });
  }, []);

  const tools: Tool[] = cat?.tools ?? [];
  // Plans shown publicly. Agency is hidden from the pricing page (the Stripe plan and its
  // checkout link still exist for current subscribers — this only stops advertising it).
  const HIDDEN_PLANS = new Set(['agency']);
  const plans = (cat?.subscriptionPlans?.length ? cat.subscriptionPlans : PLANS_FALLBACK).filter((p) => !HIDDEN_PLANS.has(p.id));
  const topup = cat?.packages?.find((p) => p.id === 'refill') ?? TOPUP_FALLBACK;
  const trial = cat?.signupCredits ?? signupCredits;
  const proCr = cat?.tierCredits?.pro.credits ?? proCredits;
  const teamCr = cat?.tierCredits?.teams.credits ?? teamCredits;

  const workupCost = tools.length ? workupCostFrom(tools) : 30;
  const searchCost = toolCr(tools, 'search_sam_opportunities', 5);
  const draftCost = toolCr(tools, 'draft_proposal', 40);
  const flagshipCost = toolCr(tools, 'generate_market_report', 100);
  const outcomes = (n: number): [string, string][] => [
    [`≈ ${fmt(workups(n, workupCost))}`, 'opp work-ups'],
    [fmt(Math.max(1, Math.floor(n / flagshipCost))), 'proposals / reports'],
    [fmt(Math.floor(n / draftCost)), 'proposal drafts'],
    [fmt(Math.floor(n / searchCost)), 'opportunity searches'],
  ];

  // ---- App cards ----
  const appCards: CardModel[] = [
    // No Free card: there is no free plan for new users (Nov 2026). Pro and Teams carry the
    // 14-day trial.
    {
      name: 'Pro', badge: '✦ Most popular', color: 'navy', tag: 'The $150K capture manager in your pocket.',
      price: annual ? 124 : 149, was: annual ? 149 : undefined, per: annual ? '/mo billed yearly' : '/mo',
      href: PRO_TRIAL ? (annual ? PRO_TRIAL_ANNUAL : PRO_TRIAL_MONTHLY) : (annual ? PRO_CHECKOUT_ANNUAL : PRO_CHECKOUT_MONTHLY),
      cta: PRO_TRIAL ? 'Start for free' : 'Get Pro', pill: annual ? '-17% · Save $298' : undefined,
      note: PRO_TRIAL
        ? `14 days free, then ${annual ? '$1,490/yr' : '$149/mo'}. We remind you before you're charged. Cancel anytime.`
        : (annual ? '$1,490/yr · 2 months free' : 'Cancel anytime.'),
      credits: [fmt(proCr), 'MCP credits', '/ month'], tree: [['Unlimited', 'NAICS codes'], ['AI-matched', 'daily briefings']],
      secs: [
        ['Daily intelligence', [['Daily opportunity digest', 1], ['AI-matched briefings', 2], ['Unlimited NAICS codes', 2], ['Target agency filtering', 1]]],
        ['Competitive intelligence', [['Competitor tracking', 2], ['Recompete alerts 12 mo out', 2], ['Incumbent visibility', 1], ['Agency spending analysis', 1]]],
        ['Forecasts & support', [[`${forecastsLabel} agency forecasts`, 1, 'Full'], ['Weekly market deep dives', 1], ['Email support', 1], ['Priority response (24hr)', 1]]],
      ],
    },
    {
      name: 'Teams', badge: 'For BD teams', color: 'ink', tag: 'For growing contractors with a BD team.',
      price: annual ? TEAM_ANNUAL_PER_MONTH : 499, was: annual ? 499 : undefined,
      per: annual ? '/mo billed yearly' : '/mo',
      pill: annual ? `-${TEAM_ANNUAL_PCT}% · Save $${fmt(499 * 12 - TEAM_ANNUAL_USD)}` : undefined,
      href: (annual ? TEAM_TRIAL_ANNUAL : TEAM_TRIAL_MONTHLY) || TEAMS_CONTACT_URL,
      cta: (annual ? TEAM_TRIAL_ANNUAL : TEAM_TRIAL_MONTHLY) ? 'Start for free' : 'Contact Sales',
      note: (annual ? TEAM_TRIAL_ANNUAL : TEAM_TRIAL_MONTHLY)
        ? `14 days free, then ${annual ? `$${fmt(TEAM_ANNUAL_USD)}/yr` : '$499/mo'}. We remind you before you're charged.`
        : (annual ? `$${fmt(TEAM_ANNUAL_USD)}/yr · Reply within one business day.` : 'Reply within one business day.'),
      credits: [fmt(teamCr), 'MCP credits', '/ month'], tree: [['5 users', 'included'], ['Shared', 'pipeline & pursuits']],
      secs: [
        ['Everything in Pro, plus', [['Up to 5 users included', 2], ['Shared pipeline & pursuits', 2], ['Team dashboard', 1], ['Role-based access', 1]]],
        ['Onboarding', [['Onboarding call included', 1], ['Custom seat count on request', 1]]],
        ['Forecasts & support', [[`${forecastsLabel} agency forecasts`, 1, 'Full'], ['Weekly market deep dives', 1], ['Priority response (24hr)', 1]]],
      ],
    },
  ];

  // ---- MCP cards ----
  const mcpCard = (p: SubPlan): CardModel => {
    const m = MCP_META[p.id] ?? { tag: '' };
    const useAnnual = annual && !!p.annual;
    const pct = p.annual && p.monthly.usd > 0 ? Math.round((1 - p.annual.usd / (p.monthly.usd * 12)) * 100) : 0;
    const save = p.annual ? p.monthly.usd * 12 - p.annual.usd : 0;
    return {
      name: p.label, tag: m.tag, badge: m.badge, color: m.color,
      price: useAnnual && p.annual ? p.annual.usdPerMonth : p.monthly.usd,
      was: useAnnual ? p.monthly.usd : undefined,
      per: useAnnual ? '/mo billed yearly' : '/mo',
      href: useAnnual && p.annual ? p.annual.checkoutUrl : p.monthly.checkoutUrl,
      cta: `Get ${p.label}`,
      pill: useAnnual && pct ? `-${pct}% · Save $${fmt(save)}` : undefined,
      note: useAnnual && p.annual ? `$${fmt(p.annual.usd)}/yr · ${fmt(p.annual.credits)} credits upfront` : undefined,
      credits: [fmt(p.creditsPerMonth), 'credits', '/ month'],
      tree: outcomes(p.creditsPerMonth),
      secs: [
        ['Included in plan', [['Every tool — public data + proprietary layer', 2], ['Charged on success only', 1], ['Top up any time · auto-recharge', 1], ['Keyless connect via browser', 1]]],
        ['Annual bonus', [[`+${fmt(p.creditsPerMonth * 2)} bonus credits`, useAnnual ? 2 : 0, 'annual']]],
        ['Enterprise', [['High-volume API / data feed', 0], ['SSO / SAML · SLA', 0]]],
      ],
    };
  };
  const CURRENT_CARD: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Teams' };
  if (me?.plan && CURRENT_CARD[me.plan]) {
    for (const c of appCards) if (c.name === CURRENT_CARD[me.plan]) c.current = true;
  }
  // What "Upgrade" means from each plan: Free → Pro checkout, Pro → Teams, Team/Enterprise → add credits.
  // Upgrading members get 25% off the first month (src/lib/billing/upgrade-offer.ts) — monthly Pro
  // checkout carries the promo code; the Teams upgrade goes to sales with the offer attached.
  const upgrade = !me?.plan ? null
    : me.plan === 'free' ? { label: 'Upgrade to Pro', href: withUpgradePromo(PRO_CHECKOUT_MONTHLY), offer: true }
    : me.plan === 'pro' ? { label: 'Upgrade to Teams', href: `${TEAMS_CONTACT_URL}?offer=${UPGRADE_OFFER_PARAM}`, offer: true }
    : { label: 'Add credits', href: '/app?panel=settings&section=credits&tab=billing', offer: false };
  // Annual stays the normal annual offer (its own 17% discount); the first-month deal is monthly.
  if (me?.plan === 'free' && !annual) {
    const pro = appCards.find((c) => c.name === 'Pro');
    if (pro) { pro.href = withUpgradePromo(PRO_CHECKOUT_MONTHLY); pro.cta = 'Upgrade to Pro'; pro.pill = UPGRADE_OFFER_LABEL; pro.note = 'Billed monthly. 25% off applies to your first month.'; }
  }
  if (me?.plan === 'pro') {
    const team = appCards.find((c) => c.name === 'Teams');
    if (team) { team.href = `${TEAMS_CONTACT_URL}?offer=${UPGRADE_OFFER_PARAM}`; team.cta = 'Upgrade to Teams'; team.pill = UPGRADE_OFFER_LABEL; }
  }
  const PLAN_NAME: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Teams', enterprise: 'Enterprise' };

  const mcpCards = plans.map(mcpCard);

  // ---- Finder ----
  const perOpp = TASKS.filter((t) => picked.has(t.id)).reduce((s, t) => s + exampleCost(tools, t.tools), 0);
  const need = perOpp * opps;
  const rec = useMemo((): { card: CardModel | null; cap: number } => {
    if (need <= trial) {
      return {
        cap: trial,
        card: {
          name: '14-day free trial', tag: 'Start with a 14-day free trial of Pro or Team.', badge: '✦ Recommended', color: 'navy',
          price: 0, per: 'for 14 days', href: '/pricing', cta: 'Start for free', note: 'Card required. No charge for 14 days. Cancel anytime.',
          credits: [fmt(proCr), 'MCP credits', '/ month on Pro'], tree: [['14', 'days free'], ['All', 'tools included']], secs: [],
        },
      };
    }
    const plan = plans.find((p) => p.creditsPerMonth >= need);
    if (!plan) return { cap: need, card: null };
    return { cap: plan.creditsPerMonth, card: { ...mcpCard(plan), badge: '✦ Recommended', color: 'navy' } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need, trial, plans, annual, tools]);
  const tickOn = Math.round(((opps - 5) / 145) * 29) + 1;
  const dotOn = Math.min(30, Math.round((need / Math.max(1, rec.cap)) * 30));

  // ---- Compare tables ----
  const Y = <span className="yes">✓</span>;
  const N = '—';
  type Row = [string] | [string, ...ReactNode[]];
  const cmp: Record<PricingTab, { cols: string[]; hl: number; rows: Row[] }> = {
    app: {
      cols: ['Pro', 'Teams'], hl: 0, rows: [
        ['Daily intelligence'],
        ['Daily opportunity digest', Y, Y], ['AI-matched briefings', Y, Y], ['NAICS codes tracked', 'Unlimited', 'Unlimited'], ['Target agency filtering', Y, Y],
        ['Competitive intelligence'],
        ['Competitor tracking', Y, Y], ['Recompete alerts (12 mo out)', Y, Y], ['Incumbent visibility', Y, Y], ['Agency spending analysis', Y, Y],
        ['Forecast & strategy'],
        [`${forecastsLabel} agency forecasts`, 'Full access', 'Full access'], ['Weekly market deep dives', Y, Y],
        ['Team & collaboration'],
        ['Users included', '1', '5 (more on request)'], ['Shared pipeline', N, Y], ['Team dashboard', N, Y], ['Role-based access', N, Y],
        ['AI agent access (MCP)'],
        ['Use Mindy in Claude, Cursor, any agent', Y, Y], ['Credits included', `${fmt(proCr)}/mo`, `${fmt(teamCr)}/mo`], ['Tools available', 'All', 'All'], ['Buy additional credits', Y, Y],
        ['Support'],
        ['Email support', Y, Y], ['Priority response (24hr)', Y, Y], ['Onboarding call', N, Y],
      ],
    },
    mcp: {
      cols: ['Free', ...plans.map((p) => p.label), 'Enterprise'], hl: 2, rows: [
        ['Credits'],
        ['Monthly credit allowance', `${fmt(trial)} once`, ...plans.map((p) => `${fmt(p.creditsPerMonth)}/mo`), 'Custom'],
        ['Annual bonus credits', N, ...plans.map((p) => (p.annual ? `+${fmt(p.creditsPerMonth * 2)}` : N)), 'Custom'],
        ['Monthly price', '$0', ...plans.map((p) => `$${fmt(p.monthly.usd)}`), 'Custom'],
        ['Annual price (per mo)', N, ...plans.map((p) => (p.annual ? `$${fmt(p.annual.usdPerMonth)}` : N)), 'Invoiced'],
        ['Tools & billing'],
        ['Every tool — public + proprietary layer', Y, ...plans.map(() => Y), Y], ['Charged on success only', Y, ...plans.map(() => Y), Y], ['One-time top-ups · auto-recharge', N, ...plans.map(() => Y), Y],
        ['Enterprise'],
        ['Data feed / high-volume API', N, ...plans.map(() => N), Y], ['SSO / SAML · dedicated CSM · SLA', N, ...plans.map(() => N), Y],
      ],
    },
  };
  const c = cmp[cmpTab];

  const goTab = (t: PricingTab) => { setTab(t); document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' }); };

  const BillingToggle = ({ saveLabel }: { saveLabel: string }) => (
    <div className="billing">
      <span className={`lbl ${!annual ? 'on' : ''}`}>Monthly</span>
      <button type="button" className={`switch ${annual ? 'on' : ''}`} aria-label="Toggle annual billing" aria-pressed={annual} onClick={() => setAnnual((a) => !a)} />
      <span className={`lbl ${annual ? 'on' : ''}`}>Annual</span>
      <span className="save">{saveLabel}</span>
    </div>
  );

  return (
    <main className="up">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <section className="promo">
          <h1><span className="l1">GovWin-grade intel for $149, not $15,000.</span><br /><span className="l2">14-day free trial. No sales call.</span></h1>
          <p>Daily opportunity digest, recompete alerts, competitor tracking — and Mindy&apos;s tools inside Claude, Cursor, or any AI agent.</p>
          <MemberProof />
          <div className="row">
            <span className="chip">✦ 14-day free trial on Pro and Team</span>
            <span className="chip">↺ Cancel anytime</span>
            <a className="chip" href={REFERRALS_URL}>♥ Refer a friend — you both get 100 credits →</a>
          </div>
        </section>

        {me?.plan && upgrade && (
          <section className="current-plan" aria-label="Your plan">
            <div>
              <div className="cp-k">Your plan</div>
              <div className="cp-v">{PLAN_NAME[me.plan]}{typeof me.credits === 'number' && <span className="cp-c"> · {fmt(me.credits)} credits left</span>}</div>
            </div>
            <div className="cp-actions">
              <Link className="cp-sec" href="/app?panel=settings&section=credits&tab=billing">Billing &amp; credits</Link>
              <a className="cp-up" href={upgrade.href}>{upgrade.label}{upgrade.offer && <span className="cp-off">{UPGRADE_OFFER_LABEL}</span>}</a>
            </div>
          </section>
        )}

        <div className="plans-head" id="plans">
          <div>
            <h2>All plans</h2>
            <p>{tab === 'app' ? 'For solo contractors & growing BD teams' : 'Metered credits for Claude, Cursor & any AI agent'}</p>
          </div>
          <div className="controls">
            <div className="seg" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'app'} className={tab === 'app' ? 'on' : ''} onClick={() => setTab('app')}>Mindy App</button>
              <button type="button" role="tab" aria-selected={tab === 'mcp'} className={tab === 'mcp' ? 'on' : ''} onClick={() => setTab('mcp')}>MCP Credits</button>
            </div>
            <BillingToggle saveLabel={`Save up to ${TEAM_ANNUAL_PCT}%`} />
          </div>
        </div>

        <div className={`grid ${tab === 'app' || mcpCards.length <= 3 ? 'c3' : 'c4'}`}>
          {(tab === 'app' ? appCards : mcpCards).map((p) => <PlanCard key={p.name} p={p} />)}
        </div>

        {tab === 'app' ? (
          <>
            <div className="strip topup">
              <div className="amt">Need more?</div>
              <div><b>Running agents heavier than {fmt(proCr)} credits/mo?</b><p>Credit-only plans start at ${plans[0]?.monthly.usd ?? 99} for {fmt(plans[0]?.creditsPerMonth ?? 500)}/mo — no app subscription needed, and they work on the same account.</p></div>
              <button type="button" className="cta" onClick={() => goTab('mcp')}>See credit plans →</button>
            </div>
            <div className="strip">
              <div><h3>Partners · 10+ users</h3><p>For <b>APEX Accelerators, SBDCs, primes and associations</b> who want to give Mindy to all their clients, subs or members. Volume pricing, one invoice.</p></div>
              <ul><li>Roll out to every client or sub at once</li><li>Shared opportunity lists and pipelines</li><li>Usage reporting for your program</li></ul>
              <a className="cta" href="/contact-sales">Get a volume quote</a>
            </div>
            <p className="fine">
              <b>Every plan includes Mindy&apos;s MCP server</b> — use her tools in Claude, Cursor, or any AI agent. Changes take effect immediately and are pro-rated.<br />
              Need more than 5 seats, SSO or API access? <a href="/contact-sales">Ask us for a custom quote</a> · <a href={GOVWIN_URL}>See the full GovWin comparison ↗</a>
            </p>
          </>
        ) : (
          <>
            <div className="strip">
              <div><h3>Enterprise / API</h3><p>For primes, agencies, funds, lenders &amp; partners who need the <b>data as a feed or high-volume API</b> — not a seat. Custom credit pool. Volume pricing · annual invoicing.</p></div>
              <ul><li>High-volume programmatic API access</li><li>SSO / SAML · dedicated success manager · SLA</li><li>Custom integrations · data / feed license</li></ul>
              <a className="cta" href={ENTERPRISE_CONTACT_URL}>Contact sales</a>
            </div>
            <div className="strip topup">
              <div className="amt">${fmt(topup.usd)}</div>
              <div><b>One-time top-up · {fmt(topup.credits)} credits</b><p>Ran out mid-month? Refill without changing your plan. Powers auto-recharge. Never expires, carries over at renewal.</p></div>
              <div><a className="cta" href={topup.checkoutUrl ?? TOPUP_FALLBACK.checkoutUrl}>Buy top-up</a><NoRefundNote /></div>
            </div>
            <p className="fine">
              Every tool is open on every plan — tiers differ only by monthly allowance. You&apos;re charged per successful call; refused requests and failures on our side are free.<br />
              Already on the Mindy app? Pro and Teams include monthly MCP credits on the same account.{' '}
              <a href="#plans" onClick={(e) => { e.preventDefault(); goTab('app'); }}>See app plans ↗</a>
            </p>
          </>
        )}

        {/* FINDER */}
        <h2 className="section-title" id="finder">Find the best plan for you</h2>
        <p className="section-sub">Tell us what your agent will do per opportunity. We&apos;ll size your credits.</p>
        <div className="finder">
          <div className="steps">
            <div className="step">
              <div className="num">1</div>
              <div>
                <h3>What will your agent do?</h3>
                <p className="hint">Multiple options can be selected · charged only on success</p>
                <div className="tasks">
                  {TASKS.map((t) => (
                    <button type="button" key={t.id} aria-pressed={picked.has(t.id)} className={`task ${picked.has(t.id) ? 'on' : ''}`}
                      onClick={() => setPicked((prev) => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
                      <span className="box"><Check /></span>
                      <span><b>{t.label}</b><small>{t.note} · {exampleCost(tools, t.tools)} cr</small></span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="step">
              <div className="num">2</div>
              <div>
                <h3>How many opportunities per month?</h3>
                <p className="hint">A full work-up runs ~{workupCost} credits. Lighter lookups cost far less.</p>
                <div className="slider-box">
                  <div className="ticks">{Array.from({ length: 30 }, (_, i) => <span key={i} className={i < tickOn ? 'on' : ''} />)}</div>
                  <input type="range" min={5} max={150} step={5} value={opps} onChange={(e) => setOpps(+e.target.value)} aria-label="Opportunities per month" />
                  <div className="slider-val"><span>Opportunities worked</span><b>{opps} / mo</b></div>
                </div>
              </div>
            </div>
          </div>
          <div className="result">
            <BillingToggle saveLabel="Save 17%" />
            <div className="rec">
              {rec.card ? <PlanCard p={rec.card} compact /> : (
                <div className="plan ink">
                  <div className="plan-top">
                    <div className="pname"><h3>Enterprise</h3><span className="badge">Custom pool</span></div>
                    <div className="tagline">You&apos;re past {fmt(plans[plans.length - 1]?.creditsPerMonth ?? 10000)} credits/mo — let&apos;s size a pooled plan.</div>
                    <div className="price"><span className="now">Let&apos;s talk</span></div>
                    <a className="cta" href={ENTERPRISE_CONTACT_URL}>Contact sales</a>
                  </div>
                </div>
              )}
            </div>
            <div className="usage">
              <div className="row">
                <div>Expected monthly usage<b>{fmt(need)} of {fmt(rec.cap)} credits</b></div>
                <div className="dots">{Array.from({ length: 30 }, (_, i) => <i key={i} className={i < dotOn ? 'on' : ''} />)}</div>
              </div>
              <p className="note">{perOpp ? `${perOpp} cr × ${opps} opportunities. Only successful calls are charged.` : 'Pick at least one task above.'}</p>
            </div>
          </div>
        </div>

        {/* COMPARE */}
        <h2 className="section-title">Compare every plan</h2>
        <p className="section-sub">No fine print, no &quot;contact us for pricing&quot; mystery boxes.</p>
        <div className="seg cmp-seg" role="tablist">
          <button type="button" role="tab" aria-selected={cmpTab === 'app'} className={cmpTab === 'app' ? 'on' : ''} onClick={() => setCmpTab('app')}>Mindy App</button>
          <button type="button" role="tab" aria-selected={cmpTab === 'mcp'} className={cmpTab === 'mcp' ? 'on' : ''} onClick={() => setCmpTab('mcp')}>MCP Credits</button>
        </div>
        <p className="tbl-hint">Swipe to compare every plan →</p>
        <div className="tbl-wrap" data-swipe="">
          <table>
            <thead><tr><th>Feature</th>{c.cols.map((x, i) => <th key={x} className={i === c.hl ? 'hl' : ''}>{x}</th>)}</tr></thead>
            <tbody>
              {c.rows.map((r) => r.length === 1
                ? <tr className="grp" key={r[0]}><td colSpan={c.cols.length + 1}><span>{r[0]}</span></td></tr>
                : <tr key={r[0]}><td>{r[0]}</td>{r.slice(1).map((v, i) => <td key={i} className={i === c.hl ? 'hl' : ''}>{v}</td>)}</tr>)}
            </tbody>
          </table>
        </div>

        {/* FAQ */}
        <h2 className="section-title">Pricing questions, answered</h2>
        <p className="section-sub">Still stuck? Email <a href="mailto:admin@getmindy.ai" className="mail">admin@getmindy.ai</a> — reply within one business day.</p>
        <div className="faq">
          {faqs.map((f, i) => (
            <div key={f.q} className={`qa ${openFaq.has(i) ? 'open' : ''}`}>
              <button type="button" aria-expanded={openFaq.has(i)} onClick={() => setOpenFaq((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
                {f.q}<span>+</span>
              </button>
              <div className="a">{f.a}</div>
            </div>
          ))}
        </div>

        <section className="final">
          <h2>Start your 14-day free trial.<br />See your first briefing tomorrow.</h2>
          <p>Pick Pro or Team. Card required, no charge for 14 days. Cancel anytime.</p>
          <div className="btns">
            <a className="cta light" href="/pricing">Start for free</a>
            <Link className="cta" href="/mcp">Connect Mindy to your AI →</Link>
          </div>
          <p className="quote">&ldquo;The big contractors have armies. You have Mindy.&rdquo;</p>
        </section>
      </div>

      <a className="float" href="#finder">Pick your plan in 30 seconds ↓</a>
    </main>
  );
}

/*
 * Styled to match the live getmindy.ai/pricing look: cream paper, white cards with a
 * hairline border, 8px corners, solid navy, no gradients or drop shadows, serif headings,
 * green checks. Colours read the site's --mp-* tokens (src/lib/public-site/tokens.ts).
 */
const CSS = `
.up{background:var(--mp-paper);color:var(--mp-ink);font-family:var(--mp-font-sans);font-size:15px;line-height:1.5}
.up *{box-sizing:border-box}
.up h1,.up h2,.up h3,.up h4,.up p,.up ul{margin:0;padding:0}
.up a{color:inherit;text-decoration:none}
.up button{font:inherit;cursor:pointer;border:0;background:none;color:inherit}
.up .wrap{max-width:1160px;margin:0 auto;padding:0 20px}

/* Hero — the old page's wash band, centered */
.up .promo{margin:32px 0 0;border-radius:8px;padding:64px 28px;text-align:center;background:var(--mp-wash);border:1px solid var(--mp-hair)}
.up .promo h1{font-family:var(--mp-font-serif);font-weight:700;line-height:1.15;font-size:clamp(30px,5vw,56px);color:var(--mp-ink)}
.up .promo h1 .l2{color:var(--mp-navy)}
.up .promo p{margin:20px auto 0;color:var(--mp-body);font-size:19px;max-width:680px}
.up .promo .row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:26px}
.up .chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:8px;background:var(--mp-surface);border:1px solid var(--mp-line);font-size:13px;font-weight:500;color:var(--mp-body)}
.up a.chip{color:var(--mp-navy);font-weight:600}
.up a.chip:hover{border-color:var(--mp-navy)}

/* Plans header + controls */
.up .plans-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin:60px 0 28px}
.up .plans-head h2{font-family:var(--mp-font-serif);font-size:clamp(30px,4vw,40px);font-weight:700;line-height:1.1}
.up .plans-head p{color:var(--mp-muted);margin-top:10px}
.up .controls{display:flex;gap:10px;flex-wrap:wrap}
.up .seg{display:flex;padding:4px;border-radius:8px;background:var(--mp-wash);border:1px solid var(--mp-line)}
.up .seg button{padding:8px 16px;border-radius:6px;font-weight:600;font-size:14px;color:var(--mp-muted)}
.up .seg button.on{background:var(--mp-navy);color:#fff}
.up .cmp-seg{width:max-content;margin:0 auto 16px}
.up .billing{display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:8px;background:var(--mp-wash);border:1px solid var(--mp-line);font-size:14px;color:var(--mp-muted)}
.up .billing .lbl.on{color:var(--mp-ink);font-weight:600}
.up .switch{width:36px;height:20px;border-radius:999px;background:var(--mp-line);position:relative;transition:.2s}
.up .switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s}
.up .switch.on{background:var(--mp-navy)}.up .switch.on::after{left:18px}
.up .save{color:var(--mp-ok);font-weight:700}

/* Plan cards — white card, hairline border; the featured plan gets the old Pro treatment */
.up .grid{display:grid;gap:24px;align-items:start}
.up .grid.c3{grid-template-columns:repeat(3,1fr)}
.up .grid.c4{grid-template-columns:repeat(4,1fr)}
@media(max-width:1060px){.up .grid.c4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:860px){.up .grid.c3,.up .grid.c4{grid-template-columns:1fr}}
.up .plan{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:8px;position:relative}
.up .plan.navy{border:2px solid var(--mp-navy);background:var(--mp-wash)}
.up .plan-top{padding:28px 24px 22px}
.up .pname{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.up .pname h3{font-family:var(--mp-font-serif);font-size:22px;font-weight:700;line-height:1.25}
.up .badge{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 10px;border-radius:8px;background:var(--mp-wash);color:var(--mp-body);border:1px solid var(--mp-line);white-space:nowrap}
.up .plan.navy .badge{background:var(--mp-navy);color:#fff;border-color:var(--mp-navy)}
.up .plan.ink .badge{background:var(--mp-ink);color:#fff;border-color:var(--mp-ink)}
.up .tagline{font-size:14px;color:var(--mp-muted);margin-top:6px;min-height:42px}
.up .plan.navy .tagline{color:var(--mp-navy)}
.up .price{display:flex;align-items:baseline;gap:8px;margin:18px 0 16px;flex-wrap:wrap}
.up .price .now{font-size:48px;font-weight:700;line-height:1;color:var(--mp-ink)}
.up .price .was{font-size:28px;font-weight:700;line-height:1;color:var(--mp-faint);text-decoration:line-through;text-decoration-thickness:2px}
.up .price .per{font-size:14px;color:var(--mp-muted)}
.up .current-plan{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin:0 0 28px;padding:20px 24px;border:1px solid var(--mp-line);border-radius:20px;background:var(--mp-surface);box-shadow:0 10px 30px rgba(27,58,107,.08)}
.up .cp-k{font:700 12px var(--mp-font-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mp-navy)}
.up .cp-v{margin-top:4px;font:700 22px var(--mp-font-sans);color:var(--mp-ink)}
.up .cp-c{font-weight:500;color:var(--mp-body)}
.up .cp-actions{display:flex;flex-wrap:wrap;gap:10px}
.up .cp-sec,.up .cp-up{display:inline-flex;align-items:center;padding:12px 22px;border-radius:999px;font:600 15px var(--mp-font-sans);text-decoration:none}
.up .cp-sec{border:1px solid var(--mp-line);color:var(--mp-ink)}
.up .cp-up{gap:10px;background:var(--mp-navy);color:#fff}
.up .cp-off{padding:3px 10px;border-radius:999px;background:#fff;color:var(--mp-navy);font-size:12.5px;font-weight:700}
.up .plan.is-current{box-shadow:0 0 0 2px var(--mp-navy)}
.up .cta.cta-current{cursor:default;background:var(--mp-wash);color:var(--mp-body);border-color:var(--mp-line)}
.up .cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border-radius:8px;background:var(--mp-wash);color:var(--mp-ink);font-weight:600;font-size:15px;border:1px solid var(--mp-line);transition:background .15s;white-space:nowrap}
.up .cta:hover{background:var(--mp-hair)}
.up .plan.navy .cta{background:var(--mp-navy);color:#fff;border-color:var(--mp-navy);font-weight:700}
.up .plan.navy .cta:hover{background:var(--mp-navy-hover)}
.up .pill{display:inline-flex;font-size:11px;font-weight:700;color:var(--mp-ok);background:var(--mp-ok-bg);border:1px solid var(--mp-ok-line);padding:2px 7px;border-radius:6px;white-space:nowrap}
.up .subnote{font-size:12px;margin-top:10px;text-align:center;color:var(--mp-muted)}
.up .plan.navy .subnote{color:var(--mp-navy)}
.up .grid.c4 .price .now{font-size:38px}
.up .grid.c4 .price .was{font-size:22px}
.up .grid.c4 .plan-top{padding:24px 18px 20px}
.up .grid.c4 .cta{font-size:14px;padding:12px 8px}
.up .grid.c4 .pill{font-size:10px;padding:2px 5px}
.up .credits{padding:16px 24px;border-top:1px solid var(--mp-hair);border-bottom:1px solid var(--mp-hair)}
.up .grid.c4 .credits,.up .grid.c4 .sec{padding-left:18px;padding-right:18px}
.up .credits .main{display:flex;align-items:center;gap:10px;font-weight:700;font-size:14.5px}
.up .credits .main small{color:var(--mp-muted);font-weight:400;font-size:13px}
.up .ico{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:none;font-size:12px;font-weight:700;background:var(--mp-navy);color:#fff}
.up .plan.navy .credits .main b{color:var(--mp-navy)}
.up .tree{margin:6px 0 0 8px;padding-left:20px;border-left:1px solid var(--mp-line);font-size:14px}
.up .tree div{padding:4px 0;position:relative}
.up .tree div::before{content:"";position:absolute;left:-20px;top:14px;width:12px;border-top:1px solid var(--mp-line)}
.up .tree b{font-weight:700}.up .tree span{color:var(--mp-muted)}
.up .sec{padding:16px 24px 14px;border-bottom:1px solid var(--mp-hair)}
.up .sec:last-child{border-bottom:0}
.up .sec h4{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mp-navy);margin-bottom:8px}
.up .item{display:flex;align-items:center;gap:10px;padding:4px 0;font-size:14px;color:var(--mp-body)}
.up .item.no{color:var(--mp-subtle)}
.up .ck{width:16px;height:16px;display:grid;place-items:center;flex:none;color:var(--mp-ok)}
.up .ck svg{width:14px;height:14px}
.up .plan.navy .ck{color:var(--mp-navy)}
.up .x{width:16px;height:16px;display:grid;place-items:center;flex:none;color:var(--mp-faint)}
.up .tag{font-size:11px;font-weight:600;color:var(--mp-muted);border:1px solid var(--mp-line);border-radius:6px;padding:0 6px;margin-left:2px;background:var(--mp-surface)}
.up .item.hl{color:var(--mp-ink);font-weight:600}

/* Strips under the grid */
.up .strip{margin-top:24px;border-radius:8px;border:1px solid var(--mp-line);background:var(--mp-surface);padding:24px 26px;display:grid;grid-template-columns:1.3fr 1fr auto;gap:24px;align-items:center}
.up .strip h3{font-family:var(--mp-font-serif);font-size:22px;font-weight:700}
.up .strip p{color:var(--mp-muted);font-size:14px;margin-top:4px}
.up .strip p b{color:var(--mp-ink)}
.up .strip ul{list-style:none;font-size:14px;display:grid;gap:6px;color:var(--mp-body)}
.up .strip li::before{content:"✓";color:var(--mp-ok);margin-right:8px;font-weight:700}
.up .strip .cta{width:auto;padding:12px 22px;background:var(--mp-navy);color:#fff;border-color:var(--mp-navy)}
.up .strip .cta:hover{background:var(--mp-navy-hover)}
.up .topup{grid-template-columns:auto 1fr auto;padding:18px 22px;background:var(--mp-navy-wash)}
.up .topup .amt{font-family:var(--mp-font-serif);font-size:24px;font-weight:700;color:var(--mp-navy)}
@media(max-width:860px){.up .strip,.up .topup{grid-template-columns:1fr}}
.up .fine{color:var(--mp-muted);font-size:13px;text-align:center;margin-top:26px;line-height:1.7}
.up .fine a{text-decoration:underline;text-underline-offset:2px;color:var(--mp-navy);font-weight:600}
.up .fine b{color:var(--mp-ink)}

/* Section headings — centered, like the old page */
.up .section-title{font-family:var(--mp-font-serif);font-size:clamp(28px,4vw,40px);font-weight:700;text-align:center;margin:88px 0 10px;scroll-margin-top:80px}
.up .section-sub{color:var(--mp-muted);text-align:center;margin:0 auto 32px;max-width:640px}
.up .section-sub .mail{color:var(--mp-navy);font-weight:600}

/* Finder */
.up .finder{display:grid;grid-template-columns:1.15fr 1fr;gap:16px;background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:8px;padding:16px}
@media(max-width:900px){.up .finder{grid-template-columns:1fr}}
.up .steps{padding:12px 8px 12px 12px}
.up .step{display:grid;grid-template-columns:36px 1fr;gap:16px;position:relative;padding-bottom:28px}
.up .step:not(:last-child)::before{content:"";position:absolute;left:17px;top:40px;bottom:0;border-left:1px dashed var(--mp-line)}
.up .num{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--mp-navy);color:#fff;font-weight:700}
.up .step h3{font-family:var(--mp-font-serif);font-size:19px;font-weight:700;margin-top:5px}
.up .step .hint{color:var(--mp-muted);font-size:14px;margin:4px 0 14px}
.up .tasks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.up .task{border:1px solid var(--mp-line);border-radius:8px;padding:12px;background:var(--mp-surface);text-align:left;display:flex;flex-direction:column;gap:20px;min-height:110px;transition:.15s}
.up .task:hover{border-color:var(--mp-navy)}
.up .task .box{width:18px;height:18px;border-radius:4px;border:1.5px solid var(--mp-faint);display:grid;place-items:center;color:var(--mp-surface);background:var(--mp-surface)}
.up .task .box svg{width:11px;height:11px}
.up .task.on{border-color:var(--mp-navy);background:var(--mp-navy-wash)}
.up .task.on .box{background:var(--mp-navy);border-color:var(--mp-navy);color:#fff}
.up .task b{font-size:14px;line-height:1.3;display:block}
.up .task small{color:var(--mp-muted);font-size:12px}
.up .slider-box{border:1px solid var(--mp-line);border-radius:8px;padding:16px;background:var(--mp-wash)}
.up .ticks{display:flex;gap:4px;height:22px;align-items:stretch;margin-bottom:12px}
.up .ticks span{flex:1;border-radius:2px;background:var(--mp-line)}
.up .ticks span.on{background:var(--mp-navy)}
.up input[type=range]{width:100%;accent-color:var(--mp-navy)}
.up .slider-val{display:flex;justify-content:space-between;font-size:14px;margin-top:6px}
.up .slider-val b{color:var(--mp-navy)}
.up .result{border-radius:8px;border:1px solid var(--mp-hair);background:var(--mp-wash);padding:28px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.up .result .billing{background:var(--mp-surface)}
.up .rec{width:100%;display:flex;justify-content:center}
.up .rec .plan{width:100%;max-width:360px}
.up .usage{width:100%;max-width:360px;padding:4px 16px}
.up .usage .row{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--mp-muted)}
.up .usage .row b{display:block;color:var(--mp-ink);font-size:15px}
.up .dots{display:grid;grid-template-columns:repeat(10,8px);gap:4px}
.up .dots i{width:8px;height:8px;border-radius:2px;background:var(--mp-line)}
.up .dots i.on{background:var(--mp-navy)}
.up .usage .note{font-size:13px;color:var(--mp-muted);margin-top:12px}

/* Compare table — the old matrix styling */
.up .tbl-wrap{overflow-x:auto;border:1px solid var(--mp-line);border-radius:8px;background:var(--mp-surface)}
.up .tbl-hint{display:none}
@media(max-width:700px){
  .up .tbl-hint{display:block;text-align:center;font-size:13px;font-weight:600;color:var(--mp-muted);margin:0 0 10px}
  .up .tbl-wrap{-webkit-overflow-scrolling:touch}
  .up table{min-width:560px;font-size:13px}
  .up th,.up td{padding:11px 12px}
  .up th:first-child,.up td:first-child{position:sticky;left:0;z-index:1;background:var(--mp-surface);width:150px;min-width:150px;box-shadow:1px 0 0 var(--mp-hair)}
  .up tr.grp td:first-child{position:static;width:auto;box-shadow:none;background:var(--mp-wash)}
  .up tr.grp td span{position:sticky;left:12px}
}
.up table{width:100%;border-collapse:collapse;font-size:14px;min-width:640px}
.up th,.up td{padding:12px 18px;text-align:center;border-top:1px solid var(--mp-hair)}
.up thead th{border-top:0;padding:16px 18px;font-weight:700;color:var(--mp-body);background:var(--mp-surface)}
.up th:first-child,.up td:first-child{text-align:left;color:var(--mp-ink)}
.up thead th:first-child{color:var(--mp-muted);font-weight:600}
.up thead th.hl{background:var(--mp-navy-wash);color:var(--mp-navy)}
.up td{color:var(--mp-body)}
.up td.hl{background:var(--mp-navy-wash);color:var(--mp-navy);font-weight:600}
.up tr.grp td{color:var(--mp-navy);font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;background:var(--mp-wash);text-align:left;border-top:1px solid var(--mp-line)}
.up .yes{color:var(--mp-ok);font-weight:700}
.up td.hl .yes{color:var(--mp-navy)}

/* FAQ */
.up .faq{display:grid;gap:14px;max-width:820px;margin:0 auto}
.up .qa{border:1px solid var(--mp-line);border-radius:8px;background:var(--mp-surface)}
.up .qa button{width:100%;text-align:left;padding:22px 24px;font-weight:600;font-size:16px;display:flex;justify-content:space-between;gap:16px;color:var(--mp-ink)}
.up .qa button span{color:var(--mp-navy);font-size:20px;line-height:1;transition:transform .2s}
.up .qa.open button span{transform:rotate(45deg)}
.up .qa .a{display:none;padding:0 24px 22px;color:var(--mp-muted);font-size:15px;line-height:1.65}
.up .qa.open .a{display:block}

/* Final CTA — the old wash band */
.up .final{margin:88px 0 60px;border-radius:8px;padding:64px 28px;text-align:center;background:var(--mp-wash);border:1px solid var(--mp-hair)}
.up .final h2{font-family:var(--mp-font-serif);font-size:clamp(28px,4vw,40px);font-weight:700;line-height:1.2;color:var(--mp-ink)}
.up .final p{color:var(--mp-body);font-size:18px;margin:16px auto 28px;max-width:560px}
.up .final .btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.up .final .cta{width:auto;padding:14px 28px;font-size:16px;background:var(--mp-surface);color:var(--mp-navy);border:1px solid var(--mp-line);font-weight:700}
.up .final .cta.light{background:var(--mp-navy);color:#fff;border-color:var(--mp-navy)}
.up .final .cta.light:hover{background:var(--mp-navy-hover)}
.up .final .quote{margin:40px auto 0;padding-top:28px;border-top:1px solid var(--mp-hair);font-size:14px;color:var(--mp-muted);font-style:italic;max-width:none}

.up .float{position:fixed;right:22px;bottom:22px;z-index:40;background:var(--mp-navy);color:#fff;font-weight:600;font-size:14px;padding:12px 18px;border-radius:8px;display:flex;gap:8px;align-items:center}
.up .float:hover{background:var(--mp-navy-hover)}
@media(max-width:600px){.up .float{left:16px;right:16px;justify-content:center}}
`;
