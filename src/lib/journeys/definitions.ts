/**
 * Mindy "Getting Started" guided journeys — the 3 task-based paths a new free
 * user walks instead of landing in a silent Vault form. The SMB arc:
 * know yourself → find who buys → respond and win.
 *
 * Single source of truth shared by the journey panel (UI) + the progress API.
 * Each journey links to a REAL panel and ends in a concrete artifact. Value-first:
 * the journey is useful free; Pro reveals itself at the ceiling (UpgradeModal).
 *
 * Video: record in Loom → upload to Vimeo → paste the Vimeo URL into `vimeoUrl`.
 * (Plan: docs/PLAN-mindy-guided-journeys.md)
 */

export type JourneyKey = 'profile' | 'customers' | 'bid';

export interface JourneyStep {
  label: string;
  /** What the user does at this step. */
  detail: string;
}

export interface Journey {
  key: JourneyKey;
  num: number;
  title: string;          // "Set up your Market Profile"
  why: string;            // one-line value — why it matters
  artifact: string;       // the concrete win at the end
  /** The sidebar panel this journey's "Do it now" button deep-links to. */
  panel: string;          // an MIPanel value: 'vault' | 'research' | 'pipeline' ...
  ctaLabel: string;       // "Set up my profile →"
  steps: JourneyStep[];
  /** Vimeo URL for the Loom-recorded walkthrough. Empty until recorded. */
  vimeoUrl: string;
  /** The DB column on mindy_journey_progress that flags this done. */
  doneField: 'profile_done' | 'customers_done' | 'bid_done';
}

export const JOURNEYS: Journey[] = [
  {
    key: 'profile',
    num: 1,
    title: 'Set up your Market Profile',
    why: 'The obvious NAICS code misses ~72% of your real market — Mindy maps the full picture so your alerts actually match.',
    artifact: 'A complete profile → real matched opportunities start flowing.',
    panel: 'vault',
    ctaLabel: 'Set up my profile →',
    steps: [
      { label: 'Describe your business', detail: 'Tell Mindy what you do — it derives your full NAICS coverage, not just the one obvious code.' },
      { label: 'Confirm keywords', detail: 'Tune the keywords that catch mislabeled opportunities titles miss.' },
      { label: 'Add identity + past performance', detail: 'UEI, certs, and a couple real projects — this powers bid/no-bid scoring later.' },
    ],
    vimeoUrl: '',
    doneField: 'profile_done',
  },
  {
    key: 'customers',
    num: 2,
    title: 'Find your customers',
    why: 'Stop guessing who to call. See which agencies actually buy your work, and who to talk to there.',
    artifact: 'A target list: the buying agencies + the people to reach.',
    panel: 'research',
    ctaLabel: 'Find my customers →',
    steps: [
      { label: 'Run a market', detail: 'Search your work and see the agencies spending on it — by dollars, not guesses.' },
      { label: 'See the buyers', detail: 'Drill into the buying offices and decision-makers for your NAICS.' },
      { label: 'Save a target list', detail: 'Keep the agencies + contacts worth pursuing.' },
    ],
    vimeoUrl: '',
    doneField: 'customers_done',
  },
  {
    key: 'bid',
    num: 3,
    title: 'Create your first bid',
    why: "Don't spend days on a bid you can't win — and when you do bid, cover every requirement.",
    artifact: 'A submission-ready response (.docx) that covers the solicitation.',
    panel: 'pipeline',
    ctaLabel: 'Build my first bid →',
    steps: [
      { label: 'Pick a pursuit + bid/no-bid', detail: 'Score the fit before you invest — Mindy records the decision.' },
      { label: 'Build the compliance matrix', detail: 'Pull every shall/must from the solicitation; assign + track who owns what.' },
      { label: 'Draft, scan, export', detail: 'Draft to the requirements, scan for disqualifiers, export the .docx.' },
    ],
    vimeoUrl: '',
    doneField: 'bid_done',
  },
];

/** The forced-landing window: new users land on Getting Started this long OR until
 *  all 3 journeys are done — whichever first. Then it's available-not-forced. */
export const JOURNEY_LANDING_WINDOW_DAYS = 14;

export interface JourneyProgress {
  profile_done: boolean;
  customers_done: boolean;
  bid_done: boolean;
  card_dismissed: boolean;
  created_at?: string | null;
}

export function allJourneysDone(p: JourneyProgress | null | undefined): boolean {
  return !!p && p.profile_done && p.customers_done && p.bid_done;
}

export function journeysCompletedCount(p: JourneyProgress | null | undefined): number {
  if (!p) return 0;
  return [p.profile_done, p.customers_done, p.bid_done].filter(Boolean).length;
}

/** True while the user is in the first-N-days window AND hasn't finished all 3 —
 *  i.e. Getting Started should be the DEFAULT landing. */
export function shouldForceJourneyLanding(p: JourneyProgress | null | undefined): boolean {
  if (!p) return true;                 // brand-new / no row yet → land them here
  if (allJourneysDone(p)) return false;
  if (!p.created_at) return true;
  const days = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24);
  return days < JOURNEY_LANDING_WINDOW_DAYS;
}
