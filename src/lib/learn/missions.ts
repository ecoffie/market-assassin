/**
 * Mindy Learn — the missions, as static data (Learn PR B).
 *
 * Source: tasks/mindy-learn-tutorial-copy-2026-10-08.md, approved by Eric 2026-10-10. Copy is
 * transcribed, not rewritten; internal notes (table names, ruling numbers, PR numbers) are kept out
 * of anything rendered and live only in `evidence` / code comments.
 *
 * Rules the data obeys (each pinned by missions.unit.test.ts):
 *   · Every one of the 27 Action Plan step IDs is covered by a mission or an Outside Mindy entry.
 *   · Levels are stages, not gates: Beginner = Learn the Game, Intermediate = Play the Game,
 *     Advanced = Win the Game, then After the Win. Nothing is locked; every tutorial is public.
 *   · Access labels are fixed text (`free` | `signin` | `pro` | `outside` | `coming-next`). Learn reads
 *     no tier and changes no gate. A `coming-next` or `outside` mission has NO "Do it" link.
 *   · Every Map "Do it" link carries a market parameter, so the Map's return-memory restore stands down
 *     and the user lands on the view the tutorial describes.
 *   · No progress exists yet. `evidence` describes what WILL count (signed-in progress, a later phase);
 *     `tracked: false` marks the five missions that will never show a checkmark until a reliable server
 *     record exists.
 */
import { HORIZON_LABELS } from '@/lib/opportunities/horizon-labels';

export type StageKey = 'learn' | 'play' | 'win' | 'after';
export type Access = 'free' | 'signin' | 'pro' | 'outside' | 'coming-next';

export const STAGES: ReadonlyArray<{ key: StageKey; level: string; name: string; blurb: string }> = [
  { key: 'learn', level: 'Beginner', name: 'Learn the Game', blurb: 'Know your market and how it’s bought. One time through.' },
  { key: 'play', level: 'Intermediate', name: 'Play the Game', blurb: 'Work your market every week: buyers, incumbents, partners and people.' },
  { key: 'win', level: 'Advanced', name: 'Win the Game', blurb: 'Shape a buy, decide whether to bid, and respond.' },
  { key: 'after', level: 'After the Win', name: 'After the Win', blurb: 'Deliver the contract. These steps happen outside Mindy.' },
];

export const ACCESS_LABEL: Record<Access, string> = {
  free: 'Free',
  signin: 'Free · sign in',
  pro: 'Pro',
  outside: 'Outside Mindy',
  'coming-next': 'Coming next',
};

export type Mission = {
  id: string;
  slug: string;
  stage: StageKey;
  title: string;
  steps: readonly string[];          // Action Plan step IDs
  minutes?: number;
  learn: string;
  why?: string;
  example?: string;
  truths?: readonly string[];
  mindy: string;                     // what Mindy can actually do today
  howTo?: readonly string[];
  doIt?: { label: string; href: string };
  access: Access;
  accessNote?: string;
  status: 'live' | 'coming-next' | 'outside';
  tracked: boolean;                  // false = "Not tracked yet": never shows a checkmark
  evidence?: string;                 // internal: what will count as done (later phase). Not rendered.
  next?: string;                     // mission id
  glossary?: readonly string[];      // /glossary/<slug>
};

const ON = HORIZON_LABELS.open;
const BACK = HORIZON_LABELS.recompete;
const SOON = HORIZON_LABELS.forecast;

export const MISSIONS: readonly Mission[] = [
  // ── BEGINNER — LEARN THE GAME ───────────────────────────────────────────────
  {
    id: 'B1', slug: 'tell-mindy-what-you-sell', stage: 'learn', title: 'Tell Mindy what you sell', steps: ['P1-02'], minutes: 3,
    learn: 'What a NAICS code is, why the obvious code usually isn’t enough, and why you describe the work before you pick codes.',
    why: 'Buyers don’t search for company names. They search for work, and they file each purchase under a code. If your codes are wrong, you won’t see the work, alerts won’t match it, and your SAM profile tells buyers the wrong story.',
    example: 'A company that cleans offices picks one janitorial code and stops. But the same kind of work is often filed under neighboring codes, such as facilities support or building maintenance. Describing the work (“we clean and maintain office buildings and medical clinics”) lets Mindy check which codes buyers actually used.',
    truths: ['The obvious code usually misses part of your market. The same work is filed under several codes.'],
    mindy: 'Read your plain-English description and suggest codes with reasons. They’re labeled as not saved until you confirm.',
    howTo: [
      'Open Describe my work.',
      'Fill in “What does your company do?” in one or two sentences about the work, not the company. Add certifications and states if they apply.',
      'Click Show me my market →.',
      'Review the suggested codes. Remove any that aren’t you.',
      'Click Confirm selections. (“Use Mindy’s suggestions” saves too, but doesn’t count as your confirmation. “Skip for now” saves nothing.)',
    ],
    doIt: { label: 'Describe my work', href: '/welcome/company?next=/learn' },
    access: 'signin', accessNote: 'Signed out, the page says “Sign in to save your selections — nothing was saved.”',
    status: 'live', tracked: true,
    evidence: "user_notification_settings.naics_source='user_confirmed', OR hand-edited non-seed codes, OR a real business description. Not: defaults, suggestion-only saves, skips.",
    next: 'B2', glossary: ['naics-code', 'psc'],
  },
  {
    id: 'B2', slug: 'see-your-three-horizons', stage: 'learn', title: 'See your three horizons', steps: ['P2-01'], minutes: 4,
    learn: 'The difference between work you can bid today, contracts that will be bought again, and work an agency plans to buy.',
    why: 'Most contractors only look at what’s open today. By the time a solicitation posts, the buyer has often already met the companies it expects to bid. Positioning happens earlier.',
    example: `Today you see an open cleaning solicitation (${ON}). You also see a cleaning contract at a VA clinic that ends next year (${BACK}), and a forecast for grounds maintenance at the same base (${SOON}). Only the first can be bid this week. The other two tell you who to get in front of now.`,
    truths: [
      `Only ${ON} is biddable today.`,
      `${SOON} is an agency’s plan, not a solicitation: no solicitation number, no deadline, nothing to submit yet.`,
    ],
    mindy: `Show all three horizons on one map, in your market. Each listing opens a drawer: an ${ON} listing; a ${BACK} contract with incumbent and end date; a ${SOON} forecast, marked as not yet on SAM.`,
    howTo: [
      'Click Open my market →. The map opens with all three horizons on.',
      'Use Horizons to see the three layers. Each has its own color.',
      `Open one ${ON} listing.`,
      `Open one ${BACK} contract.`,
      `Open one ${SOON} item.`,
    ],
    doIt: { label: 'Open my market', href: '/opportunity-map?horizon=open,recompete,forecast' },
    access: 'free', accessNote: 'Free to browse. Sign in to record progress.',
    status: 'live', tracked: true,
    evidence: 'Signed-in listing_open in each horizon (metadata.horizon), OR a saved row in that horizon.',
    next: 'B3', glossary: ['recompete', 'forecast', 'rfp'],
  },
  {
    id: 'B3', slug: 'find-who-buys-what-you-sell', stage: 'learn', title: 'Find who buys what you sell', steps: ['P2-01'], minutes: 6,
    learn: 'Why you target a buying office, not an agency, and how to find the offices that already buy your work.',
    why: 'Agencies don’t buy; their contracting offices do. The Army is thousands of offices, and only a handful buy what you sell. Your Top 25 is a list of offices and people, not logos.',
    example: '“I want to sell to the VA” is not a plan. “The contracting office at the VA medical center in Richmond posted three cleaning notices this year, and here is the buyer’s email” is a plan.',
    truths: ['Target the buying office, not the department.'],
    mindy: `Players → Player type: Gov Buyers shows the buyers behind opportunities in your market. A buyer drawer shows The opportunities they run, Their office · agency intel, How to reach them (email and phone), and other contacts at that office. The Buyer tab on any ${ON} listing shows the office that posted it. You can save a buyer with the heart.`,
    howTo: [
      'Click Find my buyers → and sign in if asked.',
      'Set Player type to Gov Buyers.',
      'Open a buyer. Read the opportunities they run and how to reach them.',
      'Do this for 5 different buying offices.',
      'Save the ones worth working (heart).',
    ],
    doIt: { label: 'Find my buyers', href: '/opportunity-map?mode=companies' },
    access: 'signin', accessNote: 'Discovering buyers is free with sign-in. Building a working Top 25 target list with outreach tracking is Pro, and is coming next.',
    status: 'live', tracked: true,
    evidence: ">=5 distinct office_viewed (signed in) OR >=1 user_saved_opportunities source='buyer_map'.",
    next: 'B4', glossary: ['contracting-officer', 'point-of-contact', 'osdbu'],
  },
  {
    id: 'B4', slug: 'find-a-contract-coming-back', stage: 'learn', title: `Find a contract ${BACK}`, steps: ['P2-06'], minutes: 5,
    learn: 'How recompetes work, the three facts to know about one (who holds it, when it ends, who buys it), and the two ways in: compete for it, or sub to the incumbent.',
    why: 'Every contract has an end date. When it ends, the agency buys again, often from companies it already knows. Finding it a year out gives you time to get known before the solicitation posts.',
    example: 'A five-year facilities contract at a base ends in 14 months. The incumbent is a mid-size firm. You can introduce yourself to the contracting office now. Or, if you’re too small to prime it, you can call the incumbent about subcontracting. That is the “Identify Sub Opportunities” half of this step.',
    truths: [
      `${BACK} is not an open solicitation. You can’t bid on it today.`,
      'If no incumbent is named, treat it as unknown. Don’t guess.',
      'An expired contract has already been re-bought or ended. Pick an active one.',
    ],
    mindy: 'Show contracts in your market approaching their end date. Each drawer shows Recompete facts and Contract history · who holds this now (incumbent, UEI, contract number). It shows the contract value, or “Value not disclosed” when USASpending has no ceiling. Status reads Expiring soon or Expired. Track this recompete saves it.',
    howTo: [
      `Click Show contracts ${BACK} →.`,
      'Open a contract that is not marked Expired.',
      'Note the incumbent, the end date and the buying agency.',
      'Click Track this recompete.',
    ],
    doIt: { label: `Show contracts ${BACK}`, href: '/opportunity-map?horizon=recompete' },
    access: 'free', accessNote: 'Free to browse. Sign in to track.',
    status: 'live', tracked: true,
    evidence: ">=1 user_saved_opportunities source='recompete_map'. Sticky once seen.",
    next: 'B5', glossary: ['recompete', 'idiq', 'task-order'],
  },
  {
    id: 'B5', slug: 'put-your-market-on-watch', stage: 'learn', title: 'Put your market on watch', steps: ['P3-01'], minutes: 3,
    learn: 'How to turn “check SAM every morning” into a system, which notice types matter, and what a set-aside label does and doesn’t tell you.',
    why: 'Searching by hand doesn’t scale, and a Sources Sought with a ten-day response window is gone if you check weekly. A watch keeps checking your market and emails you when something new matches.',
    example: 'You save “Cleaning · VA · Virginia”. Two days later a Sources Sought posts. You get an email the next morning and answer it, which can shape whether the buy becomes a small-business set-aside.',
    truths: [
      `A watch emails you new ${ON} and ${SOON} items. ${BACK} contracts are not in alerts, so check them yourself.`,
      '“Set-aside not stated” is not the same as “open to everyone”. Read the notice.',
    ],
    mindy: 'Save search on the map saves your current view as a watch with alerts on (daily by default; weekly or paused available).',
    howTo: [
      `Click Watch my market →. The map opens with ${ON} and ${SOON} on.`,
      'Narrow it if you want: state, set-aside, keyword.',
      'Click Save search and name it.',
      'Confirm you see ✓ Saved — alerts on.',
    ],
    doIt: { label: 'Watch my market', href: '/opportunity-map?horizon=open,forecast' },
    access: 'signin', accessNote: 'Signed out, the watch is kept on this browser with alerts off, until you sign in and turn alerts on.',
    status: 'live', tracked: true,
    evidence: '>=1 saved_searches row for the email (not anon) with alerts_enabled=true. Claude schedule_market_search watches count.',
    next: 'B6', glossary: ['sources-sought', 'set-aside', 'rule-of-two'],
  },
  {
    id: 'B6', slug: 'record-your-sam-identity', stage: 'learn', title: 'Record your SAM identity', steps: ['P1-03'],
    learn: 'No active SAM registration means no award. The difference between a UEI and a CAGE code. Registration must be renewed every year.',
    mindy: 'The Company Vault stores your legal name and UEI. It does not read or verify SAM. Registering itself is done on SAM.gov.',
    doIt: { label: 'Open my Company Vault', href: '/opportunity-map/vault' },
    access: 'signin', status: 'live', tracked: true,
    evidence: 'user_identity_profile.uei set (self-entered, NOT SAM-verified).',
    next: 'B7',
  },
  {
    id: 'B7', slug: 'teach-mindy-your-past-work', stage: 'learn', title: 'Teach Mindy your past work', steps: ['P1-06', 'P4-04'],
    learn: 'A capability statement is a one-page “business resume”. Evidence beats adjectives. Self-performed work is a differentiator.',
    mindy: 'In the Vault: Teach Mindy a contract (past performance) and Teach Mindy a capability.',
    doIt: { label: 'Open my Company Vault', href: '/opportunity-map/vault' },
    access: 'signin', status: 'live', tracked: true,
    evidence: '>=1 user_past_performance row (not the AI sample).',
    next: 'I1',
  },

  // ── INTERMEDIATE — PLAY THE GAME ────────────────────────────────────────────
  {
    id: 'I1', slug: 'get-ahead-of-coming-soon', stage: 'play', title: `Get ahead of ${SOON}`, steps: ['P2-01'],
    learn: 'A forecast is a plan, not a solicitation. How to use 6–18 months of lead time for capture, not bidding.',
    mindy: 'The forecast drawer shows planned work, marked not yet on SAM, with Expected on the street and Estimated value. Track this buy saves it.',
    doIt: { label: `Show ${SOON}`, href: '/opportunity-map?horizon=forecast' },
    access: 'signin', status: 'live', tracked: true,
    evidence: ">=1 user_pipeline row notice_id LIKE 'fc-%'.",
    next: 'I2', glossary: ['forecast'],
  },
  {
    id: 'I2', slug: 'know-the-incumbent', stage: 'play', title: 'Know the incumbent', steps: ['P2-06'],
    learn: 'Ceiling vs obligated value. The contract vehicle. Why a missing incumbent stays unknown.',
    mindy: `The ${BACK} drawer shows contract history, UEI, contract number and View on USASpending ↗. The company drawer shows Award history · what they’ve won.`,
    doIt: { label: `Show contracts ${BACK}`, href: '/opportunity-map?horizon=recompete' },
    access: 'free', status: 'live', tracked: false,
    next: 'I3', glossary: ['recompete', 'idiq'],
  },
  {
    id: 'I3', slug: 'find-primes-and-partners', stage: 'play', title: 'Find the primes and partners in your market', steps: ['P2-05', 'P4-05'],
    learn: 'Primes are buyers too. Get on the supplier lists of the firms that win your work. Pick partners from real award history.',
    mindy: 'Players → Companies shows the firms winning your market. Add to targets or the heart saves a company. Getting onto a prime’s supplier portal happens outside Mindy.',
    doIt: { label: 'Show the companies in my market', href: '/opportunity-map?mode=companies' },
    access: 'signin', status: 'live', tracked: true,
    evidence: ">=1 user_saved_opportunities source='company_map'.",
    next: 'I4',
  },
  {
    id: 'I4', slug: 'reach-the-people', stage: 'play', title: 'Reach the people', steps: ['P2-02'],
    learn: 'Who to contact at each stage: the contracting officer, the small-business specialist (OSDBU/SBLO), the program office. What a capability briefing is.',
    mindy: `On any ${ON} listing: Decision makers · named on this notice (no sign-in needed). In a buyer drawer: How to reach them. The agency roster needs sign-in. Small-business office contacts are available when you use Mindy in Claude. The meeting itself happens outside Mindy.`,
    doIt: { label: `Open ${ON} listings`, href: '/opportunity-map?horizon=open' },
    access: 'signin', accessNote: 'Contacts on a listing are free; the roster needs sign-in. Outreach tracking is Pro, and is coming next.',
    status: 'live', tracked: false,
    next: 'I5', glossary: ['contracting-officer', 'osdbu', 'point-of-contact'],
  },
  {
    id: 'I5', slug: 'find-an-industry-day', stage: 'play', title: 'Find an industry day', steps: ['P2-03'],
    learn: 'An industry day or site visit is a pre-solicitation signal and a chance to meet the buyer.',
    mindy: `On an ${ON} listing: Upcoming events (sign in). In a buyer drawer: How this buyer engages industry. There is no events map yet; full event search is available when you use Mindy in Claude. Attending happens outside Mindy.`,
    doIt: { label: `Open ${ON} listings`, href: '/opportunity-map?horizon=open' },
    access: 'signin', status: 'live', tracked: false,
    next: 'I6',
  },
  {
    id: 'I6', slug: 'build-your-top-25', stage: 'play', title: 'Build your Top 25 buyers', steps: ['P2-01'],
    learn: 'Why 25: enough coverage, still workable. How to work a list over time.',
    mindy: 'The Map does not yet have a target list you can build here.',
    access: 'coming-next', accessNote: 'Pro when it ships.', status: 'coming-next', tracked: true,
    evidence: 'user_target_list user-added >=5 -> 10 -> 25.',
    next: 'A1',
  },

  // ── ADVANCED — WIN THE GAME ─────────────────────────────────────────────────
  {
    id: 'A1', slug: 'answer-a-sources-sought', stage: 'win', title: 'Shape a buy: answer a Sources Sought', steps: ['P3-04'],
    learn: 'A Sources Sought is market research. Answering it can decide whether the buy is set aside. A response is not a proposal.',
    mindy: 'On a Sources Sought listing, Generate proposal opens the workspace in letter-of-interest mode (LOI Opening → Relevant Experience → Capability Fit → Why Us → Point of Contact), then Export response (.docx). Opening it also tracks the listing as a pursuit.',
    doIt: { label: 'Show Sources Sought', href: '/opportunity-map?strategy=sources_sought' },
    access: 'pro', status: 'live', tracked: true,
    evidence: 'proposal_exported server event on a Sources Sought notice.',
    next: 'A2', glossary: ['sources-sought', 'set-aside', 'rule-of-two'],
  },
  {
    id: 'A2', slug: 'should-i-bid', stage: 'win', title: 'Decide: should I bid?', steps: ['P3-04'],
    learn: 'Bid/no-bid is a skill. Saying no protects your capacity. What makes a pursuit worth it.',
    mindy: `On any ${ON} listing, the Should I pursue? tab shows the M-Win™ estimate and, when you’re signed in, a profile verdict (Pursue / Watch / Skip). Run Bid / No-Bid analysis → is the AI analysis.`,
    doIt: { label: `Open ${ON} listings`, href: '/opportunity-map?horizon=open' },
    access: 'signin', accessNote: 'The profile verdict is free with sign-in. The AI Bid / No-Bid analysis is Pro.',
    status: 'live', tracked: false,
    next: 'A3',
  },
  {
    id: 'A3', slug: 'shred-the-solicitation', stage: 'win', title: 'Shred the solicitation', steps: ['P3-04'],
    learn: 'Compliance before prose. Every “shall” or “must” becomes a row you answer.',
    mindy: 'In the proposal workspace: Run Compliance Check. Start from a tracked pursuit with Generate proposal.',
    doIt: { label: 'Open my pursuits', href: '/opportunity-map/pursuits' },
    access: 'pro', status: 'live', tracked: true,
    evidence: 'compliance_completed server event.',
    next: 'A4', glossary: ['rfp'],
  },
  {
    id: 'A4', slug: 'draft-and-export', stage: 'win', title: 'Draft from your Vault and export', steps: ['P3-04'],
    learn: 'Ground every claim in your real past performance. Follow the instructions exactly.',
    mindy: 'The proposal workspace drafts sections from your Vault, then Export draft (.docx) and Prepare for Submission. Submitting happens on the buyer’s system, outside Mindy.',
    doIt: { label: 'Open my pursuits', href: '/opportunity-map/pursuits' },
    access: 'pro', status: 'live', tracked: true,
    evidence: 'proposal_exported server event.',
    next: 'A5',
  },
  {
    id: 'A5', slug: 'which-certification-pays', stage: 'win', title: 'Which certification pays in your market', steps: ['P4-01', 'P4-02'],
    learn: 'Certifications are market-access decisions. VetCert is run by SBA, not VA. 8(a), HUBZone and WOSB each have different rules.',
    mindy: `The Map’s Set-aside filter covers SDVOSB, Small Business, 8(a), WOSB / EDWOSB, HUBZone and Full & Open. Compare counts in your market. Applying happens outside Mindy, with SBA.`,
    doIt: { label: `Show 8(a) ${ON} listings`, href: '/opportunity-map?horizon=open&setAside=8A' },
    access: 'free', status: 'live', tracked: false,
    next: 'A6', glossary: ['set-aside'],
  },
  {
    id: 'A6', slug: 'do-it-from-claude', stage: 'win', title: 'Do it from Claude', steps: [],
    learn: 'The Map is the visual way, Claude is the conversational way, and both use the same data. When each fits.',
    mindy: 'Connect Mindy in Claude and start with 100 free credits.',
    doIt: { label: 'Connect Mindy to Claude', href: '/mcp/setup' },
    access: 'free', accessNote: '100 free credits, then paid credits.',
    status: 'live', tracked: true,
    evidence: 'First successful mcp_call_log call.',
    next: 'A7',
  },
  {
    id: 'A7', slug: 'build-a-team', stage: 'win', title: 'Build a team for one pursuit', steps: ['P3-02'],
    learn: 'Prime vs sub. Complementary past performance. Teaming agreements.',
    mindy: 'Players shows the firms in your market today; a managed teaming workflow isn’t available yet.',
    access: 'coming-next', accessNote: 'Pro when it ships.', status: 'coming-next', tracked: true,
    next: 'A8',
  },
  {
    id: 'A8', slug: 'record-the-result', stage: 'win', title: 'Record the result', steps: ['P3-05'],
    learn: 'Always request a debrief. Every loss is market research.',
    mindy: 'Your pursuits are tracked today; recording the result of a bid isn’t available yet.',
    access: 'coming-next', accessNote: 'Pro when it ships.', status: 'coming-next', tracked: true,
    next: 'I1',
  },

  // ── AFTER THE WIN — outside Mindy ───────────────────────────────────────────
  {
    id: 'W1', slug: 'system-registrations', stage: 'after', title: 'System registrations', steps: ['P5-01'],
    learn: 'Register in PIEE and WAWF to receive and invoice your award. No WAWF means no payment.',
    mindy: 'This happens outside Mindy.', access: 'outside', status: 'outside', tracked: false, next: 'W2',
  },
  {
    id: 'W2', slug: 'subcontractor-compliance', stage: 'after', title: 'Subcontractor compliance', steps: ['P5-02'],
    learn: 'Flow down the clauses, track subcontracting-plan reporting, and pay subs on time.',
    mindy: 'This happens outside Mindy.', access: 'outside', status: 'outside', tracked: false, next: 'W3',
  },
  {
    id: 'W3', slug: 'project-compliance', stage: 'after', title: 'Project compliance', steps: ['P5-03'],
    learn: 'Meet the spec, the schedule and the reporting. Your CPARS rating is your next past performance.',
    mindy: 'This happens outside Mindy.', access: 'outside', status: 'outside', tracked: false, next: 'W4',
  },
  {
    id: 'W4', slug: 'communication', stage: 'after', title: 'Communication', steps: ['P5-04'],
    learn: 'Keep the contracting officer informed early. No surprises. Only the CO can change the contract.',
    mindy: 'This happens outside Mindy.', access: 'outside', status: 'outside', tracked: false,
  },
];

/** Action Plan steps Mindy can't do. Shown in the Tutorial Library with the principle only — no Do-it button. */
export const OUTSIDE_STEPS: ReadonlyArray<{ step: string; principle: string }> = [
  { step: 'P1-01', principle: 'Supplier, service provider or consultant: the model you pick shapes the vehicles and set-asides you use.' },
  { step: 'P1-04', principle: 'State and local portals are a separate market. Mindy covers federal only.' },
  { step: 'P1-05', principle: 'Free expert counseling (formerly PTAC). Bring your market summary from Mindy.' },
  { step: 'P2-04', principle: 'See the work before you price it. Find visits through “Find an industry day”.' },
  { step: 'P3-03', principle: 'Government pays late, so line up working capital before you need it.' },
  { step: 'P4-03', principle: 'A mentor adds capacity and past performance. Candidates can come from “Find the primes and partners in your market”.' },
  { step: 'P4-06', principle: 'Authority makes buyers call you.' },
];

export function missionBySlug(slug: string): Mission | null {
  return MISSIONS.find((m) => m.slug === slug) ?? null;
}
export function missionById(id: string): Mission | null {
  return MISSIONS.find((m) => m.id === id) ?? null;
}
