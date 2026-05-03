'use client';

import { useState, useEffect, useCallback } from 'react';

interface DashboardData {
  timestamp: string;
  displayDate: string;  // Shows yesterday's data (most recent completed day)
  emailOperations: {
    date: string;
    alerts: { sent: number; failed: number; skipped: number; successRate: string };
    briefings: {
      sent: number; failed: number; skipped: number; pending: number; successRate: string;
      byType?: { daily: number; weekly: number; pursuit: number };
    };
  };
  userHealth: {
    totalUsers: number;
    naicsConfigured: number;
    naicsPercent: string;
    businessTypeSet: number;
    businessTypePercent: string;
    alertsEnabledTotal: number;
    dailyFrequencyConfigured: number;
    weeklyFrequencyConfigured: number;
    postBetaPaidDailyEligible: number;
    postBetaFreeWeeklyFallback: number;
    briefingsProfileIncomplete: number;
    briefingsProfileIncompleteEmails: string[];
    briefingsEnabled: number;
    briefingsEntitled: number;
    briefingsCronEligible: number;
    briefingsExpired: number;
    internalExcluded: number;
    unconfiguredEmails: string[];
  };
  weeklyAlerts: {
    cycleDate: string;
    scheduledAtUtc: string;
    nextScheduledAtUtc: string;
    eligibleTotal: number;
    eligibleWithNaics: number;
    explicitWeeklyUsers: number;
    freeFallbackUsers: number;
    processedFreeFallback: number;
    processedExplicitWeekly: number;
    sent: number;
    failed: number;
    skipped: number;
    processed: number;
    remaining: number;
    successRate: string;
    lastSentAt: string | null;
  };
  betaHealth: {
    weeklyActiveUsers: number;
    dailyActiveUsers: number;
    dauWauRatio: string;
    activeBetaUsers: number;
    queueSize: number;
    activationRate7d: string;
    profileCompletionRate: string;
    firstClickUsers7d: number;
  };
  providerEmailHealth: {
    sends7d: number;
    delivered7d: number;
    opened7d: number;
    clicked7d: number;
    bounced7d: number;
    complained7d: number;
    failed7d: number;
    deliveryRate: string;
    clickRate: string;
    complaintRate: string;
    topLinks: Array<{ label: string; count: number }>;
  };
  matchingQuality: {
    totalFeedback: number;
    helpful: number;
    notHelpful: number;
    helpfulRate: string;
    last7Days: { total: number; helpful: number; notHelpful: number; helpfulRate: string };
    byType: {
      daily: { helpful: number; notHelpful: number; helpfulRate: string };
      weekly: { helpful: number; notHelpful: number; helpfulRate: string };
      pursuit: { helpful: number; notHelpful: number; helpfulRate: string };
    };
    usersNeedingAttention: number;
    repeatNegative: Array<{ email: string; count: number }>;
    zeroAlertUsers7d: number;
    highVolumeUsers7d: number;
  };
  trends: {
    alerts: Array<{ date: string; sent: number; failed: number; skipped: number }>;
    briefings: Array<{ date: string; sent: number; failed: number; skipped: number }>;
  };
  deadLetter: {
    total: number;
    pending: number;
    exhausted: number;
    resolved: number;
    oldestPending: string | null;
  };
  dataHealth: {
    totalForecasts: number;
    byAgency: Record<string, number>;
    samCacheCount: number;
    samCacheLastUpdate: string | null;
  };
  revenue: {
    available: boolean;
    thirtyDay?: {
      total: number;
      count: number;
      avgOrder: number;
      byProduct: Record<string, { count: number; revenue: number }>;
    };
    sevenDay?: {
      total: number;
      count: number;
    };
    recentPurchases?: Array<{
      email: string;
      product: string;
      amount: number;
      date: string;
      bundle?: string;
      details?: string;
    }>;
  };
  systemAlerts: Array<{ level: 'critical' | 'warning' | 'info'; message: string }>;
  profileReminderLastRun?: ProfileReminderRun | null;
}

interface ProfileReminderRun {
  action: string;
  mode: 'preview' | 'execute' | string;
  summary: {
    totalBriefingsUsers: number;
    usersWithEmptyProfiles: number;
    reminderCooldownDays?: number;
    skippedRecentlyReminded?: number;
    eligibleToSend?: number;
    cursorSkipped?: number;
    sendLimit?: number;
    remainingAfterSend?: number;
    wouldSendNow?: Array<{ email: string; createdAt?: string | null; updatedAt?: string | null }>;
    processed?: number;
    sent?: number;
    failed?: number;
    remaining?: number;
  };
  results?: Array<{ email: string; status: string; error?: string }>;
  completedAt: string;
}

interface ToolAccessSummary {
  marketAssassin: number;
  opportunityHunterPro: number;
  contentReaper: number;
  recompete: number;
  contractorDb: number;
  uniqueEmails: number;
}

type PreviewRecipient = string | { email: string; createdAt?: string | null; updatedAt?: string | null };

function getPreviewEmail(user: PreviewRecipient): string {
  return typeof user === 'string' ? user : user.email;
}

function getSystemAlertAction(alert: DashboardData['systemAlerts'][number]) {
  const message = alert.message.toLowerCase();

  if (alert.level === 'info') {
    return {
      href: '#ops-checklist',
      label: 'View checklist',
      note: 'No blocking alerts are open. Review the checklist below for the daily operating snapshot.',
    };
  }

  if (message.includes('weekly alert fallback')) {
    return {
      href: '#weekly-alert-fallback',
      label: 'Review fallback',
      note: 'Check remaining users, sent count, failures, and the next scheduled run.',
    };
  }

  if (message.includes('naics')) {
    return {
      href: '#profile-reminder-agent',
      label: 'Fix profiles',
      note: 'Preview or send the next profile-completion batch so matching quality improves.',
    };
  }

  if (message.includes('dead letter')) {
    return {
      href: '#dead-letter-queue',
      label: 'Review queue',
      note: 'Inspect pending and exhausted retries before processing the queue.',
    };
  }

  if (message.includes('delivery') || message.includes('resend') || message.includes('email')) {
    return {
      href: '/admin/emails',
      label: 'Open email history',
      note: 'Review provider events and recent delivery failures.',
    };
  }

  if (message.includes('feedback') || message.includes('matching')) {
    return {
      href: '/admin/feedback',
      label: 'Open feedback',
      note: 'Review not-helpful responses and matching-quality signals.',
    };
  }

  return {
    href: '#quick-actions',
    label: 'Review actions',
    note: 'Use the admin actions below to investigate or resolve this item.',
  };
}

// Admin navigation tabs
const adminTabs = [
  { href: '/admin/dashboard', label: 'Operations', icon: '📊' },
  { href: '/admin', label: 'Access Control', icon: '🔐' },
  { href: '/admin/purchases', label: 'Purchases', icon: '💳' },
  { href: '/admin/emails', label: 'Email History', icon: '📧' },
  { href: '/admin/feedback', label: 'Feedback', icon: '💬' },
];

export default function AdminDashboard() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [profileReminderRun, setProfileReminderRun] = useState<ProfileReminderRun | null>(null);
  const [toolAccessSummary, setToolAccessSummary] = useState<ToolAccessSummary | null>(null);
  const [testEmail, setTestEmail] = useState('eric@govcongiants.com');
  const [profileReminderLimit, setProfileReminderLimit] = useState(25);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/dashboard?password=${password}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 401) {
          setAuthenticated(false);
          setError('Invalid password');
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      if (json.profileReminderLastRun) {
        setProfileReminderRun(json.profileReminderLastRun);
      }
      try {
        const accessRes = await fetch('/api/admin/list-access', {
          headers: { 'x-admin-password': password },
          cache: 'no-store',
        });
        if (accessRes.ok) {
          const access = await accessRes.json();
          const uniqueEmails = new Set<string>();
          const addEmails = (records: Array<{ email?: string }> = []) => {
            records.forEach((record) => {
              if (record.email) uniqueEmails.add(record.email.toLowerCase());
            });
          };
          addEmails(access.marketAssassin);
          addEmails(access.opportunityScoutPro);
          addEmails(access.contentGenerator);
          addEmails(access.recompete);
          addEmails(access.database);
          setToolAccessSummary({
            marketAssassin: access.marketAssassin?.length || 0,
            opportunityHunterPro: access.opportunityScoutPro?.length || 0,
            contentReaper: access.contentGenerator?.length || 0,
            recompete: access.recompete?.length || 0,
            contractorDb: access.database?.length || 0,
            uniqueEmails: uniqueEmails.size,
          });
        }
      } catch {
        setToolAccessSummary(null);
      }
      setAuthenticated(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    // Auto-refresh every 60 seconds if authenticated
    if (authenticated) {
      const interval = setInterval(fetchDashboard, 60000);
      return () => clearInterval(interval);
    }
  }, [authenticated, fetchDashboard]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDashboard();
  };

  const handleAction = async (action: string, extraBody: Record<string, unknown> = {}) => {
    setActionResult(null);
    try {
      const res = await fetch(`/api/admin/dashboard?password=${password}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email: testEmail, ...extraBody })
      });
      const json = await res.json();
      setActionResult(`${action}: ${JSON.stringify(json, null, 2)}`);
      if (
        (action === 'preview-profile-reminders' || action === 'send-profile-reminders') &&
        json?.result?.summary
      ) {
        setProfileReminderRun({
          action,
          mode: json.result.mode || action,
          summary: json.result.summary,
          results: json.result.results || [],
          completedAt: new Date().toISOString(),
        });
      }
      // Refresh data after action
      setTimeout(fetchDashboard, 2000);
    } catch (e) {
      setActionResult(`Error: ${e}`);
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-white mb-6">Admin Dashboard</h1>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              className="w-full px-4 py-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-purple-500 focus:outline-none mb-4"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded transition-colors"
            >
              {loading ? 'Loading...' : 'Login'}
            </button>
          </form>
          {error && <p className="mt-4 text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading dashboard...</div>
      </div>
    );
  }

  const profileReminderMath = profileReminderRun
    ? {
        total: profileReminderRun.summary.usersWithEmptyProfiles,
        recentlyReminded: profileReminderRun.summary.skippedRecentlyReminded || 0,
        alreadyPassed: profileReminderRun.summary.cursorSkipped || 0,
        processed: profileReminderRun.summary.processed || 0,
        remaining: profileReminderRun.summary.remaining || 0,
      }
    : null;
  const profileReminderMathAddsUp = profileReminderMath
    ? profileReminderMath.total ===
      profileReminderMath.recentlyReminded +
      profileReminderMath.alreadyPassed +
      profileReminderMath.processed +
      profileReminderMath.remaining
    : true;
  const samCacheAgeHours = data.dataHealth.samCacheLastUpdate
    ? Math.round((Date.now() - new Date(data.dataHealth.samCacheLastUpdate).getTime()) / (1000 * 60 * 60))
    : null;
  const profileReminderRemaining = profileReminderRun?.summary?.remaining;
  const opsChecks = [
    {
      label: 'Daily alerts',
      value: `${data.emailOperations.alerts.sent} sent`,
      detail: `${data.emailOperations.alerts.failed} failed, ${data.emailOperations.alerts.skipped} skipped`,
      ok: data.emailOperations.alerts.sent > 0 && data.emailOperations.alerts.failed === 0,
      href: '#daily-alerts-delivery',
    },
    {
      label: 'Briefings',
      value: `${data.emailOperations.briefings.sent} sent`,
      detail: `${data.emailOperations.briefings.failed} failed, ${data.emailOperations.briefings.pending} pending`,
      ok: data.emailOperations.briefings.sent > 0 && data.emailOperations.briefings.failed === 0 && data.emailOperations.briefings.pending === 0,
      href: '#briefings-delivery',
    },
    {
      label: 'Weekly fallback',
      value: `${data.weeklyAlerts.remaining} remaining`,
      detail: `Cycle ${data.weeklyAlerts.cycleDate}`,
      ok: data.weeklyAlerts.remaining === 0,
      href: '#weekly-alert-fallback',
    },
    {
      label: 'Dead letter',
      value: `${data.deadLetter.pending} pending`,
      detail: `${data.deadLetter.exhausted} exhausted`,
      ok: data.deadLetter.pending === 0,
      href: '#dead-letter-queue',
    },
    {
      label: 'Profile reminders',
      value: typeof profileReminderRemaining === 'number' ? `${profileReminderRemaining} reminder queue` : `${data.userHealth.briefingsProfileIncomplete} incomplete`,
      detail: `${data.userHealth.briefingsProfileIncomplete} profiles still incomplete`,
      ok: typeof profileReminderRemaining === 'number' ? profileReminderRemaining === 0 : data.userHealth.briefingsProfileIncomplete === 0,
      href: '#profile-reminder-agent',
    },
    {
      label: 'SAM cache',
      value: samCacheAgeHours === null ? 'unknown' : `${samCacheAgeHours}h old`,
      detail: `${data.dataHealth.samCacheCount.toLocaleString()} cached opportunities`,
      ok: samCacheAgeHours !== null && samCacheAgeHours <= 36,
      href: '#data-health',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Navigation Tabs */}
        <div className="bg-gray-800 rounded-lg mb-6">
          <div className="flex items-center gap-1 p-2">
            <span className="text-gray-500 text-sm mr-4">Admin:</span>
            {adminTabs.map((tab) => {
              const isActive = tab.href === '/admin/dashboard';
              return (
                <a
                  key={tab.href}
                  href={tab.href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {tab.icon} {tab.label}
                </a>
              );
            })}
          </div>
        </div>

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">GovCon Giants Admin</h1>
            <p className="text-gray-400">Last updated: {new Date(data.timestamp).toLocaleString()}</p>
          </div>
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* System Alerts */}
        {data.systemAlerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {data.systemAlerts.map((alert, i) => {
              const action = getSystemAlertAction(alert);
              const tone =
                alert.level === 'critical'
                  ? {
                      card: 'bg-red-950/60 border-red-700 text-red-100',
                      pill: 'bg-red-800/70 text-red-50 hover:bg-red-700',
                      note: 'text-red-200/80',
                    }
                  : alert.level === 'warning'
                    ? {
                        card: 'bg-yellow-950/50 border-yellow-700 text-yellow-100',
                        pill: 'bg-yellow-600/30 text-yellow-50 hover:bg-yellow-600/45',
                        note: 'text-yellow-100/75',
                      }
                    : {
                        card: 'bg-blue-950/50 border-blue-700 text-blue-100',
                        pill: 'bg-blue-700/50 text-blue-50 hover:bg-blue-600/60',
                        note: 'text-blue-100/75',
                      };

              return (
                <div
                  key={i}
                  className={`rounded-lg border px-4 py-3 ${tone.card}`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-medium">{alert.message}</p>
                      <p className={`mt-1 text-sm ${tone.note}`}>{action.note}</p>
                    </div>
                    <a
                      href={action.href}
                      className={`shrink-0 rounded px-3 py-2 text-sm font-semibold transition-colors ${tone.pill}`}
                    >
                      {action.label}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Daily Ops Checklist */}
        <div id="ops-checklist" className="scroll-mt-6 bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex flex-col gap-2 mb-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Today&apos;s Ops Checklist</h2>
              <p className="text-sm text-gray-400">
                Morning readout for delivery, queues, profile setup, and data freshness.
              </p>
            </div>
            <span className="text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded">
              Reporting date {data.displayDate}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {opsChecks.map((check) => (
              <a
                key={check.label}
                href={check.href}
                className={`rounded-lg border p-4 transition-colors ${
                  check.ok
                    ? 'border-green-700/40 bg-green-950/20 hover:bg-green-950/30'
                    : 'border-yellow-700/50 bg-yellow-950/20 hover:bg-yellow-950/30'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{check.label}</p>
                    <p className="mt-1 text-2xl font-bold text-white">{check.value}</p>
                    <p className="mt-1 text-xs text-gray-400">{check.detail}</p>
                  </div>
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${
                    check.ok ? 'bg-green-900/70 text-green-200' : 'bg-yellow-900/70 text-yellow-100'
                  }`}>
                    {check.ok ? 'OK' : 'Needs review'}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* North Star / Launch Health */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-xl font-semibold text-white">Briefings Launch Command Center</h2>
              <p className="text-sm text-gray-400">Activation, entitlement, delivery, and matching quality for the paid briefings rollout.</p>
            </div>
            <span className="text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded">Last 7 days</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-900/60 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Engaged Users</p>
              <p className="text-3xl font-bold text-white">{data.betaHealth.weeklyActiveUsers.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Opened or clicked</p>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-4">
              <p className="text-gray-400 text-sm">DAU / WAU</p>
              <p className="text-3xl font-bold text-purple-300">{data.betaHealth.dauWauRatio}</p>
              <p className="text-xs text-gray-500 mt-1">{data.betaHealth.dailyActiveUsers} active today</p>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Alerts Audience</p>
              <p className="text-3xl font-bold text-white">{data.betaHealth.activeBetaUsers.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">{data.betaHealth.queueSize.toLocaleString()} queued</p>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Profile Completion</p>
              <p className="text-3xl font-bold text-green-400">{data.betaHealth.profileCompletionRate}</p>
              <p className="text-xs text-gray-500 mt-1">{data.betaHealth.activationRate7d} active in 7d</p>
            </div>
          </div>
        </div>

        {/* Tool Access Snapshot */}
        {toolAccessSummary && (
          <div className="bg-gray-800 rounded-lg p-6 mb-8">
            <div className="flex flex-col gap-2 mb-5 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Tool Access Snapshot</h2>
                <p className="text-sm text-gray-400">
                  Access Control counts by GovCon tool. AI Tools/mo is tracked separately in Stripe revenue.
                </p>
              </div>
              <a href="/admin" className="rounded bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600">
                Open Access Control
              </a>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="rounded bg-gray-900/60 p-4">
                <p className="text-xs text-gray-400">Unique Emails</p>
                <p className="text-2xl font-bold text-white">{toolAccessSummary.uniqueEmails}</p>
              </div>
              <div className="rounded bg-gray-900/60 p-4">
                <p className="text-xs text-gray-400">Market Assassin</p>
                <p className="text-2xl font-bold text-blue-300">{toolAccessSummary.marketAssassin}</p>
              </div>
              <div className="rounded bg-gray-900/60 p-4">
                <p className="text-xs text-gray-400">Opportunity Hunter</p>
                <p className="text-2xl font-bold text-green-300">{toolAccessSummary.opportunityHunterPro}</p>
              </div>
              <div className="rounded bg-gray-900/60 p-4">
                <p className="text-xs text-gray-400">Content Reaper</p>
                <p className="text-2xl font-bold text-purple-300">{toolAccessSummary.contentReaper}</p>
              </div>
              <div className="rounded bg-gray-900/60 p-4">
                <p className="text-xs text-gray-400">Recompete</p>
                <p className="text-2xl font-bold text-amber-300">{toolAccessSummary.recompete}</p>
              </div>
              <div className="rounded bg-gray-900/60 p-4">
                <p className="text-xs text-gray-400">Contractor DB</p>
                <p className="text-2xl font-bold text-emerald-300">{toolAccessSummary.contractorDb}</p>
              </div>
            </div>
          </div>
        )}

        {/* Delivery + Matching Quality */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Resend Delivery Health</h2>
                <p className="text-sm text-gray-400">Provider events captured from Resend webhooks.</p>
              </div>
              <a href="/admin/emails" className="text-sm text-purple-300 hover:text-purple-200">Email History</a>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-gray-900/60 rounded p-3">
                <p className="text-xs text-gray-400">Sent</p>
                <p className="text-2xl font-bold text-white">{data.providerEmailHealth.sends7d.toLocaleString()}</p>
              </div>
              <div className="bg-gray-900/60 rounded p-3">
                <p className="text-xs text-gray-400">Delivered</p>
                <p className="text-2xl font-bold text-green-400">{data.providerEmailHealth.deliveryRate}</p>
              </div>
              <div className="bg-gray-900/60 rounded p-3">
                <p className="text-xs text-gray-400">Click Rate</p>
                <p className="text-2xl font-bold text-blue-300">{data.providerEmailHealth.clickRate}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Opened</p>
                <p className="text-white font-mono">{data.providerEmailHealth.opened7d}</p>
              </div>
              <div>
                <p className="text-gray-500">Clicked</p>
                <p className="text-white font-mono">{data.providerEmailHealth.clicked7d}</p>
              </div>
              <div>
                <p className="text-gray-500">Bounced</p>
                <p className="text-red-400 font-mono">{data.providerEmailHealth.bounced7d}</p>
              </div>
              <div>
                <p className="text-gray-500">Complaints</p>
                <p className="text-red-400 font-mono">{data.providerEmailHealth.complained7d}</p>
              </div>
            </div>
            {data.providerEmailHealth.topLinks.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-700">
                <p className="text-gray-400 text-sm mb-2">Top Clicks</p>
                <div className="flex flex-wrap gap-2">
                  {data.providerEmailHealth.topLinks.map((link) => (
                    <span key={link.label} className="px-2 py-1 bg-gray-700 rounded text-sm text-white">
                      {link.label}: {link.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-gray-500 mt-4">
              Click rate is the decision metric. Opens can be inflated by Apple Mail Privacy Protection.
            </p>
          </div>

          <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Matching Quality</h2>
                <p className="text-sm text-gray-400">Feedback and alert-volume risk signals.</p>
              </div>
              <a href="/admin/feedback" className="text-sm text-purple-300 hover:text-purple-200">Feedback</a>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-gray-900/60 rounded p-3">
                <p className="text-xs text-gray-400">Helpful Rate</p>
                <p className={`text-2xl font-bold ${parseInt(data.matchingQuality.helpfulRate) >= 60 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.matchingQuality.helpfulRate}
                </p>
              </div>
              <div className="bg-gray-900/60 rounded p-3">
                <p className="text-xs text-gray-400">Zero Alerts</p>
                <p className="text-2xl font-bold text-yellow-300">{data.matchingQuality.zeroAlertUsers7d}</p>
              </div>
              <div className="bg-gray-900/60 rounded p-3">
                <p className="text-xs text-gray-400">30+ Alerts</p>
                <p className="text-2xl font-bold text-orange-300">{data.matchingQuality.highVolumeUsers7d}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Total</p>
                <p className="text-white font-mono">{data.matchingQuality.totalFeedback}</p>
              </div>
              <div>
                <p className="text-gray-500">Helpful</p>
                <p className="text-green-400 font-mono">{data.matchingQuality.helpful}</p>
              </div>
              <div>
                <p className="text-gray-500">Not Helpful</p>
                <p className="text-red-400 font-mono">{data.matchingQuality.notHelpful}</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(data.matchingQuality.byType).map(([type, stats]) => (
                <div key={type} className="bg-gray-700/70 rounded p-3">
                  <p className="text-white capitalize font-medium">{type}</p>
                  <p className="text-sm text-gray-300 mt-1">
                    <span className="text-green-400">{stats.helpful}</span>
                    <span className="text-gray-500"> / </span>
                    <span className="text-red-400">{stats.notHelpful}</span>
                    <span className="text-gray-500 float-right">{stats.helpfulRate}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Yesterday's Alerts (most recent completed day) */}
          <div id="daily-alerts-delivery" className="scroll-mt-6 bg-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-semibold text-white">Daily Alerts Delivery</h2>
              <span className="text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded">
                {data.emailOperations.date ? new Date(data.emailOperations.date + 'T00:00:00').toLocaleDateString() : 'Yesterday'}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Sent</span>
                <span className="text-green-400 font-mono">{data.emailOperations.alerts.sent}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Failed</span>
                <span className="text-red-400 font-mono">{data.emailOperations.alerts.failed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Skipped</span>
                <span className="text-yellow-400 font-mono">{data.emailOperations.alerts.skipped}</span>
              </div>
              <div className="pt-2 border-t border-gray-700 flex justify-between">
                <span className="text-gray-400">Success Rate</span>
                <span className="text-white font-semibold">{data.emailOperations.alerts.successRate}</span>
              </div>
            </div>
          </div>

          {/* Yesterday's Briefings */}
          <div id="briefings-delivery" className="scroll-mt-6 bg-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-semibold text-white">Briefings Delivery</h2>
              <span className="text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded">
                {data.emailOperations.date ? new Date(data.emailOperations.date + 'T00:00:00').toLocaleDateString() : 'Yesterday'}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Sent (Total)</span>
                <span className="text-green-400 font-mono">{data.emailOperations.briefings.sent}</span>
              </div>
              {/* Breakdown by type */}
              {data.emailOperations.briefings.byType && (
                <div className="pl-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">↳ Daily Brief</span>
                    <span className="text-gray-400 font-mono">{data.emailOperations.briefings.byType.daily || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">↳ Weekly Deep Dive</span>
                    <span className="text-gray-400 font-mono">{data.emailOperations.briefings.byType.weekly || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">↳ Pursuit Brief</span>
                    <span className="text-gray-400 font-mono">{data.emailOperations.briefings.byType.pursuit || 0}</span>
                  </div>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Failed</span>
                <span className="text-red-400 font-mono">{data.emailOperations.briefings.failed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Pending</span>
                <span className="text-blue-400 font-mono">{data.emailOperations.briefings.pending}</span>
              </div>
              <div className="pt-2 border-t border-gray-700 flex justify-between">
                <span className="text-gray-400">Success Rate</span>
                <span className="text-white font-semibold">{data.emailOperations.briefings.successRate}</span>
              </div>
              <p className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                Tomorrow&apos;s send is governed by Briefings Cron Eligible in User Health.
              </p>
            </div>
          </div>

          {/* User Health */}
          <div id="user-health" className="scroll-mt-6 bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">User Health</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Users</span>
                <span className="text-white font-mono">{data.userHealth.totalUsers}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">NAICS Configured</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{ width: data.userHealth.naicsPercent }}
                    />
                  </div>
                  <span className="text-white font-mono text-sm">{data.userHealth.naicsPercent}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Business Type Set</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yellow-500"
                      style={{ width: data.userHealth.businessTypePercent }}
                    />
                  </div>
                  <span className="text-white font-mono text-sm">{data.userHealth.businessTypePercent}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Daily Alerts Enabled</span>
                <span className="text-white font-mono">{data.userHealth.alertsEnabledTotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Alert Frequency: Daily</span>
                <span className="text-white font-mono">{data.userHealth.dailyFrequencyConfigured}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Alert Frequency: Weekly</span>
                <span className="text-white font-mono">{data.userHealth.weeklyFrequencyConfigured}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Briefings Entitled</span>
                <span className="text-white font-mono">{data.userHealth.briefingsEntitled}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Briefings Cron Eligible</span>
                <span className="text-white font-mono">{data.userHealth.briefingsCronEligible}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Briefings Flag Enabled</span>
                <span className="text-white font-mono">{data.userHealth.briefingsEnabled}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Briefings Profile Incomplete</span>
                <span className="text-orange-300 font-mono">{data.userHealth.briefingsProfileIncomplete}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Expired Briefings</span>
                <span className="text-white font-mono">{data.userHealth.briefingsExpired}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Internal/Comp Excluded</span>
                <span className="text-white font-mono">{data.userHealth.internalExcluded}</span>
              </div>
              <p className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                Briefings Cron Eligible is entitlement-gated and excludes internal, free, and expired users.
                Actual sends also depend on fresh matches and daily deduplication.
              </p>
            </div>
          </div>

          {/* Weekly Alert Fallback */}
          <div id="weekly-alert-fallback" className="scroll-mt-6 bg-gray-800 rounded-lg p-6">
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Weekly Alert Fallback</h2>
                <p className="mt-1 text-xs text-gray-500">
                  Processes free fallback and user-selected weekly alerts for the active weekly cycle.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded">
                  {data.weeklyAlerts.cycleDate}
                </span>
                {data.weeklyAlerts.remaining > 0 && (
                  <button
                    onClick={() => {
                      const confirmed = window.confirm(
                        'Process the next weekly fallback batch now? This can send real weekly alert emails.'
                      );
                      if (confirmed) {
                        handleAction('process-weekly-fallback');
                      }
                    }}
                    className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-xs font-semibold text-white rounded transition-colors"
                  >
                    Process Next Batch
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-900/60 p-4">
                <div className="flex justify-between">
                  <span className="text-gray-400">Current Queue</span>
                  <span className={data.weeklyAlerts.remaining > 0 ? 'text-yellow-400 font-mono' : 'text-green-400 font-mono'}>
                    {data.weeklyAlerts.remaining === 0 ? 'Clear' : `${data.weeklyAlerts.remaining} remaining`}
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  This is the blocker count. Sent, failed, and skipped below are delivery-history counts for this weekly cycle.
                </p>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Eligible This Cycle</span>
                <span className="text-white font-mono">{data.weeklyAlerts.eligibleTotal}</span>
              </div>
              <div className="pl-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">With NAICS</span>
                  <span className="text-gray-400 font-mono">{data.weeklyAlerts.eligibleWithNaics}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Fallback users</span>
                  <span className="text-gray-400 font-mono">{data.weeklyAlerts.freeFallbackUsers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">User-selected weekly</span>
                  <span className="text-gray-400 font-mono">{data.weeklyAlerts.explicitWeeklyUsers}</span>
                </div>
              </div>
              <div className="pt-2 border-t border-gray-700 flex justify-between">
                <span className="text-gray-400">Delivery History: Sent</span>
                <span className="text-green-400 font-mono">{data.weeklyAlerts.sent}</span>
              </div>
              <div className="pl-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Processed fallback</span>
                  <span className="text-gray-400 font-mono">{data.weeklyAlerts.processedFreeFallback}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Processed selected</span>
                  <span className="text-gray-400 font-mono">{data.weeklyAlerts.processedExplicitWeekly}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Delivery History: Failed</span>
                <span className="text-red-400 font-mono">{data.weeklyAlerts.failed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Delivery History: Skipped</span>
                <span className="text-yellow-400 font-mono">{data.weeklyAlerts.skipped}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Queue Remaining</span>
                <span className={data.weeklyAlerts.remaining > 0 ? 'text-yellow-400 font-mono' : 'text-green-400 font-mono'}>
                  {data.weeklyAlerts.remaining}
                </span>
              </div>
              <div className="pt-2 border-t border-gray-700 flex justify-between">
                <span className="text-gray-400">Historical Send Rate</span>
                <span className="text-white font-semibold">{data.weeklyAlerts.successRate}</span>
              </div>
              <p className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                Last sent: {data.weeklyAlerts.lastSentAt ? new Date(data.weeklyAlerts.lastSentAt).toLocaleString() : 'None yet'}.
                Next run: {new Date(data.weeklyAlerts.nextScheduledAtUtc).toLocaleString()}.
                {data.weeklyAlerts.remaining > 0
                  ? ' Use Process Next Batch to clear up to one cron batch now.'
                  : ' This cycle is fully processed.'}
              </p>
            </div>
          </div>
        </div>

        {/* Second Row - 7-Day Trends */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* 7-Day Alert Trend */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">7-Day Alert Trend ($19/mo)</h2>
            {data.trends.alerts.length > 0 ? (
              <div className="space-y-2">
                {data.trends.alerts.map((day) => (
                  <div key={day.date} className="flex items-center gap-4">
                    <span className="text-gray-400 w-24 text-sm">{day.date}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <div
                        className="h-4 bg-green-600 rounded"
                        style={{ width: `${Math.max(day.sent / 10, 2)}%` }}
                        title={`Sent: ${day.sent}`}
                      />
                      {day.failed > 0 && (
                        <div
                          className="h-4 bg-red-600 rounded"
                          style={{ width: `${Math.max(day.failed / 10, 2)}%` }}
                          title={`Failed: ${day.failed}`}
                        />
                      )}
                    </div>
                    <span className="text-white font-mono text-sm w-12 text-right">{day.sent}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No alert data for this period</p>
            )}
          </div>

          {/* 7-Day Briefing Trend */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">7-Day Briefing Trend ($49/mo)</h2>
            {data.trends.briefings.length > 0 ? (
              <div className="space-y-2">
                {data.trends.briefings.map((day) => (
                  <div key={day.date} className="flex items-center gap-4">
                    <span className="text-gray-400 w-24 text-sm">{day.date}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <div
                        className="h-4 bg-purple-600 rounded"
                        style={{ width: `${Math.max(day.sent / 10, 2)}%` }}
                        title={`Sent: ${day.sent}`}
                      />
                      {day.failed > 0 && (
                        <div
                          className="h-4 bg-red-600 rounded"
                          style={{ width: `${Math.max(day.failed / 10, 2)}%` }}
                          title={`Failed: ${day.failed}`}
                        />
                      )}
                    </div>
                    <span className="text-white font-mono text-sm w-12 text-right">{day.sent}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No briefing data for this period</p>
            )}
          </div>
        </div>

        {/* Third Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Dead Letter Queue */}
          <div id="dead-letter-queue" className="scroll-mt-6 bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Dead Letter Queue</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Pending Retries</span>
                <span className={`font-mono ${data.deadLetter.pending > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {data.deadLetter.pending}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Exhausted (gave up)</span>
                <span className="text-red-400 font-mono">{data.deadLetter.exhausted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Resolved</span>
                <span className="text-green-400 font-mono">{data.deadLetter.resolved}</span>
              </div>
              {data.deadLetter.oldestPending && (
                <div className="pt-2 border-t border-gray-700">
                  <span className="text-gray-400 text-sm">
                    Oldest pending: {new Date(data.deadLetter.oldestPending).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Data Health */}
        <div id="data-health" className="scroll-mt-6 bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Data Health</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-gray-400 text-sm">Total Forecasts</p>
              <p className="text-2xl font-bold text-white">{data.dataHealth.totalForecasts.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">SAM Cache</p>
              <p className="text-2xl font-bold text-white">{data.dataHealth.samCacheCount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Forecast Agencies</p>
              <p className="text-2xl font-bold text-white">{Object.keys(data.dataHealth.byAgency).length}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">SAM Last Update</p>
              <p className="text-sm text-white">
                {data.dataHealth.samCacheLastUpdate
                  ? new Date(data.dataHealth.samCacheLastUpdate).toLocaleDateString()
                  : 'N/A'}
              </p>
            </div>
          </div>
          {Object.keys(data.dataHealth.byAgency).length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-gray-400 text-sm mb-2">Forecasts by Agency</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.dataHealth.byAgency)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 10)
                  .map(([agency, count]) => (
                    <span key={agency} className="px-2 py-1 bg-gray-700 rounded text-sm text-white">
                      {agency}: {count}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div id="quick-actions" className="scroll-mt-6 bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div id="profile-reminder-agent" className="scroll-mt-6 mb-5 rounded-lg border border-orange-500/30 bg-orange-950/20 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-white font-semibold">Profile Completion Reminder Agent</h3>
                <p className="text-sm text-gray-400 mt-1">
                  {data.userHealth.briefingsProfileIncomplete} profiles are still incomplete. This count only drops after users finish setup.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-400">
                  Limit
                  <input
                    type="number"
                    min={1}
                    max={250}
                    value={profileReminderLimit}
                    onChange={(e) => setProfileReminderLimit(Number(e.target.value))}
                    className="ml-2 w-20 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-purple-500 focus:outline-none"
                  />
                </label>
                <button
                  onClick={() => handleAction('preview-profile-reminders', { limit: profileReminderLimit })}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
                >
                  Preview
                </button>
                <button
                  onClick={() => {
                    const confirmed = window.confirm(`Send profile reminder emails to up to ${profileReminderLimit} users?`);
                    if (confirmed) {
                      handleAction('send-profile-reminders', { limit: profileReminderLimit, batchSize: 10 });
                    }
                  }}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors"
                >
                  Send Approved Batch
                </button>
              </div>
            </div>
            {!profileReminderRun && (
              <p className="mt-4 text-sm text-gray-400">
                Click Preview to load the next unsent batch. This card now hides the general backlog sample so it does not look like the active send list.
              </p>
            )}
            {profileReminderRun && (
              <div className="mt-4 rounded-lg border border-slate-600 bg-slate-950/60 p-4">
                <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Last Profile Reminder {profileReminderRun.mode === 'preview' ? 'Preview' : 'Send'}
                    </p>
                    <p className="text-xs text-gray-400">
                      Completed {new Date(profileReminderRun.completedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">
                      Incomplete profiles: {profileReminderRun.summary.usersWithEmptyProfiles}
                    </span>
                    {typeof profileReminderRun.summary.skippedRecentlyReminded === 'number' && (
                      <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">
                        Recently reminded: {profileReminderRun.summary.skippedRecentlyReminded}
                      </span>
                    )}
                    {typeof profileReminderRun.summary.eligibleToSend === 'number' && (
                      <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">
                        Eligible this cycle: {profileReminderRun.summary.eligibleToSend}
                      </span>
                    )}
                    {typeof profileReminderRun.summary.cursorSkipped === 'number' && profileReminderRun.summary.cursorSkipped > 0 && (
                      <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">
                        Already passed this cycle: {profileReminderRun.summary.cursorSkipped}
                      </span>
                    )}
                    {typeof profileReminderRun.summary.remaining === 'number' && (
                      <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">
                        Remaining after batch: {profileReminderRun.summary.remaining}
                      </span>
                    )}
                  </div>
                </div>

                {profileReminderRun.mode === 'preview' ? (
                  <div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Next Batch</p>
                        <p className="text-2xl font-bold text-blue-300">
                          {profileReminderRun.summary.wouldSendNow?.length || 0}
                        </p>
                      </div>
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Limit</p>
                        <p className="text-2xl font-bold text-white">
                          {profileReminderRun.summary.sendLimit || profileReminderLimit}
                        </p>
                      </div>
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Total Briefing Users</p>
                        <p className="text-2xl font-bold text-white">
                          {profileReminderRun.summary.totalBriefingsUsers}
                        </p>
                      </div>
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Remaining After Previewed Batch</p>
                        <p className="text-2xl font-bold text-orange-300">
                          {profileReminderRun.summary.remainingAfterSend ?? Math.max(
                            (profileReminderRun.summary.eligibleToSend ?? profileReminderRun.summary.usersWithEmptyProfiles) -
                            (profileReminderRun.summary.wouldSendNow?.length || 0),
                            0
                          )}
                        </p>
                      </div>
                    </div>
                    {typeof profileReminderRun.summary.skippedRecentlyReminded === 'number' && profileReminderRun.summary.skippedRecentlyReminded > 0 && (
                      <p className="mb-3 text-sm text-gray-400">
                        Skipping {profileReminderRun.summary.skippedRecentlyReminded} users already reminded in the last {profileReminderRun.summary.reminderCooldownDays || 14} days.
                      </p>
                    )}
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Preview batch
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(profileReminderRun.summary.wouldSendNow || []).slice(0, 25).map((user) => {
                        const email = getPreviewEmail(user);
                        return (
                        <span key={email} className="rounded bg-blue-950/70 px-2 py-1 text-xs text-blue-100">
                          {email}
                        </span>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Processed</p>
                        <p className="text-2xl font-bold text-white">
                          {profileReminderRun.summary.processed || 0}
                        </p>
                      </div>
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Sent</p>
                        <p className="text-2xl font-bold text-green-400">
                          {profileReminderRun.summary.sent || 0}
                        </p>
                      </div>
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Failed</p>
                        <p className={(profileReminderRun.summary.failed || 0) > 0 ? 'text-2xl font-bold text-red-400' : 'text-2xl font-bold text-green-400'}>
                          {profileReminderRun.summary.failed || 0}
                        </p>
                      </div>
                      <div className="rounded bg-gray-900 p-3">
                        <p className="text-xs text-gray-500">Remaining After Batch</p>
                        <p className="text-2xl font-bold text-orange-300">
                          {profileReminderRun.summary.remaining || 0}
                        </p>
                      </div>
                    </div>
                    {profileReminderMath && (
                      <p className={`mb-3 text-sm ${profileReminderMathAddsUp ? 'text-gray-400' : 'text-yellow-200'}`}>
                        {profileReminderMathAddsUp
                          ? `Math check: ${profileReminderMath.total} empty profiles = ${profileReminderMath.recentlyReminded} recently reminded + ${profileReminderMath.alreadyPassed} already passed this cycle + ${profileReminderMath.processed} processed now + ${profileReminderMath.remaining} remaining.`
                          : 'This saved run used older reminder math. The next preview or send will show the corrected breakdown.'}
                      </p>
                    )}
                    <p className="mb-3 text-sm text-gray-500">
                      Reminder sends move users through this queue. The incomplete profile count only changes when users click through and finish their setup.
                    </p>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Latest processed
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(profileReminderRun.results || []).slice(0, 12).map((result) => (
                        <span
                          key={result.email}
                          className={`rounded px-2 py-1 text-xs ${
                            result.status === 'sent'
                              ? 'bg-green-950/70 text-green-100'
                              : result.status === 'failed'
                                ? 'bg-red-950/70 text-red-100'
                                : 'bg-gray-900 text-gray-300'
                          }`}
                          title={result.error || result.status}
                        >
                          {result.email}: {result.status}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-4 items-center mb-4">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Test email"
              className="px-4 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <button
              onClick={() => handleAction('send-test-alert')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Send Test Alert
            </button>
            <button
              onClick={() => handleAction('send-test-briefing')}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
            >
              Send Test Briefing
            </button>
            <button
              onClick={() => handleAction('process-dead-letter')}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors"
            >
              Process Dead Letter Queue
            </button>
            <button
              onClick={() => handleAction('send-naics-reminder')}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors"
            >
              Send NAICS Reminders
            </button>
          </div>
          {actionResult && (
            <pre className="mt-4 p-4 bg-gray-900 rounded text-sm text-gray-300 overflow-x-auto">
              {actionResult}
            </pre>
          )}
        </div>

        {/* Revenue & Products */}
        {data.revenue.available && data.revenue.thirtyDay && (
          <div className="mt-6 bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Revenue & Products (30 Days)</h2>
            <p className="mb-5 text-sm text-gray-400">
              Stripe revenue by product. AI Tools/mo is a separate product line and does not automatically mean GovCon tool access.
            </p>

            {/* Revenue Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <p className="text-gray-400 text-sm">30-Day Revenue</p>
                <p className="text-2xl font-bold text-green-400">
                  ${data.revenue.thirtyDay.total.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">7-Day Revenue</p>
                <p className="text-2xl font-bold text-green-400">
                  ${data.revenue.sevenDay?.total.toLocaleString() || 0}
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Purchases (30d)</p>
                <p className="text-2xl font-bold text-white">{data.revenue.thirtyDay.count}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Avg Order</p>
                <p className="text-2xl font-bold text-white">
                  ${data.revenue.thirtyDay.avgOrder.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Products Breakdown */}
            {Object.keys(data.revenue.thirtyDay.byProduct).length > 0 && (
              <div className="mb-6 pt-4 border-t border-gray-700">
                <p className="text-gray-400 text-sm mb-3">What They Purchased</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(data.revenue.thirtyDay.byProduct)
                    .sort(([, a], [, b]) => b.revenue - a.revenue)
                    .map(([product, stats]) => (
                      <div key={product} className="bg-gray-700 rounded-lg p-3">
                        <p className="text-white font-medium truncate" title={product}>{product}</p>
                        <div className="flex justify-between mt-1">
                          <span className="text-gray-400 text-sm">{stats.count} sales</span>
                          <span className="text-green-400 font-mono">${stats.revenue.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Recent Purchases */}
            {data.revenue.recentPurchases && data.revenue.recentPurchases.length > 0 && (
              <div className="pt-4 border-t border-gray-700">
                <p className="text-gray-400 text-sm mb-3">Recent Purchases</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-left">
                        <th className="pb-2">Email</th>
                        <th className="pb-2">Product</th>
                        <th className="pb-2">Bundle</th>
                        <th className="pb-2">Details</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.revenue.recentPurchases.map((p, i) => (
                        <tr key={i} className="border-t border-gray-700">
                          <td className="py-2 text-white truncate max-w-[150px]" title={p.email}>
                            {p.email}
                          </td>
                          <td className="py-2 text-gray-300 truncate max-w-[150px]" title={p.product}>
                            {p.product}
                          </td>
                          <td className="py-2 text-gray-400">
                            {p.bundle || '-'}
                          </td>
                          <td className="py-2 text-gray-400 truncate max-w-[180px]" title={p.details}>
                            {p.details || '-'}
                          </td>
                          <td className="py-2 text-green-400 text-right font-mono">
                            ${p.amount.toLocaleString()}
                          </td>
                          <td className="py-2 text-gray-400 text-right">
                            {new Date(p.date).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* General Unconfigured Users */}
        {data.userHealth.unconfiguredEmails.length > 0 && (
          <details className="mt-6 bg-gray-800 rounded-lg p-6">
            <summary className="cursor-pointer text-lg font-semibold text-white">
              General Unconfigured Users ({data.userHealth.totalUsers - data.userHealth.naicsConfigured} total)
            </summary>
            <p className="mt-3 text-sm text-gray-400">
              Broad alert-profile sample. This is separate from the Profile Completion Reminder Agent batch above.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {data.userHealth.unconfiguredEmails.map((email) => (
                <span key={email} className="px-2 py-1 bg-gray-700 rounded text-sm text-gray-300">
                  {email}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
