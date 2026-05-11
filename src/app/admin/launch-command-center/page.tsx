'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type StatusTone = 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'slate';

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

const launchHealthClasses: Record<LaunchHealth, string> = {
  green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  yellow: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  red: 'border-red-500/40 bg-red-500/10 text-red-200',
};

const roleLanes: RoleLane[] = [
  {
    name: 'Customer Validation',
    owners: 'Annelle, Sikander',
    mission: 'Talk to users first and learn what makes MI useful enough to open every week.',
    nextAction: 'Run A1/A2 customer calls, tag blockers, and surface upgrade or proof-story candidates.',
    signal: 'Replies, booked calls, profile blockers, upgrade intent',
    tone: 'green',
  },
  {
    name: 'Coach Signal Loop',
    owners: 'Ryan, Zach, Randie, Tavin',
    mission: 'Turn coach conversations into activation help, partner leads, proof stories, and white-glove referrals.',
    nextAction: 'Log customer-success signals and partner/channel opportunities after each call or event.',
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
    decision: 'Use this page as the internal launch command center V1.',
    status: 'Built as V1 shell',
    tone: 'green',
  },
  {
    priority: 'Customer-first outreach',
    owner: 'Annelle / Sikander',
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
    decision: 'Wire Supabase, Stripe, email engagement, and app activity after V1 shell is approved.',
    status: 'Next phase',
    tone: 'slate',
  },
];

const queueItems: QueueItem[] = [
  {
    queue: 'A1 Customer Outreach',
    owner: 'Annelle',
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
    segment: 'Calls, live events, partner conversations, customer success touchpoints',
    nextAction: 'Log proof stories, partner leads, setup needs, and white-glove referrals.',
    status: 'Needs intake form',
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
        <h1 className="mt-3 text-3xl font-bold">MI Command Center</h1>
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

  if (checking) {
    return <LoadingState />;
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Private workspace</p>
          <h1 className="mt-3 text-3xl font-bold">MI Command Center</h1>
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
              <span className="rounded-lg bg-emerald-500 px-3 py-2 text-lg font-black text-slate-950">MI</span>
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-sm font-semibold text-amber-200">
                Internal V1
              </span>
              <span className="rounded-full border border-purple-400/40 bg-purple-400/10 px-3 py-1 text-sm font-semibold text-purple-200">
                Customer first. Advisory second.
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">MI Launch Command Center</h1>
            <p className="mt-3 max-w-3xl text-lg text-slate-300">
              One private operating page for launch execution, customer learning, coach alignment, enterprise selling, and social distribution.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-5 py-4 text-right">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Today</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{currentDate}</p>
            <div className="mt-4 flex justify-end gap-2">
              <a className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500" href="/admin/dashboard">
                Admin Dashboard
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
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">MI Product Platform</p>
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5">
            <p className="text-sm uppercase tracking-[0.18em] text-emerald-200">Launch Objective</p>
            <p className="mt-3 text-2xl font-bold">Get users to find and pursue better contracts</p>
            <p className="mt-3 text-sm text-emerald-100/80">Measure signups, profile setup, MI usage, pipeline movement, and proof stories.</p>
          </div>
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-5">
            <p className="text-sm uppercase tracking-[0.18em] text-blue-200">Current Focus</p>
            <p className="mt-3 text-2xl font-bold">Talk to users first</p>
            <p className="mt-3 text-sm text-blue-100/80">Annelle and Sikander validate customers before broader advisory outreach.</p>
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
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {priorities.map((item) => (
                    <tr key={item.priority} className="bg-slate-900/80">
                      <td className="px-4 py-4 font-semibold text-white">{item.priority}</td>
                      <td className="px-4 py-4 text-slate-300">{item.owner}</td>
                      <td className="px-4 py-4 text-slate-300">{item.decision}</td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses[item.tone]}`}>
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
            </div>
            <p className="max-w-2xl text-sm text-slate-400">
              V1 shows the operating design. V2 should let each owner update status, notes, source, and next action directly from this page.
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
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses[item.tone]}`}>
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
                Create owner-specific views for Annelle, Sikander, coaches, Branden, and social media owners.
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
