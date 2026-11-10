/**
 * The Federal Contracting Roadmap — the free course at getmindy.ai/course.
 *
 * Modelled on the "Start here → stages → personalized roadmap" course pattern (Eric, 2026-11-10),
 * built on OUR 2026 Federal Contracting Action Plan: every one of its 27 step IDs
 * (src/lib/learn/action-plan.ts) is placed in exactly one stage — the unit test checks it.
 *
 * Stages are a ladder by PROGRESS (where you are in federal contracting), not by headcount.
 * Videos are placeholders until Eric sends the lesson links: `videoUrl` empty = "coming soon".
 *
 * Copy rules: plain English, no invented results or statistics, no promises of a win.
 */
import { actionPlanStep } from '@/lib/learn/action-plan';

export type StageNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RoadmapStage {
  n: StageNumber;
  slug: string;
  name: string;
  /** Short marker on the right of the lesson rail, like a revenue band. */
  marker: string;
  /** One line under the name. */
  tagline: string;
  role: string;
  bottomLine: string;
  graduateBy: string;
  whenYouHit: string;
  /** What to focus on, in order. */
  focus: ReadonlyArray<{ title: string; body: string }>;
  /** Action Plan step IDs this stage covers. */
  steps: readonly string[];
  /** "You're ready for the next stage when…" */
  readyWhen: readonly string[];
  /** Common mistakes at this stage. */
  mistakes: readonly string[];
  /** Where Mindy helps at this stage (only things Mindy does today). */
  mindy: ReadonlyArray<{ label: string; href: string }>;
  videoUrl: string;
}

export const ROADMAP_STAGES: readonly RoadmapStage[] = [
  {
    n: 0, slug: 'get-ready', name: 'Get Ready', marker: 'Not registered',
    tagline: 'Set up the business so the government can buy from you.',
    role: 'Founder', bottomLine: 'No federal sales yet', graduateBy: 'An active SAM.gov registration and a capability statement',
    whenYouHit:
      'You have a business, or you are about to start one, and you want to sell to the government. Nobody in the government can pay you until you are registered, so this stage is about getting set up the right way, once.',
    focus: [
      { title: 'Pick your business structure', body: 'Set up an LLC or corporation, an EIN and a business bank account, so business money stays separate from yours.' },
      { title: 'Choose 2–3 industry codes (NAICS)', body: 'Pick the codes that describe what you actually do. They decide which contracts and set-asides you can go after.' },
      { title: 'Register in SAM.gov', body: 'Create your Login.gov account, get your Unique Entity ID and finish your SAM.gov registration. It is free; never pay anyone to do it for you.' },
      { title: 'Register on local government sites', body: 'Your state, county and city each have their own vendor portal. Get on them too.' },
      { title: 'Talk to your local APEX Accelerator', body: 'APEX Accelerators give free one-on-one help with registration, bidding and paperwork.' },
      { title: 'Write your capability statement', body: 'A one-page business resume: what you do, your codes, past work and how to reach you.' },
    ],
    steps: ['P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06'],
    readyWhen: ['Your SAM.gov registration is active', 'You know your 2–3 NAICS codes', 'You have a one-page capability statement'],
    mistakes: ['Paying a third party for a free SAM.gov registration', 'Picking 20 NAICS codes instead of the few you really do', 'Waiting for a perfect website before you start'],
    mindy: [
      { label: 'Find the right NAICS codes for what you do', href: '/try' },
      { label: 'See open contracts for your business', href: '/opportunity-map' },
    ],
    videoUrl: '',
  },
  {
    n: 1, slug: 'find-your-buyers', name: 'Find Your Buyers', marker: 'Registered',
    tagline: 'Learn who buys what you sell, before the bid comes out.',
    role: 'Researcher', bottomLine: 'Registered, no bids yet', graduateBy: 'A list of your top 25 buyers and your first buyer meeting',
    whenYouHit:
      'You are registered, but no one knows you exist. Most contracts are won before the bid is posted, by people the buyer already knows. This stage is about finding your buyers and getting in front of them.',
    focus: [
      { title: 'Build your top 25 buyers', body: 'The offices that buy what you sell, and what they plan to buy next. Most of that is not on SAM.gov yet.' },
      { title: 'Meet the buyers', body: 'Ask each office’s small business specialist for a short capability briefing.' },
      { title: 'Go to industry events', body: 'Industry days and matchmaking events put you in the room with buyers and primes.' },
      { title: 'Go to site visits', body: 'A site visit on a real bid shows you the work and who else is competing.' },
    ],
    steps: ['P2-01', 'P2-02', 'P2-03', 'P2-04'],
    readyWhen: ['You have a written list of your top 25 buyers', 'You have met at least one buyer', 'You know what they plan to buy in the next year'],
    mistakes: ['Only searching SAM.gov for open bids', 'Emailing buyers a sales pitch instead of asking for a short briefing', 'Skipping events because they feel like networking'],
    mindy: [
      { label: 'See who buys what you sell', href: '/opportunity-map' },
      { label: 'See what agencies plan to buy (forecasts)', href: '/opportunity-map?mode=forecast' },
    ],
    videoUrl: '',
  },
  {
    n: 2, slug: 'first-bid', name: 'First Bid', marker: '0 bids',
    tagline: 'Pick a real opportunity and submit your first response.',
    role: 'Bidder', bottomLine: 'Looking for the right first bid', graduateBy: 'Your first proposal or quote submitted',
    whenYouHit:
      'You know your buyers. Now you need reps. Your first bid will not be perfect, and that is fine: submitting teaches you more than reading about it.',
    focus: [
      { title: 'Review open bids that fit', body: 'Look for opportunities in your codes that you can really do, with a deadline you can meet.' },
      { title: 'Start with Sources Sought and RFIs', body: 'Answering a Sources Sought tells the buyer you exist and can shape how they set up the bid.' },
      { title: 'Get on supplier lists', body: 'Register with the supplier portals of the big prime contractors in your market.' },
      { title: 'Submit your response', body: 'Follow the instructions exactly, answer every requirement and submit before the deadline.' },
    ],
    steps: ['P3-01', 'P2-05', 'P3-04'],
    readyWhen: ['You have submitted at least one proposal, quote or RFI response', 'You followed the instructions line by line'],
    mistakes: ['Bidding on work you cannot deliver', 'Missing a required form or the deadline', 'Waiting for the “perfect” opportunity'],
    mindy: [
      { label: 'Find open bids that match your business', href: '/opportunity-map' },
      { label: 'Get a daily email of new matches', href: '/app' },
    ],
    videoUrl: '',
  },
  {
    n: 3, slug: 'first-win', name: 'First Win', marker: 'Bidding',
    tagline: 'Turn bids into your first award.',
    role: 'Capture lead', bottomLine: 'Bidding, no award yet', graduateBy: 'Your first federal contract or subcontract award',
    whenYouHit:
      'You are bidding but not winning yet. That is normal. Winning is a numbers game plus learning from every result, building the right team and going after work where you have an edge.',
    focus: [
      { title: 'Build a team for each bid', body: 'Partner with other small businesses or a prime when a bid is bigger than you.' },
      { title: 'Line up supplier credit', body: 'Set up vendor and supplier credit so you can buy materials before the government pays you.' },
      { title: 'Learn from every result', body: 'Ask for a debrief on every loss. It tells you what the buyer scored and what to fix.' },
      { title: 'Go after subcontracts too', body: 'Watch who wins contracts in your market and offer to subcontract to them.' },
    ],
    steps: ['P3-02', 'P3-03', 'P3-05', 'P2-06'],
    readyWhen: ['You have won your first contract or subcontract'],
    mistakes: ['Not asking for a debrief after a loss', 'Bidding alone on work that needs a team', 'Ignoring subcontracting as a first win'],
    mindy: [
      { label: 'See contracts that are coming back up', href: '/opportunity-map?mode=recompete' },
      { label: 'See who holds the contract now', href: '/opportunity-map?mode=companies' },
    ],
    videoUrl: '',
  },
  {
    n: 4, slug: 'deliver', name: 'Deliver', marker: 'First award',
    tagline: 'Do great work and build your past performance.',
    role: 'Program manager', bottomLine: 'Your first contract is live', graduateBy: 'On-time, compliant delivery and a strong past-performance record',
    whenYouHit:
      'You won. Now the work starts. How you deliver this contract becomes your past performance, and past performance is what wins the next one.',
    focus: [
      { title: 'Set up the payment systems', body: 'Register in PIEE and Wide Area Workflow (WAWF) so you can submit invoices and get paid.' },
      { title: 'Keep subcontractors compliant', body: 'Flow down the contract clauses and keep their paperwork current.' },
      { title: 'Keep the project compliant', body: 'Track deliverables, reports and deadlines in the contract.' },
      { title: 'Communicate with the contracting officer', body: 'Report early, in writing, and never surprise your customer.' },
    ],
    steps: ['P5-01', 'P5-02', 'P5-03', 'P5-04'],
    readyWhen: ['You are invoicing and getting paid on time', 'Your customer would give you a good reference'],
    mistakes: ['Not registering for invoicing until the first payment is due', 'Changing the work without written approval', 'Going quiet when there is a problem'],
    mindy: [
      { label: 'Save your past work in your Mindy Vault', href: '/app?panel=vault' },
    ],
    videoUrl: '',
  },
  {
    n: 5, slug: 'repeat-wins', name: 'Repeat Wins', marker: 'Under $1M',
    tagline: 'Use certifications and better partners to win again.',
    role: 'Growth lead', bottomLine: 'Some federal revenue, not yet $1M a year', graduateBy: 'Steady wins and about $1M a year in federal revenue',
    whenYouHit:
      'You have past performance. Now you can unlock set-asides, partner with stronger firms and stand out by doing the work yourself.',
    focus: [
      { title: 'Get the small business certifications you qualify for', body: 'Women-owned, veteran-owned, HUBZone and others each open their own set-aside contracts.' },
      { title: 'Look at the 8(a) program', body: 'If you qualify, 8(a) can open sole-source and set-aside work for nine years.' },
      { title: 'Join a mentor-protégé program', body: 'A larger mentor can help you win bigger work together.' },
      { title: 'Self-perform as your edge', body: 'Buyers trust firms that do the work themselves instead of passing it all to subs.' },
      { title: 'Find better partners', body: 'Team with firms that make your bids stronger, not just bigger.' },
    ],
    steps: ['P4-01', 'P4-02', 'P4-03', 'P4-04', 'P4-05'],
    readyWhen: ['You win work regularly, not once in a while', 'You hold the certifications you qualify for'],
    mistakes: ['Expecting a certification alone to bring in contracts', 'Partnering with whoever asks first'],
    mindy: [
      { label: 'Find partners and primes in your market', href: '/opportunity-map?mode=companies' },
    ],
    videoUrl: '',
  },
  {
    n: 6, slug: 'scale', name: 'Scale', marker: '$1M+',
    tagline: 'Become known in your market and go after bigger work.',
    role: 'CEO', bottomLine: 'Over $1M a year in federal revenue', graduateBy: 'Prime contracts, a growing team and a name buyers know',
    whenYouHit:
      'You are an established federal contractor. Growth now comes from authority: being the company buyers and primes think of first.',
    focus: [
      { title: 'Speak at events', body: 'Speaking at industry days and conferences puts you in front of every buyer in the room at once.' },
      { title: 'Go after bigger vehicles', body: 'Look at multiple-award contracts and GSA schedules that let you compete for task orders.' },
      { title: 'Keep the pipeline full', body: 'Keep repeating business development and bidding as your company grows.' },
    ],
    steps: ['P4-06'],
    readyWhen: ['Buyers and primes call you, not only the other way around'],
    mistakes: ['Stopping business development once the work is steady'],
    mindy: [
      { label: 'Track your market and pipeline in Mindy', href: '/app' },
    ],
    videoUrl: '',
  },
];

/** A lesson in the left rail: Start Here, Context, each stage, then the free bonus. */
export interface CourseLesson {
  slug: string;
  label: string;
  /** "▶", "C", "0"…"6" or "★". */
  badge: string;
  marker?: string;
  stage?: RoadmapStage;
}

export const COURSE_LESSONS: readonly CourseLesson[] = [
  { slug: 'start-here', label: 'Start Here', badge: '▶' },
  { slug: 'context', label: 'How federal buying works', badge: 'C' },
  ...ROADMAP_STAGES.map((s) => ({ slug: s.slug, label: s.name, badge: String(s.n), marker: s.marker, stage: s })),
  { slug: 'free-bonus', label: 'Free Bonus', badge: '★' },
];

export function lessonBySlug(slug: string): CourseLesson | null {
  return COURSE_LESSONS.find((l) => l.slug === slug) ?? null;
}

export function nextLesson(slug: string): CourseLesson | null {
  const i = COURSE_LESSONS.findIndex((l) => l.slug === slug);
  return i >= 0 && i < COURSE_LESSONS.length - 1 ? COURSE_LESSONS[i + 1] : null;
}

export function stageByNumber(n: number): RoadmapStage | null {
  return ROADMAP_STAGES.find((s) => s.n === n) ?? null;
}

/** The Action Plan steps a stage covers, with their titles. */
export function stageSteps(stage: RoadmapStage) {
  return stage.steps.map((id) => {
    const step = actionPlanStep(id);
    if (!step) throw new Error(`Unknown Action Plan step ${id}`);
    return step;
  });
}

// ── The roadmap quiz ────────────────────────────────────────────────────────
// Yes/no questions in ladder order. The first "no" is your stage. A "yes" to every one puts you
// at Stage 6 unless your federal revenue says otherwise.

export interface QuizQuestion {
  id: 'sam' | 'basics' | 'buyers' | 'bid' | 'win' | 'revenue';
  text: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export const QUIZ: readonly QuizQuestion[] = [
  { id: 'sam', text: 'Is your business registered (active) in SAM.gov?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unsure', label: 'Not sure' }] },
  { id: 'basics', text: 'Do you know your NAICS codes and have a capability statement?', options: [{ value: 'yes', label: 'Yes, both' }, { value: 'no', label: 'Not yet' }] },
  { id: 'buyers', text: 'Do you have a list of the agencies that buy what you sell, and have you met any of them?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Not yet' }] },
  { id: 'bid', text: 'Have you submitted a bid, quote or RFI response to the government?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Not yet' }] },
  { id: 'win', text: 'Have you won a federal contract or subcontract?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Not yet' }] },
  {
    id: 'revenue', text: 'About how much federal revenue did you have in the last 12 months?',
    options: [
      { value: 'none', label: 'None yet' },
      { value: 'under1m', label: 'Under $1M' },
      { value: 'over1m', label: '$1M or more' },
    ],
  },
];

export type QuizAnswers = Partial<Record<QuizQuestion['id'], string>>;

/** Which stage the answers put you in. Unanswered counts as "no". */
export function stageFromAnswers(a: QuizAnswers): StageNumber {
  if (a.sam !== 'yes' || a.basics !== 'yes') return 0;
  if (a.buyers !== 'yes') return 1;
  if (a.bid !== 'yes') return 2;
  if (a.win !== 'yes') return 3;
  if (a.revenue === 'over1m') return 6;
  if (a.revenue === 'under1m') return 5;
  return 4; // won, but no revenue yet: delivering the first contract
}

/** GHL tag every course sign-up gets. GHL workflows can trigger off it. */
export const COURSE_GHL_TAG = 'free-govcon-roadmap';
export const stageGhlTag = (n: StageNumber) => `govcon-roadmap-stage-${n}`;
