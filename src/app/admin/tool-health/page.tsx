'use client';

import { useState, useEffect, useCallback } from 'react';

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

interface DatabaseStat {
  count: number;
  description: string;
}

interface KeyRotation {
  totalKeys: number;
  currentKeyIndex: number;
  dayOfYear: number;
  nextRotation: string;
}

interface MultisiteSource {
  source: string;
  status: string;
  lastScrape: string | null;
  count: number;
}

interface MultisiteHealth {
  sources: MultisiteSource[];
  summary: { healthy: number; warning: number; failed: number };
}

interface JsonDatabaseStat {
  count: number;
  description: string;
}

interface DashboardData {
  success: boolean;
  period: string;
  health: 'healthy' | 'warning' | 'critical';
  alerts: string[];
  tools: Record<string, ToolStats>;
  providers: Record<string, ProviderStatus>;
  databaseStats: Record<string, DatabaseStat>;
  jsonDatabaseStats?: Record<string, JsonDatabaseStat>;
  multisiteHealth?: MultisiteHealth;
  keyRotation: KeyRotation;
  recentErrors: RecentError[];
  dailyMetrics: unknown[];
}

export default function ToolHealthDashboard() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingProviders, setCheckingProviders] = useState(false);

  const fetchData = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tool-health?password=${encodeURIComponent(password)}`);
      if (res.status === 401) {
        setAuthenticated(false);
        setError('Invalid password');
        return;
      }
      const json = await res.json();
      if (json.success) {
        setData(json);
        setError(null);
        setAuthenticated(true);
      } else {
        setError(json.error || 'Failed to fetch data');
      }
    } catch (err) {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, [password]);

  const checkProviders = async () => {
    setCheckingProviders(true);
    try {
      await fetch(`/api/admin/tool-health?password=${encodeURIComponent(password)}`, {
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
      await fetch(`/api/admin/tool-health?password=${encodeURIComponent(password)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', errorId }),
      });
      await fetchData();
    } catch (err) {
      console.error('Failed to resolve error:', err);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData();
  };

  useEffect(() => {
    // Auto-refresh every 30 seconds if authenticated
    if (authenticated && password) {
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
  }, [authenticated, password, fetchData]);

  // Login form if not authenticated
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-white mb-6">Tool Health Dashboard</h1>
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

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-xl">Loading dashboard...</div>
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
    not_configured: 'bg-blue-500',
  };

  const providerNames: Record<string, string> = {
    groq: 'Groq (AI)',
    sam_gov: 'SAM.gov',
    usaspending: 'USASpending',
    grants_gov: 'Grants.gov',
  };

  // Filter out OpenAI from display (it's only a fallback, not monitored)
  const filteredProviders = Object.entries(data.providers).filter(([key]) => key !== 'openai');

  // Filter out OpenAI-related alerts
  const filteredAlerts = data.alerts.filter(alert => !alert.toLowerCase().includes('openai'));

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
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header matching MI dashboard */}
      <header className="bg-gradient-to-r from-gray-900 via-gray-900 to-gray-800 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-purple-800 rounded-lg flex items-center justify-center">
                <span className="text-lg font-bold">TH</span>
              </div>
              <div>
                <h1 className="text-xl font-semibold">Tool Health</h1>
                <p className="text-xs text-gray-400">GovCon Giants</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={checkProviders}
                disabled={checkingProviders}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg disabled:opacity-50 transition-colors"
              >
                {checkingProviders ? 'Checking...' : 'Check Providers'}
              </button>
              <div className={`px-4 py-2 rounded-lg font-bold ${healthColors[data.health]}`}>
                {data.health.toUpperCase()}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        {/* Period info */}
        <p className="text-gray-400 text-sm mb-6">{data.period} • Auto-refreshes every 30s</p>

        {/* Alerts */}
        {filteredAlerts.length > 0 && (
          <div className="mb-8 p-4 bg-red-900/50 border border-red-500 rounded-lg">
            <h2 className="text-lg font-bold text-red-400 mb-2">⚠️ Alerts</h2>
            <ul className="space-y-1">
              {filteredAlerts.map((alert, i) => (
                <li key={i} className="text-red-300">• {alert}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Provider Status */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4 text-gray-200">API Providers</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {filteredProviders.map(([key, provider]) => (
              <div key={key} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-purple-500/30 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${statusColors[provider.status]}`} />
                  <span className="font-medium text-white">{providerNames[key] || key}</span>
                </div>
                <div className="text-sm text-gray-400">
                  Status: <span className={provider.status === 'healthy' ? 'text-green-400' : provider.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'}>{provider.status}</span>
                </div>
                {provider.latency_ms && (
                  <div className="text-sm text-gray-400">
                    Latency: <span className="text-purple-400">{provider.latency_ms}ms</span>
                  </div>
                )}
                {provider.last_error && (
                  <div className="text-sm text-red-400 mt-2 truncate" title={provider.last_error}>
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

        {/* Database Stats */}
        {data.databaseStats && Object.keys(data.databaseStats).length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold mb-4">Data Intelligence</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Object.entries(data.databaseStats).map(([table, stats]) => (
                <div key={table} className="bg-gray-800 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-cyan-400">
                    {stats.count.toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-400 mt-1">{stats.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* JSON Databases (Static Data Assets) */}
        {data.jsonDatabaseStats && Object.keys(data.jsonDatabaseStats).length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">Static Data Assets</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {Object.entries(data.jsonDatabaseStats).map(([key, stats]) => (
                <div key={key} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center hover:border-purple-500/30 transition-colors">
                  <div className="text-2xl font-bold text-amber-400">
                    {stats.count.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{stats.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Multisite Scrapers Health */}
        {data.multisiteHealth && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">
              Multisite Scrapers
              <span className="ml-3 text-sm font-normal">
                <span className="text-green-400">{data.multisiteHealth.summary.healthy} healthy</span>
                {data.multisiteHealth.summary.warning > 0 && (
                  <span className="text-yellow-400 ml-2">{data.multisiteHealth.summary.warning} warning</span>
                )}
                {data.multisiteHealth.summary.failed > 0 && (
                  <span className="text-red-400 ml-2">{data.multisiteHealth.summary.failed} failed</span>
                )}
              </span>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {data.multisiteHealth.sources.map((source) => (
                <div
                  key={source.source}
                  className={`bg-gray-900 border rounded-xl p-4 hover:border-purple-500/30 transition-colors ${
                    source.status === 'healthy' ? 'border-green-500/30' :
                    source.status === 'warning' ? 'border-yellow-500/30' :
                    source.status === 'failed' ? 'border-red-500/30' : 'border-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${
                      source.status === 'healthy' ? 'bg-green-500' :
                      source.status === 'warning' ? 'bg-yellow-500' :
                      source.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
                    }`} />
                    <span className="font-medium text-white text-sm truncate" title={source.source}>
                      {source.source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  </div>
                  <div className="text-xl font-bold text-cyan-400">
                    {source.count.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {source.lastScrape
                      ? `Last: ${new Date(source.lastScrape).toLocaleDateString()}`
                      : 'No scrape yet'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Key Rotation Status */}
        {data.keyRotation && data.keyRotation.totalKeys > 1 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold mb-4">SAM.gov Key Rotation</h2>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-2xl font-bold text-purple-400">
                    Key {data.keyRotation.currentKeyIndex} / {data.keyRotation.totalKeys}
                  </div>
                  <div className="text-sm text-gray-400">Currently Active</div>
                </div>
                <div className="border-l border-gray-700 pl-6">
                  <div className="text-sm text-gray-400">Day of Year</div>
                  <div className="text-lg font-medium">{data.keyRotation.dayOfYear}</div>
                </div>
                <div className="border-l border-gray-700 pl-6">
                  <div className="text-sm text-gray-400">Next Rotation</div>
                  <div className="text-lg font-medium">
                    {new Date(data.keyRotation.nextRotation).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="mt-4 text-xs text-gray-500">
                Keys rotate daily at midnight to spread API load across accounts
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          AI Tool Health Dashboard • GovCon Giants
        </div>
      </div>
    </div>
  );
}
