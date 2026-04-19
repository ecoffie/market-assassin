'use client';

import { useState, useEffect } from 'react';

interface ProviderStatus {
  status: string;
  last_check: string | null;
  last_error: string | null;
  latency_ms: number | null;
  rate_limit_remaining: number | null;
}

interface ToolStats {
  requests_total: number;
  requests_success: number;
  requests_failed: number;
  tokens_used: number;
  success_rate: number;
  errors_by_type: Record<string, number>;
}

interface RecentError {
  id: string;
  tool: string;
  type: string;
  message: string;
  user: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  created_at: string;
  is_resolved: boolean;
}

interface DashboardData {
  success: boolean;
  period: string;
  health: 'healthy' | 'warning' | 'critical';
  alerts: string[];
  tools: Record<string, ToolStats>;
  providers: Record<string, ProviderStatus>;
  recentErrors: RecentError[];
  dailyMetrics: unknown[];
}

const ADMIN_PASSWORD = 'galata-assassin-2026';

export default function ToolHealthDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingProviders, setCheckingProviders] = useState(false);

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/admin/tool-health?password=${ADMIN_PASSWORD}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || 'Failed to fetch data');
      }
    } catch (err) {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  };

  const checkProviders = async () => {
    setCheckingProviders(true);
    try {
      await fetch(`/api/admin/tool-health?password=${ADMIN_PASSWORD}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_providers' }),
      });
      await fetchData();
    } catch (err) {
      console.error('Failed to check providers:', err);
    } finally {
      setCheckingProviders(false);
    }
  };

  const resolveError = async (errorId: string) => {
    try {
      await fetch(`/api/admin/tool-health?password=${ADMIN_PASSWORD}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', errorId }),
      });
      await fetchData();
    } catch (err) {
      console.error('Failed to resolve error:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-xl">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-red-400 text-xl">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const healthColors = {
    healthy: 'bg-green-500',
    warning: 'bg-yellow-500',
    critical: 'bg-red-500',
  };

  const statusColors: Record<string, string> = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
    unknown: 'bg-gray-500',
  };

  const providerNames: Record<string, string> = {
    groq: 'Groq (AI)',
    openai: 'OpenAI',
    sam_gov: 'SAM.gov',
    usaspending: 'USASpending',
    grants_gov: 'Grants.gov',
  };

  const toolNames: Record<string, string> = {
    content_reaper: 'Content Reaper',
    code_suggestions: 'AI Code Suggestions',
    briefings: 'Daily Briefings',
    market_scanner: 'Market Scanner',
    sample_opportunities: 'Sample Opportunities',
    opportunity_hunter: 'Opportunity Hunter',
    reports: 'Market Reports',
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">AI Tool Health Dashboard</h1>
            <p className="text-gray-400 mt-1">{data.period} • Auto-refreshes every 30s</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={checkProviders}
              disabled={checkingProviders}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {checkingProviders ? 'Checking...' : 'Check Providers'}
            </button>
            <div className={`px-4 py-2 rounded-lg font-bold ${healthColors[data.health]}`}>
              {data.health.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Alerts */}
        {data.alerts.length > 0 && (
          <div className="mb-8 p-4 bg-red-900/50 border border-red-500 rounded-lg">
            <h2 className="text-lg font-bold text-red-400 mb-2">⚠️ Alerts</h2>
            <ul className="space-y-1">
              {data.alerts.map((alert, i) => (
                <li key={i} className="text-red-300">• {alert}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Provider Status */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4">API Providers</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(data.providers).map(([key, provider]) => (
              <div key={key} className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${statusColors[provider.status]}`} />
                  <span className="font-medium">{providerNames[key] || key}</span>
                </div>
                <div className="text-sm text-gray-400">
                  Status: <span className="text-white">{provider.status}</span>
                </div>
                {provider.latency_ms && (
                  <div className="text-sm text-gray-400">
                    Latency: <span className="text-white">{provider.latency_ms}ms</span>
                  </div>
                )}
                {provider.last_error && (
                  <div className="text-sm text-red-400 mt-1 truncate" title={provider.last_error}>
                    {provider.last_error}
                  </div>
                )}
                {provider.last_check && (
                  <div className="text-xs text-gray-500 mt-2">
                    Checked: {new Date(provider.last_check).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tool Stats */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4">Tool Performance</h2>
          {Object.keys(data.tools).length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
              <p className="text-lg">No tool usage tracked yet</p>
              <p className="text-sm mt-2">Data will appear as users interact with AI-powered tools</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(data.tools).map(([key, tool]) => (
                <div key={key} className="bg-gray-800 rounded-lg p-4">
                  <h3 className="font-bold text-lg mb-3">{toolNames[key] || key}</h3>
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <div className="text-2xl font-bold text-green-400">{tool.success_rate}%</div>
                      <div className="text-xs text-gray-400">Success Rate</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{tool.requests_total}</div>
                      <div className="text-xs text-gray-400">Total Requests</div>
                    </div>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <div>
                      <span className="text-green-400">{tool.requests_success}</span>
                      <span className="text-gray-400"> success</span>
                    </div>
                    <div>
                      <span className="text-red-400">{tool.requests_failed}</span>
                      <span className="text-gray-400"> failed</span>
                    </div>
                  </div>
                  {tool.tokens_used > 0 && (
                    <div className="text-sm text-gray-400 mt-2">
                      Tokens: {tool.tokens_used.toLocaleString()}
                    </div>
                  )}
                  {Object.keys(tool.errors_by_type).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-700">
                      <div className="text-xs text-gray-400 mb-1">Error Breakdown:</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(tool.errors_by_type).map(([type, count]) => (
                          <span key={type} className="text-xs bg-red-900/50 px-2 py-1 rounded">
                            {type}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Errors */}
        <div>
          <h2 className="text-xl font-bold mb-4">
            Recent Errors
            {data.recentErrors.length > 0 && (
              <span className="ml-2 text-sm font-normal text-red-400">
                ({data.recentErrors.length} unresolved)
              </span>
            )}
          </h2>
          {data.recentErrors.length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
              <p className="text-lg">No unresolved errors</p>
              <p className="text-sm mt-2">All systems operating normally</p>
            </div>
          ) : (
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm">Tool</th>
                    <th className="px-4 py-3 text-left text-sm">Type</th>
                    <th className="px-4 py-3 text-left text-sm">Message</th>
                    <th className="px-4 py-3 text-left text-sm">User</th>
                    <th className="px-4 py-3 text-left text-sm">Time</th>
                    <th className="px-4 py-3 text-left text-sm">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {data.recentErrors.map((err) => (
                    <tr key={err.id} className="hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm font-medium">
                        {toolNames[err.tool] || err.tool}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-red-900/50 px-2 py-1 rounded">
                          {err.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300 max-w-md truncate" title={err.message}>
                        {err.message}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {err.user || 'System'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {new Date(err.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => resolveError(err.id)}
                          className="text-xs bg-green-600 hover:bg-green-700 px-2 py-1 rounded"
                        >
                          Resolve
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          AI Tool Health Dashboard • GovCon Giants
        </div>
      </div>
    </div>
  );
}
