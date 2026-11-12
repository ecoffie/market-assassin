'use client';

/**
 * /pricing — three plans, little text (modeled on Fyxer's pricing page, Nov 2026).
 * Pro and Team start a 14-day free trial (card required); Enterprise goes to sales.
 * No Free plan on this page. Credit allowances come from the server constants as props.
 * The credit-only MCP plans keep their own page at /mcp/pricing.
 */
import { useState } from 'react';
import Link from 'next/link';
import MemberProof from '@/components/public-site/MemberProof';
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
};

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function SimplePricing({ proCredits, teamCredits, faqs }: {
  proCredits: number; teamCredits: number; faqs: { q: string; a: string }[];
}) {
  const [annual, setAnnual] = useState(true);
  const maxPct = pctOff(TEAM_ANNUAL_USD, TEAM_MONTHLY_USD);

  const plans: Plan[] = [
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

  return (
    <main className="sp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <section className="hero">
        <h1>Plans that grow with you</h1>
        <MemberProof />
      </section>

      <div className="toggle" role="group" aria-label="Billing period">
        <button type="button" className={!annual ? 'on' : ''} aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
        <button type="button" className={annual ? 'on' : ''} aria-pressed={annual} onClick={() => setAnnual(true)}>Annual (up to {maxPct}% off)</button>
      </div>

      <section className="cards" id="plans">
        {plans.map((p) => (
          <article key={p.name} className={`card ${p.featured ? 'featured' : ''}`}>
            <h2>{p.name}</h2>
            <p className="tag">{p.tag}</p>
            {p.price ? (
              <div className="price"><span className="now">{p.price}</span>{p.was && <span className="was">{p.was}</span>}</div>
            ) : (
              <div className="price"><span className="now sales">Speak to sales</span></div>
            )}
            <p className="per">{p.per}</p>
            {p.trial && <p className="trial">14 day free trial</p>}
            <a className={`cta ${p.outline ? 'outline' : ''}`} href={p.href}>{p.cta}</a>
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
.sp .lead{font-weight:600;margin:0}
.sp .base{color:var(--mp-muted);font-size:13px;margin:2px 0 12px}
.sp ul{list-style:none;margin:0 0 22px;padding:0;display:grid;gap:12px}
.sp li{display:flex;gap:10px;font-size:14px;line-height:1.4}
.sp li .tick{color:var(--mp-ok);font-weight:700}
.sp li b{display:block;font-weight:600}
.sp li small{display:block;color:var(--mp-muted);font-size:13px}
.sp .usage{margin-top:auto;border:1px solid var(--mp-line);border-radius:12px;padding:14px 16px;background:var(--mp-wash);display:grid;gap:4px}
.sp .usage .ul{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mp-muted)}
.sp .usage b{font-size:14px;font-weight:600}
.sp .foot{text-align:center;font-size:14px;color:var(--mp-muted);margin:16px 0 0}
.sp .foot a,.sp .fine a{color:var(--mp-navy)}
.sp .fine{text-align:center;color:var(--mp-muted);font-size:13px;line-height:1.6;max-width:640px;margin:28px auto 0}
.sp .faq{max-width:760px;margin:64px auto 0}
.sp .faq h2{font-family:var(--mp-font-serif);font-size:32px;font-weight:700;text-align:center;margin:0 0 20px}
.sp details{border-top:1px solid var(--mp-line);padding:16px 0}
.sp details:last-child{border-bottom:1px solid var(--mp-line)}
.sp summary{cursor:pointer;font-weight:600}
.sp details p{color:var(--mp-body);line-height:1.6;margin:10px 0 0}
`;
