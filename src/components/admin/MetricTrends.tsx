'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

type Point = Record<string, number | string> & { date: string };

const TABS: Array<{ days: number; label: string }> = [
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: 12,
  color: '#e2e8f0',
};

/** Trim YYYY-MM-DD → MM/DD for the axis. */
function shortDate(d: string): string {
  const p = (d || '').split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}` : d;
}

export default function MetricTrends({ password }: { password: string }) {
  const [series, setSeries] = useState<Point[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/metric-trends?password=${encodeURIComponent(password)}&days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d.success) { setError(d.error || 'Failed to load trends'); return; }
        setSeries((d.series || []).map((p: Point) => ({ ...p, date: shortDate(p.date) })));
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [password, days]);

  return (
    <div className="bg-gray-800 rounded-lg p-6 mb-8">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Trends</h2>
          <p className="text-sm text-gray-400">Daily snapshots — engagement, growth, and the matching-quality trend over time.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-900 p-1">
          {TABS.map((t) => (
            <button
              key={t.days}
              onClick={() => setDays(t.days)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                days === t.days ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
      {loading && series.length === 0 && <p className="text-sm text-gray-400">Loading trends…</p>}
      {!loading && series.length === 0 && !error && (
        <p className="text-sm text-gray-400">No snapshots yet — the daily cron will populate this.</p>
      )}

      {series.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* DAU / WAU engagement */}
          <div className="bg-gray-900/50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Active Users (DAU / WAU)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="wau" name="WAU" stroke="#a78bfa" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="dau" name="DAU" stroke="#34d399" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* New signups */}
          <div className="bg-gray-900/50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">New Signups / Day</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="new_signups" name="Signups" fill="#60a5fa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Alerts sent */}
          <div className="bg-gray-900/50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Alerts Sent / Day</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="alerts_sent" name="Alerts sent" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Matching quality — zero-alert users trend (lower is better) */}
          <div className="bg-gray-900/50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Users Getting Zero Alerts (7d) — lower is better</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="zero_alert_users_7d" name="Zero-alert users" stroke="#f87171" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
