/**
 * Competitor comparison data — powers /compare/[competitor] pages (Phase 3 SEO).
 *
 * Each entry = one "<competitor> alternative" page (high commercial-intent
 * keyword every player in the space ranks for). HONEST comparison style (admit
 * tradeoffs — Google rewards it, prospects trust it). The hand-built
 * /compare/govwin + /compare/sam-gov pages stay as-is; these add the rest fast.
 *
 * Facts grounded where public (pricing/positioning); claims kept honest (rule
 * #10). The "whenToChoose" field is deliberate credibility insurance.
 */
export interface Competitor {
  slug: string;
  name: string;
  /** One-line what-they-are. */
  tagline: string;
  /** Their pricing, honestly (public or "enterprise quote"). */
  pricing: string;
  /** SERP title + meta. */
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  /** Hero subhead — the wedge in one sentence. */
  wedge: string;
  /** Comparison rows: [dimension, them, mindy]. */
  rows: [string, string, string][];
  /** Honest "when to choose THEM instead" (credibility). */
  whenToChoose: string;
  /** 3–4 FAQ pairs (also emitted as FAQPage JSON-LD). */
  faqs: { q: string; a: string }[];
}

export const COMPETITORS: Competitor[] = [
  {
    slug: 'highergov',
    name: 'HigherGov',
    tagline: 'a broad federal + SLED data and CRM platform (acquired by Procurement Sciences, 2026)',
    pricing: '$500–$5,000/yr (Investor tier higher)',
    metaTitle: 'HigherGov Alternative [2026] — AI Federal Market Intelligence for Small Business | Mindy',
    metaDescription:
      'Mindy is the AI-analyst alternative to HigherGov: daily alerts, incumbent intel, and response drafting — answers, not just a database. Built for small businesses.',
    keywords: ['highergov alternative', 'highergov competitor', 'highergov vs mindy', 'highergov pricing alternative', 'cheaper than highergov', 'federal market intelligence small business'],
    wedge:
      'HigherGov is a bigger database. Mindy is the AI analyst that reads it for you — finds the opportunity, sizes up the incumbent on real award data, and drafts your response.',
    rows: [
      ['Starting price', '$500/yr', '$149/mo Pro (14-day free trial)'],
      ['Best for', 'Established teams that interpret data themselves', 'Solo + small businesses that want answers'],
      ['Core strength', 'Broadest data coverage incl. SLED', 'AI that drafts + analyzes, grounded in real data'],
      ['Drafting (proposals / market research)', 'Newer (via 2026 acquisition)', 'Built-in: MRR + proposal drafting from the actual notice'],
      ['Free tier', 'No (floor is $500/yr)', 'No — 14-day free trial instead'],
      ['Setup', 'Data platform to learn', '3-minute signup, first alert next morning'],
    ],
    whenToChoose:
      'Choose HigherGov (now part of Procurement Sciences AI) if you need deep state & local (SLED) coverage, GSA catalog/labor-rate pricing data, or you’re an investor/large prime wanting the broadest raw dataset and a team to mine it. Mindy is federal-focused, answer-first, and built for small businesses — with a 14-day free trial.',
    faqs: [
      { q: 'Is Mindy a HigherGov alternative?', a: 'Yes — for federal small businesses. HigherGov is a broad data platform you interpret yourself; Mindy is an AI analyst that finds the opportunity, analyzes the incumbent on real award data, and drafts your response. Pro starts with a 14-day free trial (HigherGov starts at $500/yr).' },
      { q: 'Does Mindy have SLED (state & local) data like HigherGov?', a: 'Not yet — Mindy is federal-focused today. If state & local is your core market, HigherGov has deeper SLED coverage. For federal opportunities, recompetes, and contractor intel, Mindy delivers more analysis per dollar.' },
      { q: 'How is Mindy different now that HigherGov was acquired?', a: 'HigherGov joined Procurement Sciences in 2026 to add AI capture tools. Mindy was AI-grounded analysis from the start — every figure cites its source (USASpending/SAM, dated), and it drafts responses from the actual solicitation, not generic AI.' },
      { q: 'Is there a free version?', a: 'There’s a 14-day free trial. Pick Pro ($149/mo) or Team on the pricing page — card required, no charge for 14 days — for full briefings, incumbent tracking, recompete alerts, and response drafting.' },
    ],
  },
  {
    slug: 'govtribe',
    name: 'GovTribe',
    tagline: 'a federal contracting data + tracking platform (owned by GovExec)',
    pricing: 'subscription (per-seat)',
    metaTitle: 'GovTribe Alternative [2026] — AI Federal Opportunity Intelligence for Small Business | Mindy',
    metaDescription:
      'Mindy is the AI-analyst alternative to GovTribe: daily alerts, incumbent intel, and proposal drafting grounded in real award data. Built for small federal contractors.',
    keywords: ['govtribe alternative', 'govtribe competitor', 'govtribe vs mindy', 'cheaper than govtribe', 'federal opportunity tracking small business'],
    wedge:
      'GovTribe tracks the data. Mindy analyzes it and drafts your response — answers, not just dashboards — with a 14-day free trial.',
    rows: [
      ['Starting price', 'Per-seat subscription', '$149/mo Pro (14-day free trial)'],
      ['Best for', 'Tracking opportunities + agencies', 'Finding, analyzing, and responding to them'],
      ['AI analysis + drafting', 'Limited', 'Built-in (incumbent intel + MRR + proposal drafting)'],
      ['Free tier', 'No', 'No — 14-day free trial instead'],
      ['Setup', 'Account + onboarding', '3-minute signup'],
    ],
    whenToChoose:
      'Choose GovTribe if your team is already standardized on it for agency/people tracking. Mindy is the better fit if you want grounded AI analysis and drafting at a small-business price (with a 14-day free trial to start).',
    faqs: [
      { q: 'Is Mindy a GovTribe alternative?', a: 'Yes. GovTribe is strong at tracking opportunities, agencies, and people. Mindy adds the AI-analyst layer — incumbent analysis, market research, and proposal drafting grounded in real award data — and starts with a 14-day free trial.' },
      { q: 'Does Mindy cost less than GovTribe?', a: 'Mindy Pro is $149/mo, month-to-month, and starts with a 14-day free trial. It’s built to be accessible to solo and small federal contractors, not just teams.' },
      { q: 'Is there a free version of Mindy?', a: 'There’s a 14-day free trial of Pro or Team. Pick a plan on the pricing page — card required, no charge for 14 days.' },
    ],
  },
  {
    slug: 'procurement-sciences',
    name: 'Procurement Sciences AI',
    tagline: 'an enterprise AI capture/proposal platform (now owns HigherGov); ~$40K/yr',
    pricing: '~$40,000/yr (enterprise, FedRAMP)',
    metaTitle: 'Procurement Sciences AI Alternative [2026] — Affordable AI for Small GovCon | Mindy',
    metaDescription:
      'Mindy is the small-business alternative to Procurement Sciences AI (Awarded AI / HigherGov): daily alerts and AI opportunity intel vs ~$40K/yr enterprise. No sales call.',
    keywords: ['procurement sciences ai alternative', 'awarded ai alternative', 'procurement sciences competitor', 'cheaper than procurement sciences', 'small business govcon ai', 'highergov procurement sciences alternative'],
    wedge:
      'Procurement Sciences AI is a ~$40K/yr enterprise capture suite built for the Top 100 primes. Mindy gives a solo or small federal contractor the opportunity + competitor intelligence that actually matters — $149/mo Pro with a 14-day free trial, no sales call.',
    rows: [
      ['Starting price', '~$40,000/yr (enterprise)', '$149/mo Pro (14-day free trial)'],
      ['Built for', 'Top-100 primes + capture teams', 'Solo + small federal contractors'],
      ['Owns', 'HigherGov (acquired 2026) + Awarded AI', 'Mindy (focused, not a roll-up)'],
      ['Setup', 'Enterprise sales + onboarding', '3-minute signup, no sales call'],
      ['Free tier', 'No', 'No — 14-day free trial instead'],
      ['Fit for a 1–10 person shop', 'Overkill (and over-priced)', 'Exactly the target'],
    ],
    whenToChoose:
      'Choose Procurement Sciences AI if you’re a large prime or a 50+ person BD/capture organization that needs a full FedRAMP enterprise suite (capture workflow, proposal automation, compliance) and the budget for it. Mindy is for the small businesses that tier prices out — daily opportunity flow, incumbent intel, and drafting at 1% of the cost.',
    faqs: [
      { q: 'Is Mindy a Procurement Sciences AI alternative?', a: 'For small federal contractors, yes. Procurement Sciences (which now owns HigherGov and runs Awarded AI) is a ~$40K/yr enterprise platform built for large primes and capture teams. Mindy delivers the opportunity discovery, incumbent intelligence, and response drafting a small business actually uses — $149/mo Pro with a 14-day free trial.' },
      { q: 'How much cheaper is Mindy than Procurement Sciences?', a: 'Procurement Sciences AI runs around $40,000/yr on enterprise contracts. Mindy Pro is $149/mo, month-to-month, with a 14-day free trial — roughly 1% of the cost for the intelligence a small contractor needs day to day.' },
      { q: 'Procurement Sciences bought HigherGov — does that change things?', a: 'It confirms the market is consolidating up-market toward large primes. That leaves small businesses underserved — which is exactly who Mindy is built for. Same grounded, AI-drafted intelligence, at a price a small shop can actually afford, with no enterprise sales call.' },
      { q: 'Is there a free version?', a: 'There’s a 14-day free trial. Pick Pro or Team on the pricing page — card required, no charge for 14 days — for full briefings, incumbent tracking, recompete alerts, and response drafting.' },
    ],
  },
  {
    slug: 'bloomberg-government',
    name: 'Bloomberg Government',
    tagline: 'an enterprise government affairs + contracting intelligence suite',
    pricing: 'enterprise (typically $5K–$15K+/yr per seat)',
    metaTitle: 'Bloomberg Government Alternative [2026] — Affordable Federal Market Intelligence | Mindy',
    metaDescription:
      'Mindy is the small-business alternative to Bloomberg Government (BGOV): daily alerts and AI opportunity intel vs enterprise per-seat pricing. No sales call.',
    keywords: ['bloomberg government alternative', 'bgov alternative', 'bloomberg government competitor', 'cheaper than bloomberg government', 'affordable federal market intelligence'],
    wedge:
      'Bloomberg Government is built (and priced) for large government-affairs teams. Mindy gives a small federal contractor the opportunity + competitor intelligence that matters, at a fraction of the cost.',
    rows: [
      ['Starting price', '$5K–$15K+/yr per seat (enterprise)', '$149/mo Pro (14-day free trial)'],
      ['Best for', 'Large GR/policy + BD teams', 'Solo + small federal contractors'],
      ['Setup', 'Enterprise sales + onboarding', '3-minute signup, no sales call'],
      ['Free tier', 'No', 'No — 14-day free trial instead'],
      ['Focus', 'Policy + legislative + contracting', 'Contracting opportunity + competitor intel, AI-drafted'],
    ],
    whenToChoose:
      'Choose Bloomberg Government if you need deep legislative/policy tracking and government-affairs tooling for a large team. Mindy is for contractors who need opportunity flow, recompete alerts, and competitor intel without the enterprise price tag.',
    faqs: [
      { q: 'Is Mindy a Bloomberg Government alternative?', a: 'For federal contractors focused on winning work, yes. BGOV is a broad, enterprise-priced policy + contracting suite. Mindy delivers the contracting-opportunity and competitor intelligence a small business actually uses — with a 14-day free trial and no sales call.' },
      { q: 'How much cheaper is Mindy?', a: 'BGOV is typically thousands per seat per year on annual enterprise contracts. Mindy Pro is $149/mo, month-to-month, with a 14-day free trial.' },
      { q: 'Do I need a demo or sales call?', a: 'No. Pick a plan and start your 14-day free trial — your first briefing lands the next morning — no enterprise sales friction.' },
    ],
  },
];

export const COMPETITOR_SLUGS = COMPETITORS.map((c) => c.slug);
export function getCompetitor(slug: string): Competitor | undefined {
  return COMPETITORS.find((c) => c.slug === slug.toLowerCase());
}
