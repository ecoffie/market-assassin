'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
    briefingsEnabled: number;
    unconfiguredEmails: string[];
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
    }>;
  };
  systemAlerts: Array<{ level: 'critical' | 'warning' | 'info'; message: string }>;
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
  const [testEmail, setTestEmail] = useState('eric@govcongiants.com');

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/dashboard?password=${password}`);
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

  const handleAction = async (action: string) => {
    setActionResult(null);
    try {
      const res = await fetch(`/api/admin/dashboard?password=${password}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email: testEmail })
      });
      const json = await res.json();
      setActionResult(`${action}: ${JSON.stringify(json, null, 2)}`);
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
            {data.systemAlerts.map((alert, i) => (
              <div
                key={i}
                className={`px-4 py-3 rounded-lg ${
                  alert.level === 'critical'
                    ? 'bg-red-900/50 border border-red-700 text-red-200'
                    : alert.level === 'warning'
                    ? 'bg-yellow-900/50 border border-yellow-700 text-yellow-200'
                    : 'bg-blue-900/50 border border-blue-700 text-blue-200'
                }`}
              >
                {alert.level === 'critical' && '  '}
                {alert.level === 'warning' && '  '}
                {alert.level === 'info' && '  '}
                {alert.message}
              </div>
            ))}
          </div>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Yesterday's Alerts (most recent completed day) */}
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-semibold text-white">Daily Alerts ($19/mo)</h2>
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
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-semibold text-white">Market Intel ($49/mo)</h2>
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
            </div>
          </div>

          {/* User Health */}
          <div className="bg-gray-800 rounded-lg p-6">
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
                <span className="text-gray-400">Alerts Enabled (Total)</span>
                <span className="text-white font-mono">{data.userHealth.alertsEnabledTotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Daily Frequency Configured</span>
                <span className="text-white font-mono">{data.userHealth.dailyFrequencyConfigured}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Weekly Frequency Configured</span>
                <span className="text-white font-mono">{data.userHealth.weeklyFrequencyConfigured}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Post-Beta Paid Daily Eligible</span>
                <span className="text-white font-mono">{data.userHealth.postBetaPaidDailyEligible}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Post-Beta Free Weekly Fallback</span>
                <span className="text-white font-mono">{data.userHealth.postBetaFreeWeeklyFallback}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Briefings Enabled</span>
                <span className="text-white font-mono">{data.userHealth.briefingsEnabled}</span>
              </div>
              <p className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                Frequency counts show user configuration. Actual daily sends depend on fresh matches,
                deduplication, and active deadlines.
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
          <div className="bg-gray-800 rounded-lg p-6">
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
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
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

        {/* Revenue & Products */}
        {data.revenue.available && data.revenue.thirtyDay && (
          <div className="bg-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Revenue & Products (30 Days)</h2>

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

        {/* Quick Actions */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
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

        {/* Unconfigured Users */}
        {data.userHealth.unconfiguredEmails.length > 0 && (
          <div className="mt-6 bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Sample Unconfigured Users ({data.userHealth.totalUsers - data.userHealth.naicsConfigured} total)
            </h2>
            <div className="flex flex-wrap gap-2">
              {data.userHealth.unconfiguredEmails.map((email) => (
                <span key={email} className="px-2 py-1 bg-gray-700 rounded text-sm text-gray-300">
                  {email}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
