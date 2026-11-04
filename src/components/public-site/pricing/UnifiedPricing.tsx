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
import Link from 'next/link';
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
const SIGNUP_URL = '/signup';
const PRO_CHECKOUT_MONTHLY = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C'; // $149/mo
const PRO_CHECKOUT_ANNUAL = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D'; // $1,490/yr
const TEAMS_CONTACT_URL = 'mailto:hello@getmindy.ai?subject=Mindy%20Teams%20Inquiry';
const ENTERPRISE_MAILTO = 'mailto:hello@getmindy.ai?subject=Mindy%20Enterprise%20%2F%20API%20inquiry';
const MCP_TRIAL_URL = '/app';
const REFERRALS_URL = '/mcp/account?section=referrals';
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
  growth: { tag: 'For working several markets at once.', badge: 'Popular' },
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

function PlanCard({ p, compact }: { p: CardModel; compact?: boolean }) {
  return (
    <div className={`plan ${p.color || ''}`}>
      <div className="plan-top">
        <div className="pname"><h3>{p.name}</h3>{p.badge && <span className="badge">{p.badge}</span>}</div>
        <div className="tagline">{p.tag}</div>
        <div className="price">
          {p.was !== undefined && <span className="was">${fmt(p.was)}</span>}
          <span className="now">${fmt(p.price)}</span>
          <span className="per">{p.per}</span>
        </div>
        <a className="cta" href={p.href}>{p.cta}{p.pill && <span className="pill">{p.pill}</span>}</a>
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

  const tools: Tool[] = cat?.tools ?? [];
  const plans = cat?.subscriptionPlans?.length ? cat.subscriptionPlans : PLANS_FALLBACK;
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
    {
      name: 'Free', tag: 'For contractors just getting started.', price: 0, per: '/mo forever',
      href: SIGNUP_URL, cta: 'Start Free', note: 'No credit card required.',
      credits: [fmt(signupCredits), 'MCP credits', 'one-time'], tree: [['3', 'NAICS codes tracked'], ['Daily', 'opportunity digest']],
      secs: [
        ['Daily intelligence', [['Daily opportunity digest', 1], ['AI-matched briefings', 0], ['Unlimited NAICS codes', 0], ['Target agency filtering', 0]]],
        ['Competitive intelligence', [['Competitor tracking', 0], ['Recompete alerts 12 mo out', 0], ['Incumbent visibility', 0], ['Agency spending analysis', 0]]],
        ['Forecasts & support', [[`${forecastsLabel} agency forecasts`, 1, 'Browse'], ['Weekly market deep dives', 0], ['Email support', 1], ['Priority response (24hr)', 0]]],
      ],
    },
    {
      name: 'Pro', badge: '✦ Most popular', color: 'navy', tag: 'The $150K capture manager in your pocket.',
      price: annual ? 124 : 149, was: annual ? 149 : undefined, per: annual ? '/mo billed yearly' : '/mo',
      href: annual ? PRO_CHECKOUT_ANNUAL : PRO_CHECKOUT_MONTHLY, cta: 'Get Pro', pill: annual ? '-17% · Save $298' : undefined,
      note: annual ? '$1,490/yr · 2 months free' : 'Cancel anytime.',
      credits: [fmt(proCr), 'MCP credits', '/ month'], tree: [['Unlimited', 'NAICS codes'], ['AI-matched', 'daily briefings']],
      secs: [
        ['Daily intelligence', [['Daily opportunity digest', 1], ['AI-matched briefings', 2], ['Unlimited NAICS codes', 2], ['Target agency filtering', 1]]],
        ['Competitive intelligence', [['Competitor tracking', 2], ['Recompete alerts 12 mo out', 2], ['Incumbent visibility', 1], ['Agency spending analysis', 1]]],
        ['Forecasts & support', [[`${forecastsLabel} agency forecasts`, 1, 'Full'], ['Weekly market deep dives', 1], ['Email support', 1], ['Priority response (24hr)', 1]]],
      ],
    },
    {
      name: 'Teams', badge: 'For BD teams', color: 'ink', tag: 'For growing contractors with a BD team.',
      price: 499, per: annual ? '/mo · billed monthly' : '/mo', href: TEAMS_CONTACT_URL, cta: 'Contact Sales',
      note: 'Reply within one business day.',
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
  const mcpCards = plans.map(mcpCard);

  // ---- Finder ----
  const perOpp = TASKS.filter((t) => picked.has(t.id)).reduce((s, t) => s + exampleCost(tools, t.tools), 0);
  const need = perOpp * opps;
  const rec = useMemo((): { card: CardModel | null; cap: number } => {
    if (need <= trial) {
      return {
        cap: trial,
        card: {
          name: 'Free trial', tag: `Your ${trial} signup credits cover a first month.`, badge: '✦ Recommended', color: 'navy',
          price: 0, per: 'one-time', href: MCP_TRIAL_URL, cta: 'Start free', note: 'Granted the moment you connect.',
          credits: [fmt(trial), 'credits', 'one-time'], tree: [['No', 'credit card'], ['All', 'tools included']], secs: [],
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
      cols: ['Free', 'Pro', 'Teams'], hl: 1, rows: [
        ['Daily intelligence'],
        ['Daily opportunity digest', Y, Y, Y], ['AI-matched briefings', N, Y, Y], ['NAICS codes tracked', '3', 'Unlimited', 'Unlimited'], ['Target agency filtering', N, Y, Y],
        ['Competitive intelligence'],
        ['Competitor tracking', N, Y, Y], ['Recompete alerts (12 mo out)', N, Y, Y], ['Incumbent visibility', N, Y, Y], ['Agency spending analysis', N, Y, Y],
        ['Forecast & strategy'],
        [`${forecastsLabel} agency forecasts`, 'Browse', 'Full access', 'Full access'], ['Weekly market deep dives', N, Y, Y],
        ['Team & collaboration'],
        ['Users included', '1', '1', '5 (more on request)'], ['Shared pipeline', N, N, Y], ['Team dashboard', N, N, Y], ['Role-based access', N, N, Y],
        ['AI agent access (MCP)'],
        ['Use Mindy in Claude, Cursor, any agent', Y, Y, Y], ['Credits included', `${fmt(signupCredits)} one-time`, `${fmt(proCr)}/mo`, `${fmt(teamCr)}/mo`], ['Tools available', 'All', 'All', 'All'], ['Buy additional credits', Y, Y, Y],
        ['Support'],
        ['Email support', Y, Y, Y], ['Priority response (24hr)', N, Y, Y], ['Onboarding call', N, N, Y],
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
          <h1><span className="l1">GovWin-grade intel for $149, not $15,000.</span><br /><span className="l2">Start free. No card. No sales call.</span></h1>
          <p>Daily opportunity digest, recompete alerts, competitor tracking — and Mindy&apos;s tools inside Claude, Cursor, or any AI agent.</p>
          <div className="row">
            <span className="chip">✦ {fmt(signupCredits)} free MCP credits on signup</span>
            <span className="chip">↺ Cancel anytime</span>
            <span className="chip">$ 30-day money back on Pro</span>
            <a className="chip" href={REFERRALS_URL}>♥ Refer a friend — you both get 100 credits →</a>
          </div>
        </section>

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
            <BillingToggle saveLabel="Save up to 17%" />
          </div>
        </div>

        <div className={`grid ${tab === 'app' ? 'c3' : 'c4'}`}>
          {(tab === 'app' ? appCards : mcpCards).map((p) => <PlanCard key={p.name} p={p} />)}
        </div>

        {tab === 'app' ? (
          <>
            <div className="strip topup">
              <div className="amt">Need more?</div>
              <div><b>Running agents heavier than {fmt(proCr)} credits/mo?</b><p>Credit-only plans start at ${plans[0]?.monthly.usd ?? 99} for {fmt(plans[0]?.creditsPerMonth ?? 500)}/mo — no app subscription needed, and they work on the same account.</p></div>
              <button type="button" className="cta" onClick={() => goTab('mcp')}>See credit plans →</button>
            </div>
            <p className="fine">
              <b>Every plan includes Mindy&apos;s MCP server</b> — use her tools in Claude, Cursor, or any AI agent. Changes take effect immediately and are pro-rated.<br />
              Need more than 5 seats, SSO or API access? <a href="mailto:hello@getmindy.ai">Email us for a custom quote</a> · <a href={GOVWIN_URL}>See the full GovWin comparison ↗</a>
            </p>
          </>
        ) : (
          <>
            <div className="strip">
              <div><h3>Enterprise / API</h3><p>For primes, agencies, funds, lenders &amp; partners who need the <b>data as a feed or high-volume API</b> — not a seat. Custom credit pool. Volume pricing · annual invoicing.</p></div>
              <ul><li>High-volume programmatic API access</li><li>SSO / SAML · dedicated success manager · SLA</li><li>Custom integrations · data / feed license</li></ul>
              <a className="cta" href={ENTERPRISE_MAILTO}>Contact sales</a>
            </div>
            <div className="strip topup">
              <div className="amt">${fmt(topup.usd)}</div>
              <div><b>One-time top-up · {fmt(topup.credits)} credits</b><p>Ran out mid-month? Refill without changing your plan. Powers auto-recharge. Never expires, carries over at renewal.</p></div>
              <a className="cta" href={topup.checkoutUrl ?? TOPUP_FALLBACK.checkoutUrl}>Buy top-up</a>
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
                    <a className="cta" href={ENTERPRISE_MAILTO}>Contact sales</a>
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
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Feature</th>{c.cols.map((x, i) => <th key={x} className={i === c.hl ? 'hl' : ''}>{x}</th>)}</tr></thead>
            <tbody>
              {c.rows.map((r) => r.length === 1
                ? <tr className="grp" key={r[0]}><td colSpan={c.cols.length + 1}>{r[0]}</td></tr>
                : <tr key={r[0]}><td>{r[0]}</td>{r.slice(1).map((v, i) => <td key={i} className={i === c.hl ? 'hl' : ''}>{v}</td>)}</tr>)}
            </tbody>
          </table>
        </div>

        {/* FAQ */}
        <h2 className="section-title">Pricing questions, answered</h2>
        <p className="section-sub">Still stuck? Email <a href="mailto:hello@getmindy.ai" className="mail">hello@getmindy.ai</a> — reply within one business day.</p>
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
          <h2>Start free.<br />See your first briefing tomorrow.</h2>
          <p>Three NAICS codes, a daily digest, and {fmt(signupCredits)} MCP credits. Upgrade when you&apos;re ready for the full intelligence layer.</p>
          <div className="btns">
            <a className="cta light" href={SIGNUP_URL}>Get Started Free</a>
            <Link className="cta" href="/mcp">Connect Mindy to your AI →</Link>
          </div>
          <p className="quote">&ldquo;The big contractors have armies. You have Mindy.&rdquo;</p>
        </section>
      </div>

      <a className="float" href="#finder">Pick your plan in 30 seconds ↓</a>
    </main>
  );
}

const CSS = `
.up{--bg:#fbfaf7;--panel:#fff;--panel2:#f3f0e9;--line:#e6e1d6;--line2:#d9d3c5;--text:#12100e;--muted:#5d5a54;--dim:#8a857b;--navy:#1b3a6b;--navyl:#e8eef8;--green:#027a48;--greenl:#e3f3ea;--radius:16px;
  background:var(--bg);color:var(--text);font-family:var(--mp-font-sans,Inter,system-ui,sans-serif);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.up *{box-sizing:border-box}
.up h1,.up h2,.up h3,.up h4,.up p,.up ul{margin:0;padding:0}
.up a{color:inherit;text-decoration:none}
.up button{font:inherit;cursor:pointer;border:0;background:none;color:inherit}
.up .wrap{max-width:1160px;margin:0 auto;padding:0 20px}
.up .promo{margin:32px 0 0;border-radius:20px;padding:36px 34px;position:relative;overflow:hidden;color:#fff;background:radial-gradient(110% 150% at 85% 130%,#3d6bb3 0%,#1b3a6b 45%,#0f2447 80%);box-shadow:0 20px 50px rgba(27,58,107,.22)}
.up .promo::after{content:"";position:absolute;inset:0;background:radial-gradient(40% 60% at 90% 10%,rgba(255,255,255,.12),transparent 70%);pointer-events:none}
.up .promo h1{font-family:var(--mp-font-serif);font-weight:700;letter-spacing:-.5px;line-height:1.12;font-size:clamp(26px,4vw,46px)}
.up .promo h1 .l1{color:#fff}.up .promo h1 .l2{color:#a9c4ef}
.up .promo p{margin-top:14px;color:#d5dff0;max-width:640px}
.up .promo .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px;position:relative;z-index:1}
.up .chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);font-size:13px;font-weight:500}
.up .plans-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin:60px 0 28px}
.up .plans-head h2{font-family:var(--mp-font-serif);font-size:clamp(32px,4.6vw,46px);font-weight:700;letter-spacing:-.8px;line-height:1.05}
.up .plans-head p{color:var(--muted);margin-top:12px}
.up .controls{display:flex;gap:10px;flex-wrap:wrap}
.up .seg{display:flex;padding:4px;border-radius:12px;background:var(--panel2);border:1px solid var(--line)}
.up .seg button{padding:9px 16px;border-radius:9px;font-weight:600;font-size:14px;color:var(--muted)}
.up .seg button.on{background:var(--navy);color:#fff}
.up .cmp-seg{width:max-content;margin-bottom:16px}
.up .billing{display:flex;align-items:center;gap:10px;padding:8px 16px;border-radius:12px;background:var(--panel2);border:1px solid var(--line);font-size:14px;color:var(--muted)}
.up .billing .lbl.on{color:var(--text);font-weight:600}
.up .switch{width:36px;height:20px;border-radius:999px;background:#cfc8b8;position:relative;transition:.2s}
.up .switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.up .switch.on{background:var(--navy)}.up .switch.on::after{left:18px}
.up .save{color:var(--green);font-weight:700}
.up .grid{display:grid;gap:22px;align-items:start}
.up .grid.c3{grid-template-columns:repeat(3,1fr)}
.up .grid.c4{grid-template-columns:repeat(4,1fr)}
@media(max-width:1060px){.up .grid.c4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:860px){.up .grid.c3,.up .grid.c4{grid-template-columns:1fr}}
.up .plan-top{border-radius:var(--radius);padding:20px 18px 18px;background:var(--panel2);border:1px solid var(--line2);position:relative}
.up .plan.navy .plan-top{background:linear-gradient(160deg,#3d6bb3 0%,#1b3a6b 45%,#0f2447 100%);border-color:var(--navy);color:#fff;box-shadow:0 18px 44px rgba(27,58,107,.32)}
.up .plan.ink .plan-top{background:linear-gradient(160deg,#3a3631 0%,#1d1b18 50%,#0b0a09 100%);border-color:#0b0a09;color:#fff;box-shadow:0 18px 44px rgba(18,16,14,.25)}
.up .pname{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.up .pname h3{font-family:var(--mp-font-serif);font-size:28px;font-weight:700;line-height:1.2}
.up .badge{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:999px;background:var(--navy);color:#fff;white-space:nowrap}
.up .plan.navy .badge{background:#fff;color:var(--navy)}
.up .plan.ink .badge{background:rgba(255,255,255,.15);color:#fff}
.up .tagline{font-size:13.5px;color:var(--muted);margin-top:4px;min-height:40px}
.up .plan.navy .tagline,.up .plan.navy .price .per,.up .plan.navy .subnote{color:#c9d8f0}
.up .plan.ink .tagline,.up .plan.ink .price .per,.up .plan.ink .subnote{color:#cfc9bf}
.up .price{display:flex;align-items:baseline;gap:8px;margin:18px 0 14px;flex-wrap:wrap}
.up .price .now{font-size:44px;font-weight:700;letter-spacing:-1.5px;line-height:1}
.up .price .was{font-size:44px;font-weight:700;line-height:1;opacity:.35;text-decoration:line-through;text-decoration-thickness:3px;letter-spacing:-1.5px}
.up .price .per{font-size:14px;color:var(--muted)}
.up .cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px 12px;border-radius:8px;background:var(--navy);color:#fff;font-weight:600;font-size:15px;transition:transform .15s;white-space:nowrap}
.up .cta:hover{transform:translateY(-1px)}
.up .plan.navy .cta,.up .plan.ink .cta{background:#fff;color:var(--text);box-shadow:0 4px 16px rgba(0,0,0,.2)}
.up .pill{display:inline-flex;font-size:11.5px;font-weight:700;color:#fff;background:var(--green);padding:3px 8px;border-radius:6px;white-space:nowrap}
.up .subnote{font-size:12px;margin-top:9px;text-align:center;color:var(--muted)}
.up .grid.c4 .price .now,.up .grid.c4 .price .was{font-size:36px}
.up .grid.c4 .cta{font-size:14px;padding:13px 8px}
.up .grid.c4 .pill{font-size:10.5px;padding:3px 6px}
.up .credits{padding:18px 18px 16px;border-bottom:1px solid var(--line)}
.up .credits .main{display:flex;align-items:center;gap:10px;font-weight:700}
.up .credits .main small{color:var(--muted);font-weight:400;font-size:14px}
.up .ico{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:none;font-size:12px;font-weight:700;background:var(--text);color:#fff}
.up .plan.navy .credits .main b{color:var(--navy)}.up .plan.navy .credits .ico{background:var(--navy)}
.up .tree{margin:6px 0 0 8px;padding-left:20px;border-left:1.5px solid var(--line2);font-size:14px}
.up .plan.navy .tree{border-color:#9db4d8}
.up .tree div{padding:5px 0;position:relative}
.up .tree div::before{content:"";position:absolute;left:-20px;top:15px;width:12px;border-top:1.5px solid var(--line2)}
.up .plan.navy .tree div::before{border-color:#9db4d8}
.up .tree b{font-weight:700}.up .tree span{color:var(--muted)}
.up .sec{padding:16px 18px 14px;border-bottom:1px solid var(--line)}
.up .sec:last-child{border-bottom:0}
.up .sec h4{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:10px}
.up .item{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:14.5px}
.up .item.no{color:var(--dim)}
.up .ck{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--greenl);color:var(--green)}
.up .plan.navy .ck{background:var(--navy);color:#fff}
.up .ck svg{width:11px;height:11px}
.up .x{width:18px;height:18px;display:grid;place-items:center;flex:none;color:var(--dim)}
.up .tag{font-size:11px;font-weight:600;color:var(--muted);border:1px solid var(--line2);border-radius:6px;padding:1px 6px;margin-left:2px}
.up .item.hl{color:var(--navy);font-weight:600;text-decoration:underline;text-decoration-color:rgba(27,58,107,.3);text-underline-offset:3px}
.up .strip{margin-top:22px;border-radius:var(--radius);border:1px solid var(--line2);background:var(--panel);padding:24px 26px;display:grid;grid-template-columns:1.3fr 1fr auto;gap:24px;align-items:center}
.up .strip h3{font-family:var(--mp-font-serif);font-size:24px;font-weight:700}
.up .strip p{color:var(--muted);font-size:14px;margin-top:4px}
.up .strip p b{color:var(--text)}
.up .strip ul{list-style:none;font-size:14px;display:grid;gap:6px}
.up .strip li::before{content:"◆";color:var(--navy);margin-right:8px;font-size:11px}
.up .strip .cta{width:auto;padding:13px 22px}
.up .topup{grid-template-columns:auto 1fr auto;padding:18px 22px;background:var(--panel2)}
.up .topup .amt{font-family:var(--mp-font-serif);font-size:26px;font-weight:700;color:var(--navy)}
@media(max-width:860px){.up .strip,.up .topup{grid-template-columns:1fr}}
.up .fine{color:var(--muted);font-size:13px;text-align:center;margin-top:26px;line-height:1.7}
.up .fine a{text-decoration:underline;color:var(--navy)}
.up .fine b{color:var(--text)}
.up .section-title{font-family:var(--mp-font-serif);font-size:clamp(28px,4vw,40px);font-weight:700;letter-spacing:-.6px;margin:96px 0 8px;scroll-margin-top:80px}
.up .section-sub{color:var(--muted);margin-bottom:28px}
.up .section-sub .mail{color:var(--navy);font-weight:600}
.up .finder{display:grid;grid-template-columns:1.15fr 1fr;gap:16px;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:16px;box-shadow:0 10px 30px rgba(18,16,14,.04)}
@media(max-width:900px){.up .finder{grid-template-columns:1fr}}
.up .steps{padding:12px 8px 12px 12px}
.up .step{display:grid;grid-template-columns:36px 1fr;gap:16px;position:relative;padding-bottom:28px}
.up .step:not(:last-child)::before{content:"";position:absolute;left:17px;top:40px;bottom:0;border-left:1.5px dashed var(--line2)}
.up .num{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--navy);color:#fff;font-weight:700}
.up .step h3{font-family:var(--mp-font-serif);font-size:20px;font-weight:700;margin-top:4px}
.up .step .hint{color:var(--muted);font-size:14px;margin:4px 0 14px}
.up .tasks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.up .task{border:1.5px solid var(--line);border-radius:12px;padding:12px;background:var(--panel2);text-align:left;display:flex;flex-direction:column;gap:22px;min-height:110px;transition:.15s}
.up .task .box{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--dim);display:grid;place-items:center;color:transparent;background:#fff}
.up .task .box svg{width:11px;height:11px}
.up .task.on{border-color:var(--navy);background:var(--navyl)}
.up .task.on .box{background:var(--navy);border-color:var(--navy);color:#fff}
.up .task b{font-size:14px;line-height:1.3;display:block}
.up .task small{color:var(--muted);font-size:12px}
.up .slider-box{border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel2)}
.up .ticks{display:flex;gap:4px;height:22px;align-items:stretch;margin-bottom:12px}
.up .ticks span{flex:1;border-radius:2px;background:var(--line2)}
.up .ticks span.on{background:var(--navy)}
.up input[type=range]{width:100%;accent-color:var(--navy)}
.up .slider-val{display:flex;justify-content:space-between;font-size:14px;margin-top:6px}
.up .slider-val b{color:var(--navy)}
.up .result{border-radius:16px;border:1px solid var(--line);background:repeating-linear-gradient(45deg,rgba(27,58,107,.03) 0 2px,transparent 2px 20px),var(--panel2);padding:28px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.up .result .billing{background:#fff}
.up .rec{width:100%;display:flex;justify-content:center}
.up .rec .plan{width:100%;max-width:360px}
.up .usage{width:100%;max-width:360px;padding:4px 16px}
.up .usage .row{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--muted)}
.up .usage .row b{display:block;color:var(--text);font-size:15px}
.up .dots{display:grid;grid-template-columns:repeat(10,8px);gap:4px}
.up .dots i{width:8px;height:8px;border-radius:2px;background:var(--line2)}
.up .dots i.on{background:var(--navy)}
.up .usage .note{font-size:13px;color:var(--muted);margin-top:12px}
.up .tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:16px;background:var(--panel)}
.up table{width:100%;border-collapse:collapse;font-size:14px;min-width:640px}
.up th,.up td{padding:13px 16px;text-align:center;border-bottom:1px solid var(--line)}
.up th:first-child,.up td:first-child{text-align:left;color:var(--text)}
.up thead th{background:var(--panel);font-family:var(--mp-font-serif);font-size:16px;font-weight:700}
.up thead th.hl{background:var(--navy);color:#fff}
.up td{color:var(--muted)}
.up td.hl{background:var(--navyl);color:var(--text)}
.up tr.grp td{color:var(--dim);font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;background:var(--panel2);text-align:left}
.up .yes{color:var(--green);font-weight:700}
.up tbody tr:last-child td{border-bottom:0}
.up .faq{display:grid;gap:10px}
.up .qa{border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.up .qa button{width:100%;text-align:left;padding:18px 20px;font-weight:600;font-size:16px;display:flex;justify-content:space-between;gap:16px}
.up .qa button span{color:var(--navy);font-size:20px;line-height:1;transition:.2s}
.up .qa.open button span{transform:rotate(45deg)}
.up .qa .a{display:none;padding:0 20px 18px;color:var(--muted);font-size:14.5px}
.up .qa.open .a{display:block}
.up .final{margin:96px 0 60px;border-radius:22px;padding:56px 28px;text-align:center;color:#fff;background:radial-gradient(90% 140% at 50% 140%,#3d6bb3,#1b3a6b 50%,#0f2447 85%)}
.up .final h2{font-family:var(--mp-font-serif);font-size:clamp(28px,4vw,42px);font-weight:700;line-height:1.15}
.up .final p{color:#c9d8f0;margin:12px auto 26px;max-width:520px}
.up .final .btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.up .final .cta{width:auto;padding:14px 24px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.3)}
.up .final .cta.light{background:#fff;color:var(--navy);border-color:#fff}
.up .final .quote{margin-top:26px;margin-bottom:0;color:#fff;font-family:var(--mp-font-serif);font-style:italic}
.up .float{position:fixed;right:22px;bottom:22px;z-index:40;background:var(--navy);color:#fff;font-weight:600;padding:13px 20px;border-radius:10px;box-shadow:0 10px 30px rgba(27,58,107,.35);display:flex;gap:8px;align-items:center}
@media(max-width:600px){.up .float{left:16px;right:16px;justify-content:center}}
`;
