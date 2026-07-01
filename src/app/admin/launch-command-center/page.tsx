'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import MemberAccessSection from '@/components/admin/MemberAccessSection';
import MemberLookup from '@/components/admin/MemberLookup';

type StatusTone = 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'slate';

type HeatmapOpp = {
  noticeId: string; title: string; agency: string | null; setAside: string | null;
  responseDeadline: string | null; isSourcesSought: boolean; trackerCount: number;
  pursuingCount: number; collabReady: boolean;
  collabPreview: string | null;
};
type DemandHeatmap = {
  generatedAt: string; totalTrackedOpps: number; collabReadyCount: number;
  threshold: number; opps: HeatmapOpp[];
};

type BetaConversion = {
  success: boolean;
  entitledTotal: number;
  converted: number;
  conversionRate: number;
  invitedPending: number;
  remaining: number;
  perDay: number;
  daysToDrain: number;
  sendTrend: Array<{ date: string; count: number }>;
};

/** Percent of total, clamped 0–100 (for the conversion progress bar widths). */
function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 1000) / 10));
}

type MrrGoal = {
  success: boolean;
  goal: number;
  proPrice: number;
  cacheUpdatedAt?: string | null;
  activeSubs: number;
  mrr: number;
  arpu: number;
  pctToGoal: number;
  byPlan: Array<{ monthlyPrice: number; count: number }>;
  subsNeededAt149: number;
  subsRemainingAt149: number;
  mrrGap: number;
  oneTimeCash30d?: number;
  oneTimeCount30d?: number;
  lifetimeScenarios?: Array<{ name: string; price: number; salesToFundGoalMonth: number; mrrEquivPerSale: number }>;
  upgradeModalShown?: number;
  upgradeModalCtaClicks?: number;
  upgradeModalCtr?: number;
  topUpgradeFeatures?: Array<{ feature: string; count: number }>;
  dripSends30d?: number;
  bootcampOfferSends?: number;
};

type UpgradeIntentCandidate = {
  email: string;
  level: 'hot' | 'warm';
  ctaClicks: number;
  modalOpens: number;
  lastCtaAt: string | null;
  topFeature: string;
  profileComplete: boolean;
  totalSpent: number;
  isProSubscriber: boolean;
  recommendedAction: string;
};

type UpgradeIntentBrief = {
  success: boolean;
  windowDays: number;
  definition: { hot: string; warm: string; source: string };
  summary: {
    totalWithIntent: number;
    hot: number;
    warm: number;
    callableNow: number;
    alreadyPro: number;
    ctaClicks: number;
    modalOpens: number;
  };
  candidates: UpgradeIntentCandidate[];
};

type PartnerAffiliateSummary = {
  partnerCode: string;
  partnerName: string;
  commissionPercent: number;
  transactionCount: number;
  payingCustomers: number;
  grossFormatted: string;
  commissionFormatted: string;
  monthlyRunRateFormatted: string;
  affiliatePer149SubFormatted?: string;
  yourNetPer149SubFormatted?: string;
};

type PartnerProgramsBrief = {
  defaultAffiliatePercent: number;
  programs: Array<{
    code: string;
    slug: string;
    name: string;
    affiliatePercent: number;
    compensationModel: string;
    urls: { landing: string; alertsSignup: string; appSignup: string };
    affiliate: PartnerAffiliateSummary;
  }>;
};

type CoachActivityRow = {
  id: string;
  coach: string;
  activity_type: string;
  target_name?: string;
  target_org?: string;
  status: string;
  customer_signal?: string;
  next_action?: string;
  updated_at: string;
};

type CoachActivityBrief = {
  success: boolean;
  count: number;
  activities: CoachActivityRow[];
  summary: { open: number; byCoach: Record<string, number> };
  migrationNeeded?: boolean;
  hint?: string;
};

// Lead targets to hit the remaining $149 subs at three close rates. Anchored to
// real data: cold base converts ~0.7%, warm bootcamp leads realistically 3-8%.
// (IG peak was ~2,000 signups/mo — the 5% medium case is ~6 months at that pace.)
function leadScenarios(subsNeeded: number) {
  const rates = [
    { label: 'High', rate: 0.08, tone: 'emerald' as const },
    { label: 'Medium', rate: 0.05, tone: 'amber' as const },
    { label: 'Low', rate: 0.03, tone: 'blue' as const },
  ];
  return rates.map((r) => {
    const leads = Math.ceil(subsNeeded / r.rate);
    return { ...r, leads, perMonth6: Math.ceil(leads / 6) };
  });
}

type RoleLane = {
  name: string;
  owners: string;
  mission: string;
  nextAction: string;
  signal: string;
  tone: StatusTone;
};

type Priority = {
  priority: string;
  owner: string;
  decision: string;
  status: string;
  tone: StatusTone;
};

type QueueItem = {
  queue: string;
  owner: string;
  segment: string;
  nextAction: string;
  status: string;
  tone: StatusTone;
};

type GrowthQueueName = 'setupInvite' | 'profileNudge' | 'activationRescue' | 'proUpgrade' | 'whiteGloveCandidate';

type GrowthBrief = {
  generatedAt: string;
  window: {
    days: number;
    from: string;
    to: string;
  };
  audience: {
    totalUsers: number;
    miFree: number;
    miPro: number;
    miInternal: number;
    profileComplete: number;
    profileCompletionRate: string;
    activeAlertAudience: number;
    briefingsEligible: number;
    briefingsNeedProfile: number;
  };
  engagement: {
    activeToday: number;
    active7d: number;
    timeInMiMinutes: number;
    avgMinutesPerActiveUser: number;
    topAreas: Array<{ area: string; minutes: number; users: number }>;
  };
  email: {
    sent: number;
    delivered: number;
    clicked: number;
    failed: number;
    deliveryRate: string;
    clickRate: string;
    topLinks: Array<{ link: string; clicks: number }>;
  };
  queues: Record<GrowthQueueName, Array<{
    email: string;
    reason: string;
    owner: string;
    nextAction: string;
    signals: string[];
  }>>;
  recommendedActions: Array<{
    owner: string;
    action: string;
    why: string;
  }>;
  freshness: {
    warnings: string[];
  };
};

type LaunchHealth = 'green' | 'yellow' | 'red';

type QualificationCandidate = {
  email: string;
  score: number;
  why: string;
  action: string;
};

type CustomerQualificationBrief = {
  success: boolean;
  summary: {
    totalScored: number;
    totalPurchases: number;
    uniquePurchasers: number;
    bySegment: {
      '10-10 Candidate': number;
      'Activation Candidate': number;
      'Rescue Candidate': number;
      'Audience Only': number;
    };
    top10Score: Array<{
      email: string;
      score: number;
      segment: string;
    }>;
  };
  lists: {
    founderCalls: QualificationCandidate[];
    salesOutreach: QualificationCandidate[];
    activationCandidates: QualificationCandidate[];
    upgradeTargets: QualificationCandidate[];
    rescueCandidates: QualificationCandidate[];
  };
};

type LaunchManagerBrief = {
  generatedAt: string;
  domainPolicy: {
    publicSite: string;
    miPlatform: string;
    rule: string;
    warnings: Array<{ label: string; occurrences: number }>;
  };
  launches: Array<{
    name: string;
    status: string;
    objective: string;
    health: LaunchHealth;
    blockers: string[];
    changes: string[];
  }>;
  ownerActions: Array<{
    owner: string;
    area: string;
    action: string;
    why: string;
    dueDate: string;
  }>;
  decisions: Array<{
    owner: string;
    decisionNeeded: string;
    whyItMatters: string;
    dueDate: string;
  }>;
};

const toneClasses: Record<StatusTone, string> = {
  green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  blue: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  purple: 'border-purple-500/40 bg-purple-500/10 text-purple-200',
  red: 'border-red-500/40 bg-red-500/10 text-red-200',
  slate: 'border-slate-500/40 bg-slate-500/10 text-slate-200',
};

function statusBadgeClass(tone: StatusTone): string {
  return `inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold leading-none ${toneClasses[tone]}`;
}

const launchHealthClasses: Record<LaunchHealth, string> = {
  green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  yellow: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  red: 'border-red-500/40 bg-red-500/10 text-red-200',
};

// Operating lanes/queues below are a HAND-MAINTAINED org snapshot (owners +
// per-queue status), not live data. Stamp it so a reader knows how fresh it is;
// bump this date whenever the lane/queue statuses are reviewed.
const OPS_SNAPSHOT_AS_OF = 'Jul 2026';

const roleLanes: RoleLane[] = [
  {
    name: 'Customer Validation',
    owners: 'Shanoor, Sikander',
    mission: 'Talk to users first and learn what makes MI useful enough to open every week.',
    nextAction: 'Run A1/A2 customer calls, tag blockers, and surface upgrade or proof-story candidates.',
    signal: 'Replies, booked calls, profile blockers, upgrade intent',
    tone: 'green',
  },
  {
    name: 'Coach Signal Loop',
    owners: 'Ryan, Zach, Randie, Tavin',
    mission: 'Partner BD (APEX/SBDC/Chambers) + signal capture — NOT profile nudges (those are Annelle/Sikander).',
    nextAction: 'Log partner leads, proof stories, and white-glove referrals in the Coach Signal queue.',
    signal: 'Setup needs, partner intros, proof stories, referrals',
    tone: 'blue',
  },
  {
    name: 'Package and Enterprise Sales',
    owners: 'Branden',
    mission: 'Present the right MI, bundle, team, enterprise, or white-glove package to qualified buyers.',
    nextAction: 'Capture buyer pain, decision maker, budget signal, objections, and next meeting date.',
    signal: 'Package presentations, objections, close path, Eric escalations',
    tone: 'amber',
  },
  {
    name: 'Social Distribution',
    owners: 'Kash, Usama, Muneeba',
    mission: 'Measure content by signups, replies, profile completion, MI usage, calls, and partner leads.',
    nextAction: 'Attach every post, clip, description, and CTA to a campaign source and outcome signal.',
    signal: 'UTM clicks, signups, replies, booked calls, MI logins',
    tone: 'purple',
  },
  {
    name: 'Product and Engineering',
    owners: 'Product, Engineering',
    mission: 'Convert customer and team signals into dashboard fixes, workflow improvements, and safer data systems.',
    nextAction: 'Ship the highest-leverage fixes from calls, dashboard gaps, auth, and API hardening.',
    signal: 'Usage friction, failed APIs, dashboard confusion, security gaps',
    tone: 'red',
  },
];

const priorities: Priority[] = [
  {
    priority: 'Create one operating link for launch execution',
    owner: 'Product',
    decision: 'Use this page as the internal launch command center.',
    status: 'Live',
    tone: 'green',
  },
  {
    priority: 'Customer-first outreach',
    owner: 'Shanoor / Sikander',
    decision: 'Talk to users before advisory board outreach.',
    status: 'Ready to run',
    tone: 'blue',
  },
  {
    priority: 'Coach and enterprise alignment',
    owner: 'Coaches / Branden',
    decision: 'Coaches capture signals. Branden presents packages and enterprise paths.',
    status: 'Needs operating cadence',
    tone: 'amber',
  },
  {
    priority: 'Social source attribution',
    owner: 'Kash / Usama / Muneeba',
    decision: 'Views are secondary. Track conversion signals by channel.',
    status: 'Needs tracking links',
    tone: 'purple',
  },
  {
    priority: 'Live data wiring',
    owner: 'Engineering',
    decision: 'MRR, conversions, upgrade intent, referrals, and coach activity pull from live APIs (Supabase + Stripe).',
    status: 'Wired',
    tone: 'green',
  },
];

const queueItems: QueueItem[] = [
  {
    queue: 'A1 Customer Outreach',
    owner: 'Shanoor',
    segment: 'Paid buyers, bundle buyers, active MI users',
    nextAction: 'Book validation calls and ask what would make MI weekly-useful.',
    status: 'Start this week',
    tone: 'green',
  },
  {
    queue: 'A2 Customer Interviews',
    owner: 'Sikander',
    segment: 'Qualified customers who need setup help or show intent',
    nextAction: 'Capture profile blockers, outcome goals, and product gaps.',
    status: 'Start this week',
    tone: 'green',
  },
  {
    queue: 'Coach Signal Capture',
    owner: 'Ryan, Zach, Randie, Tavin',
    segment: 'Partner BD (APEX/SBDC/Chambers), livestream validation, proof stories, referrals',
    nextAction: 'Log partner leads and customer-success signals — profile nudges stay with Annelle/Sikander.',
    status: 'Live in Command Center',
    tone: 'blue',
  },
  {
    queue: 'Enterprise Package Pipeline',
    owner: 'Branden',
    segment: 'Team buyers, enterprise buyers, bundles, white-glove candidates',
    nextAction: 'Present package, capture objections, and escalate strategic buyers to Eric.',
    status: 'Needs pipeline fields',
    tone: 'amber',
  },
  {
    queue: 'YouTube Distribution',
    owner: 'Kash',
    segment: 'Long-form, clips, descriptions, pinned comments',
    nextAction: 'Attach MI CTA and track signups, replies, and booked calls.',
    status: 'Needs UTM links',
    tone: 'purple',
  },
  {
    queue: 'Instagram Distribution',
    owner: 'Usama',
    segment: 'Reels, posts, stories, DMs',
    nextAction: 'Track which assets create replies, signups, and MI logins.',
    status: 'Needs UTM links',
    tone: 'purple',
  },
  {
    queue: 'LinkedIn Distribution',
    owner: 'Muneeba',
    segment: 'Posts, comments, DMs, proof-story clips',
    nextAction: 'Track qualified conversations and calls from each post.',
    status: 'Needs UTM links',
    tone: 'purple',
  },
];

const metrics = [
  ['Activation', 'New signups, imported users, account setup, profile completion'],
  ['Engagement', 'Logins, time in MI, briefing opens, alert clicks, feature usage'],
  ['Customer Outcomes', 'Opportunities saved, pipeline moves, partner leads, proposals started, wins reported'],
  ['Team Execution', 'Calls booked, calls completed, coach notes, Branden presentations, social campaign signals'],
  ['Decision Levers', 'Improve onboarding, change offer, adjust alerts, create demo, escalate to white-glove'],
];

const sourceDocs = [
  'docs/strategy/MI-INTERNAL-COMMAND-CENTER-PRD.md',
  'docs/strategy/MI-LAUNCH-MASTER-PLAN.md',
  'docs/strategy/GOVCON-GIANTS-10X-BRIEF.md',
  'docs/strategy/MI-TEAM-ALIGNMENT-SLACK-BRIEF.md',
  'tasks/COACH-ENTERPRISE-BD-PLAN.md',
  'tasks/MI-OPERATING-SYSTEM-ROADMAP.md',
];

const growthQueueLabels: Record<GrowthQueueName, string> = {
  setupInvite: 'Setup Invites',
  profileNudge: 'Profile Nudges',
  activationRescue: 'Activation Rescue',
  proUpgrade: 'Pro Upgrade',
  whiteGloveCandidate: 'White-Glove',
};

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '0';
}

function formatMinutes(value: number | undefined): string {
  if (!value) return '0m';
  if (value >= 60) return `${Math.round((value / 60) * 10) / 10}h`;
  return `${Math.round(value * 10) / 10}m`;
}

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Checking access</p>
        <h1 className="mt-3 text-3xl font-bold">Mindy Command Center</h1>
        <div className="mt-8 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="command-center-loader h-full w-1/3 rounded-full bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400" />
        </div>
        <p className="mt-4 text-sm text-slate-400">Loading the internal launch workspace...</p>
        <style jsx>{`
          .command-center-loader {
            animation: command-center-slide 1.1s ease-in-out infinite;
          }

          @keyframes command-center-slide {
            0% {
              transform: translateX(-120%);
            }
            100% {
              transform: translateX(320%);
            }
          }
        `}</style>
      </div>
    </div>
  );
}

export default function LaunchCommandCenterPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [growthBrief, setGrowthBrief] = useState<GrowthBrief | null>(null);
  const [growthLoading, setGrowthLoading] = useState(false);
  const [growthError, setGrowthError] = useState('');
  const [launchBrief, setLaunchBrief] = useState<LaunchManagerBrief | null>(null);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [launchError, setLaunchError] = useState('');
  // Demand Heatmap — aggregated user-intent / collaboration signal (the "aha" feature)
  const [heatmap, setHeatmap] = useState<DemandHeatmap | null>(null);
  const [heatmapError, setHeatmapError] = useState('');
  const [heatmapOpen, setHeatmapOpen] = useState(false); // collapse the heatmap table by default — keep the stat + collab preview visible
  const [qualBrief, setQualBrief] = useState<CustomerQualificationBrief | null>(null);
  const [qualLoading, setQualLoading] = useState(false);
  const [qualError, setQualError] = useState('');
  const [qualSlackStatus, setQualSlackStatus] = useState<string | null>(null);
  const [qualSlackLoading, setQualSlackLoading] = useState(false);
  const [upgradeSlackLoading, setUpgradeSlackLoading] = useState(false);
  const [betaConv, setBetaConv] = useState<BetaConversion | null>(null);
  const [betaConvLoading, setBetaConvLoading] = useState(false);
  const [betaConvError, setBetaConvError] = useState('');
  const [mrrGoal, setMrrGoal] = useState<MrrGoal | null>(null);
  const [mrrGoalError, setMrrGoalError] = useState('');
  // On-demand "Refresh purchases": bumps a key to re-run the MRR loader, and
  // mrrSyncing covers the live Stripe→cache sync the button kicks off first.
  const [mrrRefreshKey, setMrrRefreshKey] = useState(0);
  const [mrrSyncing, setMrrSyncing] = useState(false);
  const [mrrSyncedAt, setMrrSyncedAt] = useState<string | null>(null);
  const [upgradeIntent, setUpgradeIntent] = useState<UpgradeIntentBrief | null>(null);
  const [upgradeIntentError, setUpgradeIntentError] = useState('');
  const [partnerBrief, setPartnerBrief] = useState<PartnerProgramsBrief | null>(null);
  const [partnerBriefError, setPartnerBriefError] = useState('');
  const [coachBrief, setCoachBrief] = useState<CoachActivityBrief | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState('');
  const [coachLogStatus, setCoachLogStatus] = useState<string | null>(null);
  const [coachForm, setCoachForm] = useState({
    coach: 'Ryan',
    activity_type: 'partner_bd',
    target_org: '',
    objective: '',
    next_action: '',
  });

  const currentDate = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function verifyStoredPassword() {
      const storedPassword = sessionStorage.getItem('adminPassword');
      if (!storedPassword) {
        if (!cancelled) {
          setChecking(false);
        }
        return;
      }

      try {
        const response = await fetch('/api/admin/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: storedPassword }),
        });
        const data = await response.json();

        if (cancelled) {
          return;
        }

        if (data.valid || data.success) {
          setAuthenticated(true);
          setPassword(storedPassword);
        } else {
          sessionStorage.removeItem('adminAuth');
          sessionStorage.removeItem('adminPassword');
        }
      } catch {
        if (cancelled) {
          return;
        }
        sessionStorage.removeItem('adminAuth');
        sessionStorage.removeItem('adminPassword');
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    }

    verifyStoredPassword();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');

    try {
      const response = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();

      if (!data.valid && !data.success) {
        setAuthError('Invalid admin password');
        return;
      }

      sessionStorage.setItem('adminAuth', 'true');
      sessionStorage.setItem('adminPassword', password);
      setAuthenticated(true);
    } catch {
      setAuthError('Could not verify password. Try again.');
    }
  }

  useEffect(() => {
    if (!authenticated || !password) return;

    let cancelled = false;

    async function loadGrowthBrief() {
      setGrowthLoading(true);
      setGrowthError('');

      try {
        const response = await fetch(`/api/admin/mi-growth-brief?password=${encodeURIComponent(password)}&days=7`, {
          cache: 'no-store',
        });
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok || !data.success) {
          setGrowthError(data.error || 'Could not load growth brief');
          setGrowthBrief(null);
          return;
        }

        setGrowthBrief(data as GrowthBrief);
      } catch {
        if (!cancelled) {
          setGrowthError('Could not load growth brief');
          setGrowthBrief(null);
        }
      } finally {
        if (!cancelled) {
          setGrowthLoading(false);
        }
      }
    }

    loadGrowthBrief();

    return () => {
      cancelled = true;
    };
  }, [authenticated, password]);

  useEffect(() => {
    if (!authenticated || !password) return;

    let cancelled = false;

    async function loadLaunchBrief() {
      setLaunchLoading(true);
      setLaunchError('');

      try {
        const response = await fetch(`/api/admin/launch-manager-brief?password=${encodeURIComponent(password)}`, {
          cache: 'no-store',
        });
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok || !data.success) {
          setLaunchError(data.error || 'Could not load launch brief');
          setLaunchBrief(null);
          return;
        }

        setLaunchBrief(data as LaunchManagerBrief);
      } catch {
        if (!cancelled) {
          setLaunchError('Could not load launch brief');
          setLaunchBrief(null);
        }
      } finally {
        if (!cancelled) {
          setLaunchLoading(false);
        }
      }
    }

    loadLaunchBrief();

    return () => {
      cancelled = true;
    };
  }, [authenticated, password]);

  useEffect(() => {
    if (!authenticated || !password) return;

    let cancelled = false;

    async function loadQualificationBrief() {
      setQualLoading(true);
      setQualError('');

      try {
        const response = await fetch(`/api/admin/qualify-customers?password=${encodeURIComponent(password)}`, {
          cache: 'no-store',
        });
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok || !data.success) {
          setQualError(data.error || 'Could not load qualification data');
          setQualBrief(null);
          return;
        }

        setQualBrief(data as CustomerQualificationBrief);
      } catch {
        if (!cancelled) {
          setQualError('Could not load qualification data');
          setQualBrief(null);
        }
      } finally {
        if (!cancelled) {
          setQualLoading(false);
        }
      }
    }

    loadQualificationBrief();

    return () => {
      cancelled = true;
    };
  }, [authenticated, password]);

  async function pushQualSegmentToSlack(segment: 'activation' | 'founder' | 'sales' | 'rescue') {
    if (!password) return;
    setQualSlackLoading(true);
    setQualSlackStatus(null);
    try {
      const res = await fetch(
        `/api/admin/push-qualification-slack?password=${encodeURIComponent(password)}&segment=${segment}&limit=25`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setQualSlackStatus(data.error || 'Slack push failed');
        return;
      }
      setQualSlackStatus(`Posted ${data.posted} ${segment} candidates to ${data.channel}`);
    } catch {
      setQualSlackStatus('Slack push failed — check SLACK_BOT_TOKEN');
    } finally {
      setQualSlackLoading(false);
    }
  }

  async function pushUpgradeClickersToSlack() {
    if (!password) return;
    setUpgradeSlackLoading(true);
    setQualSlackStatus(null);
    try {
      const res = await fetch(
        `/api/admin/push-upgrade-intent-slack?password=${encodeURIComponent(password)}&level=hot&limit=25`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setQualSlackStatus(data.error || 'Upgrade Slack push failed');
        return;
      }
      setQualSlackStatus(`Posted ${data.posted} upgrade clickers to ${data.channel}`);
    } catch {
      setQualSlackStatus('Upgrade Slack push failed — check SLACK_BOT_TOKEN');
    } finally {
      setUpgradeSlackLoading(false);
    }
  }

  useEffect(() => {
    if (!authenticated || !password) return;
    let cancelled = false;

    async function loadBetaConversion() {
      setBetaConvLoading(true);
      setBetaConvError('');
      try {
        const response = await fetch(`/api/admin/beta-conversion?password=${encodeURIComponent(password)}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.success) {
          setBetaConvError(data.error || 'Could not load beta conversion');
          setBetaConv(null);
          return;
        }
        setBetaConv(data as BetaConversion);
      } catch {
        if (!cancelled) {
          setBetaConvError('Could not load beta conversion');
          setBetaConv(null);
        }
      } finally {
        if (!cancelled) setBetaConvLoading(false);
      }
    }

    loadBetaConversion();
    return () => { cancelled = true; };
  }, [authenticated, password]);

  useEffect(() => {
    if (!authenticated || !password) return;
    let cancelled = false;
    async function loadMrrGoal() {
      setMrrGoalError('');
      try {
        const response = await fetch(`/api/admin/mrr-goal?password=${encodeURIComponent(password)}`, { cache: 'no-store' });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.success) {
          setMrrGoalError(data.error || 'Could not load MRR goal');
          setMrrGoal(null);
          return;
        }
        setMrrGoal(data as MrrGoal);
      } catch {
        if (!cancelled) { setMrrGoalError('Could not load MRR goal'); setMrrGoal(null); }
      }
    }
    loadMrrGoal();
    return () => { cancelled = true; };
  }, [authenticated, password, mrrRefreshKey]);

  // "Refresh purchases": the MRR widget reads a daily Stripe cache, so a fresh
  // purchase lags until the nightly sync. This triggers the sync on demand, then
  // re-reads the goal so the number reflects reality right now.
  async function refreshPurchases() {
    if (!password || mrrSyncing) return;
    setMrrSyncing(true);
    try {
      await fetch(`/api/cron/sync-stripe-cache?password=${encodeURIComponent(password)}`, { cache: 'no-store' });
      setMrrSyncedAt(new Date().toLocaleTimeString());
    } catch { /* surfaced via the (unchanged) MRR error if the reload fails */ }
    finally {
      setMrrSyncing(false);
      setMrrRefreshKey((k) => k + 1); // re-run loadMrrGoal with the fresh cache
    }
  }

  // Demand Heatmap loader
  useEffect(() => {
    if (!authenticated || !password) return;
    let cancelled = false;
    async function loadHeatmap() {
      setHeatmapError('');
      try {
        const response = await fetch(`/api/admin/demand-heatmap?password=${encodeURIComponent(password)}&limit=40`, { cache: 'no-store' });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.success) { setHeatmapError(data.error || 'Could not load demand heatmap'); setHeatmap(null); return; }
        setHeatmap(data as DemandHeatmap);
      } catch {
        if (!cancelled) { setHeatmapError('Could not load demand heatmap'); setHeatmap(null); }
      }
    }
    loadHeatmap();
    return () => { cancelled = true; };
  }, [authenticated, password]);

  useEffect(() => {
    if (!authenticated || !password) return;
    let cancelled = false;
    async function loadUpgradeIntent() {
      setUpgradeIntentError('');
      try {
        const response = await fetch(
          `/api/admin/upgrade-intent?password=${encodeURIComponent(password)}&days=30&limit=50&level=hot`,
          { cache: 'no-store' },
        );
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.success) {
          setUpgradeIntentError(data.error || 'Could not load upgrade intent');
          setUpgradeIntent(null);
          return;
        }
        setUpgradeIntent(data as UpgradeIntentBrief);
      } catch {
        if (!cancelled) {
          setUpgradeIntentError('Could not load upgrade intent');
          setUpgradeIntent(null);
        }
      }
    }
    loadUpgradeIntent();
    return () => { cancelled = true; };
  }, [authenticated, password]);

  useEffect(() => {
    if (!authenticated || !password) return;
    let cancelled = false;
    async function loadPartnerBrief() {
      setPartnerBriefError('');
      try {
        const response = await fetch(
          `/api/admin/partner-referrals?password=${encodeURIComponent(password)}`,
          { cache: 'no-store' },
        );
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setPartnerBriefError(data.error || 'Could not load partner programs');
          setPartnerBrief(null);
          return;
        }
        setPartnerBrief(data as PartnerProgramsBrief);
      } catch {
        if (!cancelled) {
          setPartnerBriefError('Could not load partner programs');
          setPartnerBrief(null);
        }
      }
    }
    loadPartnerBrief();
    return () => { cancelled = true; };
  }, [authenticated, password]);

  useEffect(() => {
    if (!authenticated || !password) return;
    let cancelled = false;
    async function loadCoachBrief() {
      setCoachLoading(true);
      setCoachError('');
      try {
        const response = await fetch(
          `/api/admin/coach-activity?password=${encodeURIComponent(password)}&limit=50`,
          { cache: 'no-store' },
        );
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.success) {
          setCoachError(data.hint || data.error || 'Could not load coach activity');
          setCoachBrief(data.migrationNeeded ? { success: false, count: 0, activities: [], summary: { open: 0, byCoach: {} }, migrationNeeded: true, hint: data.hint } : null);
          return;
        }
        setCoachBrief(data as CoachActivityBrief);
      } catch {
        if (!cancelled) {
          setCoachError('Could not load coach activity');
          setCoachBrief(null);
        }
      } finally {
        if (!cancelled) setCoachLoading(false);
      }
    }
    loadCoachBrief();
    return () => { cancelled = true; };
  }, [authenticated, password]);

  async function logCoachActivity() {
    if (!password || !coachForm.target_org.trim()) return;
    setCoachLogStatus(null);
    try {
      const response = await fetch(`/api/admin/coach-activity?password=${encodeURIComponent(password)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach: coachForm.coach,
          activity_type: coachForm.activity_type,
          target_org: coachForm.target_org.trim(),
          objective: coachForm.objective.trim() || undefined,
          next_action: coachForm.next_action.trim() || undefined,
          channel: 'call',
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setCoachLogStatus(data.error || 'Failed to log activity');
        return;
      }
      setCoachLogStatus('Logged — refresh shows in queue');
      setCoachForm((f) => ({ ...f, target_org: '', objective: '', next_action: '' }));
      const refresh = await fetch(
        `/api/admin/coach-activity?password=${encodeURIComponent(password)}&limit=50`,
        { cache: 'no-store' },
      );
      const refreshed = await refresh.json();
      if (refreshed.success) setCoachBrief(refreshed as CoachActivityBrief);
    } catch {
      setCoachLogStatus('Failed to log activity');
    }
  }

  if (checking) {
    return <LoadingState />;
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Private workspace</p>
          <h1 className="mt-3 text-3xl font-bold">Mindy Command Center</h1>
          <p className="mt-3 text-slate-400">
            One internal link for launch priorities, owners, outreach, coach signals, enterprise sales, and social distribution.
          </p>
          <form className="mt-8 space-y-4" onSubmit={handleLogin}>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 pr-24 text-white outline-none transition focus:border-emerald-400"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-3 py-1.5 text-sm font-semibold text-emerald-300 transition hover:bg-slate-800 hover:text-emerald-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {authError ? <p className="text-sm text-red-300">{authError}</p> : null}
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Open Command Center
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-purple-500 px-3 py-2 text-lg font-black text-white">M</span>
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-sm font-semibold text-amber-200">
                Internal
              </span>
              <span className="rounded-full border border-purple-400/40 bg-purple-400/10 px-3 py-1 text-sm font-semibold text-purple-200">
                Customer first. Advisory second.
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">Mindy Command Center</h1>
            <p className="mt-3 max-w-3xl text-lg text-slate-300">
              One private operating page for launch execution, customer learning, coach alignment, enterprise selling, and social distribution.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-5 py-4 text-right">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Today</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{currentDate}</p>
            <div className="mt-4 flex justify-end gap-2">
              <a className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500" href="/command-center/dashboard">
                Admin Dashboard
              </a>
              <a className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500" href="/command-center/accounts">
                Mindy Accounts
              </a>
              <button
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
                onClick={() => {
                  sessionStorage.removeItem('adminAuth');
                  sessionStorage.removeItem('adminPassword');
                  setAuthenticated(false);
                  setPassword('');
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {/* Member Lookup — case-by-case Founders inquiry tool (live Stripe spend +
            Ultimate Giant ownership + recommended offer). Read-only. */}
        <MemberLookup password={password} />
        {/* ★ NORTH STAR — $100K/mo goal + the lead targets to hit it. The whole
            team sees this. Real MRR from Stripe; lead math from real close rates. */}
        <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-900/25 via-slate-900 to-slate-900 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">★ The Goal — $100K / month</p>
              <h2 className="mt-2 text-3xl font-bold md:text-4xl">Where we are, and what it takes to get there</h2>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                // Freshness indicator. After a manual refresh, show that time;
                // otherwise show when the daily Stripe→cache sync last ran. The
                // MRR number reads this cache, not live Stripe — so make it explicit.
                const cacheLabel = mrrGoal?.cacheUpdatedAt
                  ? new Date(mrrGoal.cacheUpdatedAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })
                  : null;
                const label = mrrSyncedAt ? `synced ${mrrSyncedAt}` : cacheLabel ? `as of ${cacheLabel}` : null;
                return label ? (
                  <span className="text-xs text-slate-500" title="MRR reads a daily Stripe cache; this is its last sync. Click Refresh purchases to pull live.">
                    {label}
                  </span>
                ) : null;
              })()}
              <button
                onClick={refreshPurchases}
                disabled={mrrSyncing}
                title="Pull the latest purchases from Stripe now (the MRR number reads a daily cache otherwise)"
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {mrrSyncing ? 'Syncing Stripe…' : '↻ Refresh purchases'}
              </button>
            </div>
          </div>

          {mrrGoalError && <p className="mt-6 text-sm text-red-300">{mrrGoalError}</p>}
          {!mrrGoal && !mrrGoalError && <p className="mt-6 text-sm text-slate-400">Loading the goal…</p>}

          {mrrGoal && (
            <>
              {/* Big MRR vs goal */}
              <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-1">
                <span className="text-5xl font-black text-emerald-300">${mrrGoal.mrr.toLocaleString()}</span>
                <span className="text-xl text-slate-400">/ ${mrrGoal.goal.toLocaleString()} MRR</span>
                <span className="ml-auto rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300">{mrrGoal.pctToGoal}% there</span>
              </div>
              <div className="mt-3 h-4 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${Math.max(1, mrrGoal.pctToGoal)}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-400">
                <span><b className="text-white">{mrrGoal.activeSubs}</b> active subs</span>
                <span><b className="text-white">${mrrGoal.arpu}</b> blended ARPU</span>
                <span><b className="text-white">{mrrGoal.subsRemainingAt149}</b> more $149 subs to goal</span>
                {mrrGoal.oneTimeCash30d ? <span><b className="text-white">${mrrGoal.oneTimeCash30d.toLocaleString()}</b> one-time cash (30d)</span> : null}
              </div>

              {/* LEAD TARGETS — High / Medium / Low */}
              <div className="mt-7">
                <p className="text-sm font-semibold text-white">Leads we need to convert {mrrGoal.subsRemainingAt149} more subs</p>
                <p className="text-xs text-slate-500">at three lead→paid close rates. IG peak was ~2,000 signups/mo — the Medium case is ~6 months at that pace.</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  {leadScenarios(mrrGoal.subsRemainingAt149).map((s) => {
                    const ring = s.tone === 'emerald' ? 'border-emerald-500/40 bg-emerald-500/5' : s.tone === 'amber' ? 'border-amber-500/40 bg-amber-500/5' : 'border-blue-500/40 bg-blue-500/5';
                    const text = s.tone === 'emerald' ? 'text-emerald-300' : s.tone === 'amber' ? 'text-amber-300' : 'text-blue-300';
                    return (
                      <div key={s.label} className={`rounded-xl border p-4 ${ring}`}>
                        <div className="flex items-baseline justify-between">
                          <span className={`text-sm font-bold uppercase tracking-wide ${text}`}>{s.label}</span>
                          <span className="text-xs text-slate-500">{Math.round(s.rate * 100)}% close</span>
                        </div>
                        <div className="mt-2 text-3xl font-black text-white">{s.leads.toLocaleString()}</div>
                        <div className="text-xs text-slate-400">total leads needed</div>
                        <div className="mt-2 text-sm text-slate-300">≈ <b className={text}>{s.perMonth6.toLocaleString()}/mo</b> for 6 months</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* LIFETIME / TIER LEVERS — fewer conversions needed */}
              {mrrGoal.lifetimeScenarios && mrrGoal.lifetimeScenarios.length > 0 && (
                <div className="mt-6 rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                  <p className="text-sm font-semibold text-purple-200">Lifetime / bundle levers — shrink the number</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {mrrGoal.lifetimeScenarios.map((l) => (
                      <div key={l.name} className="text-sm text-slate-300">
                        <b className="text-white">{l.name}</b> (${l.price.toLocaleString()}): <b className="text-purple-300">{l.salesToFundGoalMonth}</b> sales fund a $100K month · ${l.mrrEquivPerSale}/mo MRR-equiv each
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Plus Team ($499) & Enterprise tiers — every higher-tier sub counts as more than one $149.</p>
                </div>
              )}

              {/* UPGRADE-MODAL INTENT — the free→paid funnel's first step, measured. */}
              <div className="mt-6 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-blue-200">Free→paid funnel (last 30 days)</p>
                  <span className="text-xs text-slate-400">
                    {(mrrGoal.dripSends30d || 0) > 0 && <><b className="text-white">{mrrGoal.dripSends30d}</b> nurture sent</>}
                    {(mrrGoal.bootcampOfferSends || 0) > 0 && <> · <b className="text-white">{mrrGoal.bootcampOfferSends}</b> bootcamp offers</>}
                  </span>
                </div>
                {(mrrGoal.upgradeModalShown || 0) === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">No upgrade-modal opens yet — free users haven&apos;t clicked a locked feature in this window (or it just shipped).</p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
                      <span><b className="text-white">{mrrGoal.upgradeModalShown}</b> opens</span>
                      <span><b className="text-white">{mrrGoal.upgradeModalCtaClicks}</b> Go-Pro clicks</span>
                      <span><b className="text-blue-300">{mrrGoal.upgradeModalCtr}%</b> click-through</span>
                    </div>
                    {mrrGoal.topUpgradeFeatures && mrrGoal.topUpgradeFeatures.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {mrrGoal.topUpgradeFeatures.map((f) => (
                          <span key={f.feature} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-xs text-slate-300">
                            {f.feature} × <b className="text-white">{f.count}</b>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-slate-500">Which locked features drive the most upgrade intent — fuel for what to build/price next.</p>
                  </>
                )}
              </div>

              {/* UPGRADE CLICKERS — who to call for conversion right now */}
              <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-200">Upgrade clickers — call list</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Free users who clicked <span className="text-amber-300/90">Go Pro</span> in the upgrade modal (highest purchase intent in-app)
                    </p>
                  </div>
                  {password ? (
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/admin/upgrade-intent?password=${encodeURIComponent(password)}&format=csv&days=30&limit=200&level=hot`}
                        className="rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-600/20"
                      >
                        Export CSV
                      </a>
                      <button
                        type="button"
                        disabled={upgradeSlackLoading}
                        onClick={pushUpgradeClickersToSlack}
                        className="rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/20 disabled:opacity-50"
                      >
                        {upgradeSlackLoading ? 'Posting…' : 'Send to Slack'}
                      </button>
                    </div>
                  ) : null}
                </div>
                {upgradeIntentError ? (
                  <p className="mt-2 text-xs text-red-300">{upgradeIntentError}</p>
                ) : !upgradeIntent ? (
                  <p className="mt-2 text-xs text-slate-500">Loading upgrade clickers…</p>
                ) : upgradeIntent.summary.callableNow === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No Go-Pro clicks in the last {upgradeIntent.windowDays} days yet.
                    {upgradeIntent.summary.modalOpens > 0
                      ? ` ${upgradeIntent.summary.modalOpens} modal opens (warm leads) — switch export to include warm.`
                      : ' Tracking starts when free users click a Pro-locked sidebar feature.'}
                  </p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-300">
                      <span><b className="text-amber-300">{upgradeIntent.summary.callableNow}</b> to call now</span>
                      <span><b className="text-white">{upgradeIntent.summary.ctaClicks}</b> Go-Pro clicks</span>
                      <span><b className="text-white">{upgradeIntent.summary.modalOpens}</b> modal opens</span>
                      {upgradeIntent.summary.alreadyPro > 0 ? (
                        <span><b className="text-slate-400">{upgradeIntent.summary.alreadyPro}</b> already Pro</span>
                      ) : null}
                    </div>
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                      {upgradeIntent.candidates
                        .filter((c) => !c.isProSubscriber)
                        .map((candidate) => (
                          <div key={candidate.email} className="rounded-lg border border-amber-500/20 bg-slate-900/60 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-mono text-sm text-white break-all">{candidate.email}</p>
                              <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                                {candidate.ctaClicks}× click
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">
                              Unlocked <b className="text-amber-200/90">{candidate.topFeature}</b>
                              {candidate.lastCtaAt ? ` · ${candidate.lastCtaAt.slice(0, 10)}` : ''}
                              {candidate.profileComplete ? ' · profile done' : ' · needs NAICS setup'}
                            </p>
                            <p className="mt-1 text-xs text-amber-400/80">{candidate.recommendedAction}</p>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>

              {/* Current plan mix */}
              <div className="mt-5">
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Current active plan mix ({mrrGoal.activeSubs} subs)</p>
                <div className="flex flex-wrap gap-2">
                  {mrrGoal.byPlan.filter((p) => p.monthlyPrice > 0).map((p) => (
                    <span key={p.monthlyPrice} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-xs text-slate-300">
                      ${p.monthlyPrice} × <b className="text-white">{p.count}</b>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        {/* MEMBER ACCESS — full member directory + verify-before-grant Pro/Team.
            Employees work here, so the full table (tabs + counts + Stripe verify)
            lives inline. Authorized by the admin password already entered. */}
        <MemberAccessSection adminPassword={password} fullMode />

        {/* DEMAND HEATMAP — aggregated user-intent / collaboration signal (the "aha" feature) */}
        <section className="rounded-lg border border-cyan-500/30 bg-gradient-to-br from-cyan-900/20 to-slate-900 p-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-cyan-300">Demand Heatmap</p>
              <h2 className="mt-1 text-xl font-bold text-white">Who&apos;s tracking what — collaboration signal</h2>
              <p className="mt-1 text-sm text-slate-400">
                Opportunities ranked by how many Mindy users are tracking them. Sources Sought flagged
                (the collaboration sweet spot). The &quot;respond together&quot; collab alert fires at{' '}
                {heatmap?.threshold ?? 3}+ trackers — below that the signal is too weak to send.
              </p>
            </div>
            {heatmap && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-2xl font-bold text-cyan-300 tabular-nums">{heatmap.collabReadyCount}</div>
                  <div className="text-xs text-slate-400">collab-ready ({heatmap.totalTrackedOpps} tracked)</div>
                </div>
                {heatmap.opps.length > 0 && (
                  <button
                    onClick={() => setHeatmapOpen((o) => !o)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                    aria-expanded={heatmapOpen}
                  >
                    {heatmapOpen ? 'Hide' : `Show ${heatmap.collabReadyCount}`} {heatmapOpen ? '▲' : '▼'}
                  </button>
                )}
              </div>
            )}
          </div>

          {heatmapError && <p className="mt-4 text-sm text-red-400">{heatmapError}</p>}
          {!heatmap && !heatmapError && <p className="mt-4 text-sm text-slate-400">Loading the heatmap…</p>}

          {heatmap && heatmap.opps.length === 0 && (
            <p className="mt-4 text-sm text-slate-400">No tracked opportunities yet.</p>
          )}

          {heatmap && heatmap.opps.length > 0 && heatmapOpen && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-700">
                    <th className="py-2 pr-3 font-semibold">Trackers</th>
                    <th className="py-2 pr-3 font-semibold">Opportunity</th>
                    <th className="py-2 pr-3 font-semibold">Collab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {heatmap.opps.slice(0, 20).map((o) => (
                    <tr key={o.noticeId} className="align-top hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3 tabular-nums">
                        <span className="text-lg font-bold text-cyan-300">{o.trackerCount}</span>
                        {o.pursuingCount > 0 && <span className="text-[11px] text-slate-500"> · {o.pursuingCount} pursuing</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-200 max-w-md">
                        {o.isSourcesSought && <span className="mr-1.5 text-[10px] font-semibold text-purple-300 bg-purple-500/15 px-1.5 py-0.5 rounded uppercase">SS</span>}
                        {o.title}
                        {o.agency && <span className="block text-[11px] text-slate-500">{o.agency}</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {o.collabReady
                          ? <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded uppercase">Ready</span>
                          : <span className="text-[11px] text-slate-600">below {heatmap.threshold}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Collab alert preview — the actionable signal; stays visible even when the table is collapsed. */}
          {heatmap && heatmap.collabReadyCount > 0 && (
            <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-900/15 p-3">
              <p className="text-xs font-semibold text-emerald-300 uppercase tracking-wide mb-1">Collab alert preview (≥{heatmap.threshold} trackers)</p>
              {heatmap.opps.filter((o) => o.collabReady).slice(0, 3).map((o) => (
                <p key={o.noticeId} className="text-sm text-slate-300 mt-1">“{o.collabPreview}”</p>
              ))}
              <p className="text-[11px] text-slate-500 mt-2">Phase 1: previews only — you control the first sends. Auto-trigger comes once volume proves the signal.</p>
            </div>
          )}
        </section>

        {/* PARTNER / AFFILIATE PROGRAMS — tagged signups + 30% recurring commissions */}
        <section className="rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-900/20 to-slate-900 p-6">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-violet-300">Partner &amp; Affiliate Programs</p>
            <h2 className="mt-2 text-3xl font-bold">
              {partnerBrief?.defaultAffiliatePercent ?? 30}% recurring affiliate — attribution + payouts owed
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Signups tagged via <code className="text-violet-200">getmindy.ai/&#123;slug&#125;</code> or{' '}
              <code className="text-violet-200">?ref=CODE</code>. Commissions accrue on Stripe checkout + renewals.
            </p>
          </div>

          {partnerBriefError && <p className="mt-6 text-sm text-red-300">{partnerBriefError}</p>}
          {!partnerBrief && !partnerBriefError && (
            <p className="mt-6 text-sm text-slate-400">Loading partner programs…</p>
          )}

          {partnerBrief && partnerBrief.programs.length > 0 && (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {partnerBrief.programs.map((p) => (
                <div key={p.code} className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-white">{p.name}</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Code <b className="text-violet-300">{p.code}</b> · {p.affiliatePercent}% affiliate · {p.compensationModel}
                      </p>
                    </div>
                    <a
                      href={p.urls.landing}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs text-violet-200 hover:border-violet-400"
                    >
                      Open link
                    </a>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Commission owed (lifetime)</p>
                      <p className="text-lg font-bold text-violet-300">{p.affiliate.commissionFormatted}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Paying customers</p>
                      <p className="text-lg font-bold text-white">{p.affiliate.payingCustomers}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Per $149/mo sub (affiliate / you)</p>
                      <p className="text-sm text-slate-300">
                        <b className="text-violet-300">{p.affiliate.affiliatePer149SubFormatted || '—'}</b>
                        {' / '}
                        <b className="text-emerald-300">{p.affiliate.yourNetPer149SubFormatted || '—'}</b>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Est. monthly run-rate owed</p>
                      <p className="text-sm font-semibold text-slate-200">{p.affiliate.monthlyRunRateFormatted}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500 break-all">{p.urls.landing}</p>
                </div>
              ))}
            </div>
          )}

          {partnerBrief && partnerBrief.programs.length === 0 && (
            <p className="mt-6 text-sm text-slate-400">No partner programs registered yet.</p>
          )}
        </section>

        {/* BETA SETUP CONVERSION — how many entitled beta users have turned their
            access into a real login, and how the setup-invite queue is draining. */}
        <section className="rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-900/20 to-slate-900 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-purple-300">Beta Setup Conversion</p>
              <h2 className="mt-2 text-3xl font-bold">Are entitled beta users setting up accounts?</h2>
              <p className="mt-2 text-sm text-slate-400">
                Entitled = has access and should create a login. Sent {betaConv?.perDay ?? 50}/day by the setup-invite cron.
              </p>
            </div>
          </div>

          {betaConvLoading && !betaConv && (
            <p className="mt-6 text-sm text-slate-400">Loading conversion funnel…</p>
          )}
          {betaConvError && (
            <p className="mt-6 text-sm text-red-300">{betaConvError}</p>
          )}

          {betaConv && (
            <>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                  <div className="text-3xl font-bold text-white">{betaConv.entitledTotal.toLocaleString()}</div>
                  <div className="mt-1 text-sm text-slate-400">Entitled beta users</div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="text-3xl font-bold text-emerald-300">
                    {betaConv.converted.toLocaleString()}
                    <span className="ml-2 text-base font-semibold text-emerald-400/80">{betaConv.conversionRate}%</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-400">Converted (have a login)</div>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <div className="text-3xl font-bold text-amber-300">{betaConv.invitedPending.toLocaleString()}</div>
                  <div className="mt-1 text-sm text-slate-400">Invited, not set up yet</div>
                </div>
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
                  <div className="text-3xl font-bold text-blue-300">{betaConv.remaining.toLocaleString()}</div>
                  <div className="mt-1 text-sm text-slate-400">In send queue (~{betaConv.daysToDrain}d to drain)</div>
                </div>
              </div>

              {/* Conversion progress bar: converted / invited-pending / remaining */}
              <div className="mt-5">
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
                  <div className="bg-emerald-500" style={{ width: `${pct(betaConv.converted, betaConv.entitledTotal)}%` }} title={`Converted: ${betaConv.converted}`} />
                  <div className="bg-amber-500" style={{ width: `${pct(betaConv.invitedPending, betaConv.entitledTotal)}%` }} title={`Invited pending: ${betaConv.invitedPending}`} />
                  <div className="bg-blue-500/60" style={{ width: `${pct(betaConv.remaining, betaConv.entitledTotal)}%` }} title={`Queue: ${betaConv.remaining}`} />
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Converted</span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Invited, pending</span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500/60" />Queue remaining</span>
                </div>
              </div>

              {betaConv.sendTrend.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Setup invites sent — last {betaConv.sendTrend.length} days</p>
                  <div className="flex items-end gap-1 h-16">
                    {betaConv.sendTrend.map((d) => {
                      const max = Math.max(...betaConv.sendTrend.map((x) => x.count), 1);
                      return (
                        <div key={d.date} className="flex-1 bg-purple-500/50 rounded-t" style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }} title={`${d.date}: ${d.count}`} />
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Live Growth Brief</p>
              <h2 className="mt-2 text-3xl font-bold">What changed and who needs action</h2>
              <p className="mt-2 text-sm text-slate-400">
                Pulled from the protected MI Growth Brief endpoint for the last {growthBrief?.window.days || 7} days.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const storedPassword = sessionStorage.getItem('adminPassword') || password;
                if (storedPassword) {
                  setPassword(storedPassword);
                  setGrowthBrief(null);
                  setAuthenticated(true);
                  setGrowthLoading(true);
                  fetch(`/api/admin/mi-growth-brief?password=${encodeURIComponent(storedPassword)}&days=7`, { cache: 'no-store' })
                    .then((response) => response.json().then((data) => ({ response, data })))
                    .then(({ response, data }) => {
                      if (!response.ok || !data.success) {
                        setGrowthError(data.error || 'Could not load growth brief');
                        setGrowthBrief(null);
                      } else {
                        setGrowthError('');
                        setGrowthBrief(data as GrowthBrief);
                      }
                    })
                    .catch(() => {
                      setGrowthError('Could not load growth brief');
                      setGrowthBrief(null);
                    })
                    .finally(() => setGrowthLoading(false));
                }
              }}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
            >
              Refresh Brief
            </button>
          </div>

          {growthLoading ? (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-5">
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="command-center-loader h-full w-1/3 rounded-full bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400" />
              </div>
              <p className="mt-3 text-sm text-slate-400">Loading MI growth signals...</p>
            </div>
          ) : growthError ? (
            <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-5 text-red-100">
              {growthError}
            </div>
          ) : growthBrief ? (
            <div className="mt-6 space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <p className="text-sm text-slate-400">Profiles Complete</p>
                  <p className="mt-2 text-4xl font-bold text-emerald-300">{formatNumber(growthBrief.audience.profileComplete)}</p>
                  <p className="mt-1 text-sm text-slate-500">{growthBrief.audience.profileCompletionRate} of {formatNumber(growthBrief.audience.totalUsers)} users</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <p className="text-sm text-slate-400">Active In MI</p>
                  <p className="mt-2 text-4xl font-bold text-blue-300">{formatNumber(growthBrief.engagement.active7d)}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatNumber(growthBrief.engagement.activeToday)} active today</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <p className="text-sm text-slate-400">Time In MI</p>
                  <p className="mt-2 text-4xl font-bold text-purple-300">{formatMinutes(growthBrief.engagement.timeInMiMinutes)}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatMinutes(growthBrief.engagement.avgMinutesPerActiveUser)} per active user</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <p className="text-sm text-slate-400">Email Click Rate</p>
                  <p className="mt-2 text-4xl font-bold text-amber-300">{growthBrief.email.clickRate}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatNumber(growthBrief.email.clicked)} clicks from {formatNumber(growthBrief.email.sent)} sent</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <h3 className="text-xl font-bold">Action Queues</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {(Object.keys(growthQueueLabels) as GrowthQueueName[]).map((queueName) => (
                      <div key={queueName} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                        <p className="text-sm text-slate-400">{growthQueueLabels[queueName]}</p>
                        <p className="mt-2 text-3xl font-bold text-white">{formatNumber(growthBrief.queues[queueName]?.length || 0)}</p>
                        <p className="mt-1 text-xs text-slate-500">{growthBrief.queues[queueName]?.[0]?.owner || 'No owner needed'}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <h3 className="text-xl font-bold">Recommended Team Actions</h3>
                  <div className="mt-4 space-y-3">
                    {growthBrief.recommendedActions.slice(0, 4).map((item) => (
                      <div key={`${item.owner}-${item.action}`} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                        <p className="text-sm font-semibold text-emerald-200">{item.owner}</p>
                        <p className="mt-1 text-sm text-white">{item.action}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.why}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {growthBrief.freshness.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Data quality notes: {growthBrief.freshness.warnings.slice(0, 3).join(' | ')}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-5 text-slate-400">
              Growth brief will load after admin authentication.
            </div>
          )}
        </section>

        {/* Customer Qualification Section - 10-10 Candidates */}
        <section className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-900/20 to-slate-900 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-amber-300">Customer Qualification Agent</p>
              <h2 className="mt-2 text-3xl font-bold">High-Value Customer Outreach</h2>
              <p className="mt-2 text-sm text-slate-400">
                Purchase-based scoring identifies your best customers for founder calls, activation nudges, sales outreach, and rescue campaigns.
              </p>
            </div>
            {qualBrief && password ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/admin/qualify-customers?password=${encodeURIComponent(password)}&segment=activation&format=csv&limit=200`}
                  className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-600/20"
                >
                  Export Activation CSV
                </a>
                <button
                  type="button"
                  disabled={qualSlackLoading}
                  onClick={() => pushQualSegmentToSlack('activation')}
                  className="rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-200 hover:bg-purple-500/20 disabled:opacity-50"
                >
                  {qualSlackLoading ? 'Posting…' : 'Send Activation → Slack'}
                </button>
              </div>
            ) : null}
          </div>
          {qualSlackStatus ? (
            <p className={`mt-3 text-sm ${qualSlackStatus.includes('Posted') ? 'text-emerald-300' : 'text-amber-300'}`}>
              {qualSlackStatus}
            </p>
          ) : null}

          {qualLoading ? (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-5">
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="command-center-loader h-full w-1/3 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" />
              </div>
              <p className="mt-3 text-sm text-slate-400">Scoring customers by purchase history...</p>
            </div>
          ) : qualError ? (
            <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-5 text-red-100">
              {qualError}
            </div>
          ) : qualBrief ? (
            <div className="mt-6 space-y-6">
              {/* Segment Stats */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="text-sm text-amber-200">10-10 Candidates</p>
                  <p className="mt-2 text-4xl font-bold text-amber-300">{qualBrief.summary.bySegment['10-10 Candidate']}</p>
                  <p className="mt-1 text-xs text-slate-400">Score 85+ • Founder calls</p>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="text-sm text-emerald-200">Activation Candidates</p>
                  <p className="mt-2 text-4xl font-bold text-emerald-300">{qualBrief.summary.bySegment['Activation Candidate']}</p>
                  <p className="mt-1 text-xs text-slate-400">Incomplete profile (default NAICS) · score 30+ · setup nudges</p>
                </div>
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                  <p className="text-sm text-red-200">Rescue Candidates</p>
                  <p className="mt-2 text-4xl font-bold text-red-300">{qualBrief.summary.bySegment['Rescue Candidate']}</p>
                  <p className="mt-1 text-xs text-slate-400">Paid but inactive • Re-engage</p>
                </div>
                <div className="rounded-lg border border-slate-500/30 bg-slate-500/10 p-4">
                  <p className="text-sm text-slate-300">Total Purchasers</p>
                  <p className="mt-2 text-4xl font-bold text-white">{qualBrief.summary.uniquePurchasers}</p>
                  <p className="mt-1 text-xs text-slate-400">From {formatNumber(qualBrief.summary.totalPurchases)} purchases</p>
                </div>
              </div>

              {/* Founder Call Queue */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-amber-500/20 bg-slate-950/50 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-amber-200">🎯 Founder Call Queue</h3>
                    <span className="rounded-full bg-amber-500/20 px-3 py-1 text-sm font-semibold text-amber-300">
                      {qualBrief.lists.founderCalls.length} candidates
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">High-value customers worth Eric&apos;s time</p>
                  <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">
                    {qualBrief.lists.founderCalls.slice(0, 8).map((candidate) => (
                      <div key={candidate.email} className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
                        <div className="flex items-start justify-between">
                          <p className="font-mono text-sm text-white">{candidate.email}</p>
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                            {candidate.score}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">{candidate.why}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-500/20 bg-slate-950/50 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-emerald-200">💼 Sales Outreach Queue</h3>
                    <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-sm font-semibold text-emerald-300">
                      {qualBrief.lists.salesOutreach.length} candidates
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">Customers ready for Branden&apos;s upgrade pitch</p>
                  <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">
                    {qualBrief.lists.salesOutreach.slice(0, 8).map((candidate) => (
                      <div key={candidate.email} className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
                        <div className="flex items-start justify-between">
                          <p className="font-mono text-sm text-white">{candidate.email}</p>
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                            {candidate.score}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">{candidate.why}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Activation Queue — incomplete profile, not sales/rescue/upgrade */}
              <div className="rounded-lg border border-emerald-500/20 bg-slate-950/50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-emerald-200">⚡ Activation Queue</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      Mindy users still on <span className="text-emerald-300/90">default NAICS</span> — help them finish profile setup (Annelle / Sikander)
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Includes free signups and paid buyers who never picked custom NAICS. Excludes 10-10, white-glove, rescue, and MI Pro upgrade queues.
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-sm font-semibold text-emerald-300">
                    Showing {qualBrief.lists.activationCandidates?.length || 0} of {qualBrief.summary.bySegment['Activation Candidate']}
                  </span>
                </div>
                <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
                  {(qualBrief.lists.activationCandidates || []).map((candidate) => (
                    <div key={candidate.email} className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-mono text-sm text-white break-all">{candidate.email}</p>
                        <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                          {candidate.score}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{candidate.why}</p>
                      {candidate.action ? (
                        <p className="mt-1 text-xs text-emerald-400/80">{candidate.action}</p>
                      ) : null}
                    </div>
                  ))}
                  {(qualBrief.lists.activationCandidates?.length || 0) === 0 ? (
                    <p className="text-sm text-slate-500">No activation candidates in the top-50 list.</p>
                  ) : null}
                </div>
              </div>

              {/* Rescue Queue if any */}
              {qualBrief.lists.rescueCandidates.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-slate-950/50 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-red-200">🚨 Rescue Queue</h3>
                    <span className="rounded-full bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-300">
                      {qualBrief.lists.rescueCandidates.length} at risk
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">Paid customers who went dark — re-engage before churn</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {qualBrief.lists.rescueCandidates.map((candidate) => (
                      <div key={candidate.email} className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                        <p className="font-mono text-sm text-white">{candidate.email}</p>
                        <p className="mt-2 text-xs text-slate-400">{candidate.why}</p>
                        <p className="mt-2 text-xs font-semibold text-red-300">{candidate.action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-5 text-slate-400">
              Qualification data will load after admin authentication.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Launch Manager Brief</p>
              <h2 className="mt-2 text-3xl font-bold">What the team should execute next</h2>
              <p className="mt-2 text-sm text-slate-400">
                Built from the source-of-truth docs, task list, launch roadmap, and team alignment memo.
              </p>
            </div>
            {launchBrief ? (
              <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-2 text-sm text-slate-400">
                Updated {new Date(launchBrief.generatedAt).toLocaleString('en-US')}
              </p>
            ) : null}
          </div>

          {launchLoading ? (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-5">
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="command-center-loader h-full w-1/3 rounded-full bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400" />
              </div>
              <p className="mt-3 text-sm text-slate-400">Loading launch manager brief...</p>
            </div>
          ) : launchError ? (
            <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-5 text-red-100">
              {launchError}
            </div>
          ) : launchBrief ? (
            <div className="mt-6 space-y-6">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Domain Rule</p>
                <p className="mt-2 text-lg font-semibold text-white">{launchBrief.domainPolicy.rule}</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-slate-950/40 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Public / SEO / Sales</p>
                    <p className="mt-1 font-mono text-sm text-emerald-200">{launchBrief.domainPolicy.publicSite}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/40 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Mindy Product Platform</p>
                    <p className="mt-1 font-mono text-sm text-blue-200">{launchBrief.domainPolicy.miPlatform}</p>
                  </div>
                </div>
                {launchBrief.domainPolicy.warnings.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                    Link cleanup signals: {launchBrief.domainPolicy.warnings.map((warning) => `${warning.label}: ${warning.occurrences}`).join(' | ')}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {launchBrief.launches.map((launch) => (
                  <article key={launch.name} className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold text-white">{launch.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">{launch.status}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${launchHealthClasses[launch.health]}`}>
                        {launch.health}
                      </span>
                    </div>
                    <p className="mt-4 text-sm text-slate-300">{launch.objective}</p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-900/70 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Blockers</p>
                        <p className="mt-2 text-2xl font-bold text-amber-200">{formatNumber(launch.blockers.length)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-900/70 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Done Signals</p>
                        <p className="mt-2 text-2xl font-bold text-emerald-200">{formatNumber(launch.changes.length)}</p>
                      </div>
                    </div>
                    {launch.blockers[0] ? (
                      <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400">
                        Next blocker: {launch.blockers[0]}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <h3 className="text-xl font-bold">Owner Actions</h3>
                  <div className="mt-4 space-y-3">
                    {launchBrief.ownerActions.slice(0, 8).map((item) => (
                      <div key={`${item.owner}-${item.action}`} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-blue-200">{item.owner}</p>
                            <p className="mt-1 text-sm text-white">{item.action}</p>
                          </div>
                          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
                            {item.dueDate}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{item.why}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                  <h3 className="text-xl font-bold">Open Decisions</h3>
                  <div className="mt-4 space-y-3">
                    {launchBrief.decisions.length > 0 ? launchBrief.decisions.slice(0, 6).map((item) => (
                      <div key={item.decisionNeeded} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                        <p className="text-sm font-semibold text-purple-200">{item.owner}</p>
                        <p className="mt-1 text-sm text-white">{item.decisionNeeded}</p>
                        <p className="mt-2 text-xs text-slate-500">{item.whyItMatters}</p>
                      </div>
                    )) : (
                      <p className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
                        No open decisions found in the current source docs.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-5 text-slate-400">
              Launch manager brief will load after admin authentication.
            </div>
          )}
        </section>

        {/* Coach Signal Loop — partner BD, NOT profile nudges */}
        <section className="rounded-lg border border-blue-500/30 bg-gradient-to-br from-blue-900/20 to-slate-900 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Coach Signal Loop</p>
              <h2 className="mt-2 text-3xl font-bold">Partner BD + Referrals</h2>
              <p className="mt-2 text-sm text-slate-400">
                Ryan, Zach, Randie, Tavin own APEX/SBDC/Chamber partnerships and signal capture.
                Profile nudges stay with Annelle/Sikander — coaches do not run the activation queue.
              </p>
            </div>
            {coachBrief && (
              <div className="text-right">
                <p className="text-3xl font-bold text-blue-300">{coachBrief.summary?.open ?? 0}</p>
                <p className="text-xs text-slate-500">open coach activities</p>
              </div>
            )}
          </div>

          {coachLoading ? (
            <p className="mt-6 text-sm text-slate-400">Loading coach queue…</p>
          ) : coachBrief?.migrationNeeded ? (
            <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              Run migration in Supabase: <code className="text-amber-200">supabase/migrations/20260611_internal_coach_activity.sql</code>
            </div>
          ) : coachError && !coachBrief ? (
            <p className="mt-6 text-sm text-red-300">{coachError}</p>
          ) : (
            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                <h3 className="text-lg font-bold">Log partner activity</h3>
                <p className="mt-1 text-xs text-slate-500">Target: 20 outreach calls/week per coach (COACH-ENTERPRISE-BD-PLAN)</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <select
                    value={coachForm.coach}
                    onChange={(e) => setCoachForm((f) => ({ ...f, coach: e.target.value }))}
                    className="h-10 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-white"
                  >
                    {['Ryan', 'Zach', 'Randie', 'Tavin'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={coachForm.activity_type}
                    onChange={(e) => setCoachForm((f) => ({ ...f, activity_type: e.target.value }))}
                    className="h-10 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-white"
                  >
                    <option value="partner_bd">Partner BD</option>
                    <option value="livestream_validation">Livestream validation</option>
                    <option value="customer_success_checkin">Customer success</option>
                    <option value="enterprise_referral">Enterprise referral</option>
                    <option value="proof_story">Proof story</option>
                    <option value="white_glove_referral">White-glove referral</option>
                  </select>
                </div>
                <input
                  value={coachForm.target_org}
                  onChange={(e) => setCoachForm((f) => ({ ...f, target_org: e.target.value }))}
                  placeholder="Target org (e.g. Florida APEX Tampa)"
                  className="mt-3 w-full h-10 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-white placeholder-slate-500"
                />
                <input
                  value={coachForm.objective}
                  onChange={(e) => setCoachForm((f) => ({ ...f, objective: e.target.value }))}
                  placeholder="Objective (e.g. bulk alert signup email to client list)"
                  className="mt-2 w-full h-10 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-white placeholder-slate-500"
                />
                <button
                  type="button"
                  onClick={logCoachActivity}
                  disabled={!coachForm.target_org.trim()}
                  className="mt-3 h-10 w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:bg-slate-700"
                >
                  Log activity
                </button>
                {coachLogStatus && (
                  <p className={`mt-2 text-xs ${coachLogStatus.startsWith('Logged') ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {coachLogStatus}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                <h3 className="text-lg font-bold">Recent coach queue</h3>
                <div className="mt-4 max-h-72 overflow-y-auto space-y-2">
                  {(coachBrief?.activities || []).length === 0 ? (
                    <p className="text-sm text-slate-500">No activities logged yet. Coaches: log your first APEX/SBDC outreach call above.</p>
                  ) : (
                    coachBrief!.activities.slice(0, 12).map((row) => (
                      <div key={row.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-blue-200">{row.coach}</span>
                          <span className="text-[10px] uppercase tracking-wider text-slate-500">{row.status}</span>
                        </div>
                        <p className="mt-1 text-sm text-white">{row.target_org || row.target_name || '—'}</p>
                        <p className="text-xs text-slate-500">{row.activity_type.replace(/_/g, ' ')}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5">
            <p className="text-sm uppercase tracking-[0.18em] text-emerald-200">Launch Objective</p>
            <p className="mt-3 text-2xl font-bold">Get users to find and pursue better contracts</p>
            <p className="mt-3 text-sm text-emerald-100/80">Measure signups, profile setup, MI usage, pipeline movement, and proof stories.</p>
          </div>
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-5">
            <p className="text-sm uppercase tracking-[0.18em] text-blue-200">Current Focus</p>
            <p className="mt-3 text-2xl font-bold">Talk to users first</p>
            <p className="mt-3 text-sm text-blue-100/80">Shanoor and Sikander validate customers before broader advisory outreach.</p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="text-sm uppercase tracking-[0.18em] text-amber-200">Sales Lever</p>
            <p className="mt-3 text-2xl font-bold">Package the right path</p>
            <p className="mt-3 text-sm text-amber-100/80">Branden owns package presentations and enterprise selling follow-through.</p>
          </div>
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-5">
            <p className="text-sm uppercase tracking-[0.18em] text-purple-200">Distribution Lever</p>
            <p className="mt-3 text-2xl font-bold">Track outcomes, not views</p>
            <p className="mt-3 text-sm text-purple-100/80">Kash, Usama, and Muneeba connect content to signups, replies, and calls.</p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Operating Lanes</p>
              <h2 className="mt-2 text-3xl font-bold">Who owns what</h2>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Manual org snapshot · owners as of {OPS_SNAPSHOT_AS_OF}</p>
            </div>
            <p className="max-w-2xl text-sm text-slate-400">
              Every lane should produce a customer signal, a next action, or a decision. If it does not, it does not belong in the launch workflow.
            </p>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {roleLanes.map((lane) => (
              <article key={lane.name} className={`rounded-lg border p-5 ${toneClasses[lane.tone]}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-white">{lane.name}</h3>
                    <p className="mt-1 text-sm font-semibold">{lane.owners}</p>
                  </div>
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]">
                    Signal lane
                  </span>
                </div>
                <p className="mt-4 text-sm text-slate-100/90">{lane.mission}</p>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-slate-950/40 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Next action</p>
                    <p className="mt-2 text-sm text-slate-100">{lane.nextAction}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/40 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Signal to capture</p>
                    <p className="mt-2 text-sm text-slate-100">{lane.signal}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">This Week</p>
            <h2 className="mt-2 text-3xl font-bold">Priorities and decisions</h2>
            <div className="mt-6 overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-slate-950 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Decision</th>
                    <th className="w-[1%] whitespace-nowrap px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {priorities.map((item) => (
                    <tr key={item.priority} className="bg-slate-900/80">
                      <td className="px-4 py-4 font-semibold text-white">{item.priority}</td>
                      <td className="px-4 py-4 text-slate-300">{item.owner}</td>
                      <td className="px-4 py-4 text-slate-300">{item.decision}</td>
                      <td className="w-[1%] whitespace-nowrap px-4 py-4">
                        <span className={statusBadgeClass(item.tone)}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Metrics Model</p>
            <h2 className="mt-2 text-3xl font-bold">What we need to track</h2>
            <div className="mt-6 space-y-3">
              {metrics.map(([label, detail]) => (
                <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                  <p className="font-semibold text-white">{label}</p>
                  <p className="mt-1 text-sm text-slate-400">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Operating Queues</p>
              <h2 className="mt-2 text-3xl font-bold">Team work that should become data</h2>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Manual snapshot · queue statuses as of {OPS_SNAPSHOT_AS_OF} (not live)</p>
            </div>
            <p className="max-w-2xl text-sm text-slate-400">
              Hand-maintained operating design. Each owner should be able to update status, notes, source, and next action directly from this page.
            </p>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {queueItems.map((item) => (
              <article key={`${item.queue}-${item.owner}`} className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-white">{item.queue}</h3>
                    <p className="mt-1 text-sm text-slate-400">{item.owner}</p>
                  </div>
                  <span className={statusBadgeClass(item.tone)}>
                    {item.status}
                  </span>
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-300">{item.segment}</p>
                <p className="mt-2 text-sm text-slate-400">{item.nextAction}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Source of Truth</p>
            <h2 className="mt-2 text-3xl font-bold">Planning docs</h2>
            <div className="mt-6 space-y-3">
              {sourceDocs.map((doc) => (
                <div key={doc} className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3 font-mono text-sm text-slate-300">
                  {doc}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Next Build Slice</p>
            <h2 className="mt-2 text-3xl font-bold">Make it operational</h2>
            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <p className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                Add a Supabase table for launch actions, owners, statuses, notes, and source links.
              </p>
              <p className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                Wire customer qualification, Stripe tier, MI profile state, email engagement, and app activity.
              </p>
              <p className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                Create owner-specific views for Shanoor, Sikander, coaches, Branden, and social media owners.
              </p>
              <p className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                Add Slack-ready summary generation so Eric can send one link and one brief.
              </p>
            </div>
          </div>
        </section>
      </div>
      <style jsx global>{`
        @keyframes command-center-slide {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(320%);
          }
        }

        .command-center-loader {
          animation: command-center-slide 1.25s ease-in-out infinite;
        }
      `}</style>
    </main>
  );
}
