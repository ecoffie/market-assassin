'use client';

import { useState, useEffect, useCallback } from 'react';

interface EmailRecord {
  id: string;
  type: 'alert' | 'briefing';
  email: string;
  date: string;
  sentAt: string;
  status: string;
  details?: string;
}

interface EmailHistoryData {
  emails: EmailRecord[];
  stats: {
    totalAlerts: number;
    totalBriefings: number;
    last7Days: number;
    failedLast7Days: number;
  };
}

const adminTabs = [
  { href: '/admin/dashboard', label: 'Operations', icon: '📊' },
  { href: '/admin', label: 'Access Control', icon: '🔐' },
  { href: '/admin/purchases', label: 'Purchases', icon: '💳' },
  { href: '/admin/emails', label: 'Email History', icon: '📧' },
  { href: '/admin/feedback', label: 'Feedback', icon: '💬' },
];

export default function AdminEmailsPage() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<EmailHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchEmail, setSearchEmail] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'alert' | 'briefing'>('all');

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ password });
      if (searchEmail) params.append('email', searchEmail);
      if (filterType !== 'all') params.append('type', filterType);

      const res = await fetch(`/api/admin/email-history?${params}`);
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
  }, [password, searchEmail, filterType]);

  useEffect(() => {
    if (authenticated) {
      fetchEmails();
    }
  }, [authenticated, filterType]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEmails();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEmails();
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-white mb-6">Email History</h1>
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

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Navigation Tabs */}
        <div className="bg-gray-800 rounded-lg mb-6">
          <div className="flex items-center gap-1 p-2">
            <span className="text-gray-500 text-sm mr-4">Admin:</span>
            {adminTabs.map((tab) => {
              const isActive = tab.href === '/admin/emails';
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
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">Email History</h1>
            <p className="text-gray-400">View all sent alerts and briefings</p>
          </div>
          <button
            onClick={fetchEmails}
            disabled={loading}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Stats */}
        {data?.stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Total Alerts Sent</p>
              <p className="text-2xl font-bold text-white">{data.stats.totalAlerts.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Total Briefings Sent</p>
              <p className="text-2xl font-bold text-white">{data.stats.totalBriefings.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Last 7 Days</p>
              <p className="text-2xl font-bold text-green-400">{data.stats.last7Days.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Failed (7 Days)</p>
              <p className="text-2xl font-bold text-red-400">{data.stats.failedLast7Days}</p>
            </div>
          </div>
        )}

        {/* Search & Filter */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-center">
            <input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="Search by email..."
              className="flex-1 min-w-[200px] px-4 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'alert' | 'briefing')}
              className="px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
            >
              <option value="all">All Types</option>
              <option value="alert">Alerts Only</option>
              <option value="briefing">Briefings Only</option>
            </select>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Search
            </button>
          </form>
        </div>

        {/* Email Table */}
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Email</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Date</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Sent At</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {data?.emails.map((email) => (
                  <tr key={email.id} className="hover:bg-gray-750">
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          email.type === 'alert'
                            ? 'bg-blue-900 text-blue-300'
                            : 'bg-purple-900 text-purple-300'
                        }`}
                      >
                        {email.type === 'alert' ? '🔔 Alert' : '📋 Briefing'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white truncate max-w-[200px]" title={email.email}>
                      {email.email}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{email.date}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(email.sentAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          email.status === 'sent'
                            ? 'bg-green-900 text-green-300'
                            : email.status === 'failed'
                            ? 'bg-red-900 text-red-300'
                            : 'bg-yellow-900 text-yellow-300'
                        }`}
                      >
                        {email.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-sm truncate max-w-[150px]" title={email.details}>
                      {email.details || '-'}
                    </td>
                  </tr>
                ))}
                {(!data?.emails || data.emails.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No emails found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
