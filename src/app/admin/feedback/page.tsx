'use client';

import { useState, useEffect, useCallback } from 'react';

interface ProfileIssue {
  type: string;
  message: string;
  severity: 'high' | 'medium' | 'low';
}

interface UserProfile {
  email: string;
  naicsCount: number;
  keywordsCount: number;
  agenciesCount: number;
  hasLocation: boolean;
  businessType: string | null;
  issues: ProfileIssue[];
  needsAttention: boolean;
}

interface RepeatNegativeUser {
  email: string;
  count: number;
  profile: UserProfile | null;
}

interface FeedbackRecord {
  id: string;
  user_email: string;
  briefing_date: string;
  briefing_type: 'daily' | 'weekly' | 'pursuit';
  rating: 'helpful' | 'not_helpful' | 'outreach_sent';
  comment: string | null;
  created_at: string;
}

interface FeedbackStats {
  total: number;
  helpful: number;
  notHelpful: number;
  helpfulRate: number;
  last7Days: {
    total: number;
    helpful: number;
    notHelpful: number;
  };
  byType: {
    daily: { helpful: number; notHelpful: number };
    weekly: { helpful: number; notHelpful: number };
    pursuit: { helpful: number; notHelpful: number };
  };
  repeatNegative: RepeatNegativeUser[];
  usersNeedingAttention: number;
}

interface FeedbackData {
  feedback: FeedbackRecord[];
  stats: FeedbackStats;
}

const adminTabs = [
  { href: '/admin/dashboard', label: 'Operations', icon: '📊' },
  { href: '/admin', label: 'Access Control', icon: '🔐' },
  { href: '/admin/purchases', label: 'Purchases', icon: '💳' },
  { href: '/admin/emails', label: 'Email History', icon: '📧' },
  { href: '/admin/feedback', label: 'Feedback', icon: '💬' },
];

export default function AdminFeedbackPage() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingOutreach, setSendingOutreach] = useState<string | null>(null);
  const [outreachMessage, setOutreachMessage] = useState<string | null>(null);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback?password=${password}`);
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
    if (authenticated) {
      fetchFeedback();
    }
  }, [authenticated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFeedback();
  };

  const sendOutreach = async (email: string) => {
    setSendingOutreach(email);
    setOutreachMessage(null);
    try {
      const res = await fetch(`/api/admin/feedback?password=${password}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_outreach', email }),
      });
      const json = await res.json();
      if (res.ok) {
        setOutreachMessage(`Outreach email sent to ${email}`);
        fetchFeedback(); // Refresh to show the outreach log
      } else {
        setOutreachMessage(`Error: ${json.error}`);
      }
    } catch (e) {
      setOutreachMessage(`Error: ${e}`);
    } finally {
      setSendingOutreach(null);
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-white mb-6">User Feedback</h1>
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
          <div className="flex items-center gap-1 p-2 overflow-x-auto">
            <span className="text-gray-500 text-sm mr-4">Admin:</span>
            {adminTabs.map((tab) => {
              const isActive = tab.href === '/admin/feedback';
              return (
                <a
                  key={tab.href}
                  href={tab.href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
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
            <h1 className="text-3xl font-bold text-white">User Feedback</h1>
            <p className="text-gray-400">Track briefing satisfaction and patterns</p>
          </div>
          <button
            onClick={fetchFeedback}
            disabled={loading}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Outreach Message */}
        {outreachMessage && (
          <div className={`mb-4 p-3 rounded ${outreachMessage.includes('Error') ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
            {outreachMessage}
          </div>
        )}

        {/* Stats Overview */}
        {data?.stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Total Feedback</p>
                <p className="text-2xl font-bold text-white">{data.stats.total}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Helpful Rate</p>
                <p className={`text-2xl font-bold ${data.stats.helpfulRate >= 70 ? 'text-green-400' : data.stats.helpfulRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {data.stats.helpfulRate}%
                </p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Helpful</p>
                <p className="text-2xl font-bold text-green-400">{data.stats.helpful}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Not Helpful</p>
                <p className="text-2xl font-bold text-red-400">{data.stats.notHelpful}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Need Attention</p>
                <p className="text-2xl font-bold text-orange-400">{data.stats.usersNeedingAttention}</p>
              </div>
            </div>

            {/* Last 7 Days */}
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <h3 className="text-white font-semibold mb-3">Last 7 Days</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-gray-400 text-sm">Total</p>
                  <p className="text-xl font-bold text-white">{data.stats.last7Days.total}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Helpful</p>
                  <p className="text-xl font-bold text-green-400">{data.stats.last7Days.helpful}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Not Helpful</p>
                  <p className="text-xl font-bold text-red-400">{data.stats.last7Days.notHelpful}</p>
                </div>
              </div>
            </div>

            {/* By Briefing Type */}
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <h3 className="text-white font-semibold mb-3">By Briefing Type</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(['daily', 'weekly', 'pursuit'] as const).map((type) => {
                  const typeData = data.stats.byType[type];
                  const total = typeData.helpful + typeData.notHelpful;
                  const rate = total > 0 ? Math.round((typeData.helpful / total) * 100) : 0;
                  return (
                    <div key={type} className="bg-gray-700 rounded-lg p-3">
                      <p className="text-white font-medium capitalize mb-2">{type} Briefings</p>
                      <div className="flex items-center gap-4">
                        <span className="text-green-400">👍 {typeData.helpful}</span>
                        <span className="text-red-400">👎 {typeData.notHelpful}</span>
                        <span className={`ml-auto ${rate >= 70 ? 'text-green-400' : rate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {total > 0 ? `${rate}%` : '-'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Users Needing Attention */}
            {data.stats.repeatNegative.length > 0 && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-6">
                <h3 className="text-red-300 font-semibold mb-3">⚠️ Users Needing Attention</h3>
                <p className="text-gray-400 text-sm mb-4">Users with multiple negative feedback - profile issues identified</p>
                <div className="space-y-4">
                  {data.stats.repeatNegative.map((user) => (
                    <div key={user.email} className="bg-gray-800 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-white font-medium">{user.email}</span>
                          <span className="ml-3 text-red-400 text-sm">{user.count}x not helpful</span>
                        </div>
                        <button
                          onClick={() => sendOutreach(user.email)}
                          disabled={sendingOutreach === user.email}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors disabled:opacity-50"
                        >
                          {sendingOutreach === user.email ? 'Sending...' : '📧 Send Outreach'}
                        </button>
                      </div>

                      {user.profile && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div className="bg-gray-700 rounded px-3 py-2">
                            <p className="text-gray-400 text-xs">NAICS Codes</p>
                            <p className={`font-medium ${user.profile.naicsCount > 20 ? 'text-red-400' : user.profile.naicsCount > 10 ? 'text-yellow-400' : 'text-white'}`}>
                              {user.profile.naicsCount}
                            </p>
                          </div>
                          <div className="bg-gray-700 rounded px-3 py-2">
                            <p className="text-gray-400 text-xs">Keywords</p>
                            <p className={`font-medium ${user.profile.keywordsCount === 0 ? 'text-yellow-400' : 'text-white'}`}>
                              {user.profile.keywordsCount || 'None'}
                            </p>
                          </div>
                          <div className="bg-gray-700 rounded px-3 py-2">
                            <p className="text-gray-400 text-xs">Agencies</p>
                            <p className={`font-medium ${user.profile.agenciesCount === 0 ? 'text-gray-500' : 'text-white'}`}>
                              {user.profile.agenciesCount || 'All'}
                            </p>
                          </div>
                          <div className="bg-gray-700 rounded px-3 py-2">
                            <p className="text-gray-400 text-xs">Location</p>
                            <p className={`font-medium ${!user.profile.hasLocation ? 'text-gray-500' : 'text-white'}`}>
                              {user.profile.hasLocation ? 'Set' : 'Nationwide'}
                            </p>
                          </div>
                        </div>
                      )}

                      {user.profile?.issues && user.profile.issues.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {user.profile.issues.map((issue, idx) => (
                            <span
                              key={idx}
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                issue.severity === 'high'
                                  ? 'bg-red-900/50 text-red-300'
                                  : issue.severity === 'medium'
                                  ? 'bg-yellow-900/50 text-yellow-300'
                                  : 'bg-gray-600 text-gray-300'
                              }`}
                            >
                              {issue.message}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Feedback Table */}
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <h3 className="text-white font-semibold">All Feedback</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">User</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Date</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Rating</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Submitted</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {data?.feedback.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-750">
                    <td className="px-4 py-3 text-white truncate max-w-[200px]" title={f.user_email}>
                      {f.user_email}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          f.briefing_type === 'daily'
                            ? 'bg-blue-900 text-blue-300'
                            : f.briefing_type === 'weekly'
                            ? 'bg-purple-900 text-purple-300'
                            : 'bg-orange-900 text-orange-300'
                        }`}
                      >
                        {f.briefing_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{f.briefing_date}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          f.rating === 'helpful'
                            ? 'bg-green-900 text-green-300'
                            : f.rating === 'outreach_sent'
                            ? 'bg-purple-900 text-purple-300'
                            : 'bg-red-900 text-red-300'
                        }`}
                      >
                        {f.rating === 'helpful' ? '👍 Helpful' : f.rating === 'outreach_sent' ? '📧 Outreach' : '👎 Not Helpful'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(f.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-sm truncate max-w-[150px]" title={f.comment || ''}>
                      {f.comment || '-'}
                    </td>
                  </tr>
                ))}
                {(!data?.feedback || data.feedback.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No feedback yet
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
