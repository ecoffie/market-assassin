'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PipelineBoard } from '@/components/bd-assist';
import MarketScanner from '@/components/bd-assist/MarketScanner';
import ForecastsPanel from '@/components/bd-assist/ForecastsPanel';

interface PipelineStats {
  totalCount: number;
  activeCount: number;
  byStage: {
    tracking: number;
    pursuing: number;
    bidding: number;
    submitted: number;
    won: number;
    lost: number;
    archived: number;
  };
  byPriority: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  totalValue: string;
  upcomingDeadlines: number;
  winRate: number;
}

type TabType = 'intel' | 'pipeline' | 'teaming' | 'scanner' | 'forecasts';

// Loading fallback for Suspense
function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <span className="text-white font-bold text-2xl">BD</span>
        </div>
        <p className="text-violet-400">Loading BD Assist...</p>
      </div>
    </div>
  );
}

// Wrapper component to handle Suspense boundary
export default function BDAssistPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <BDAssistDashboard />
    </Suspense>
  );
}

function BDAssistDashboard() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [inputEmail, setInputEmail] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('intel');
  const [pipelineStats, setPipelineStats] = useState<PipelineStats>({
    totalCount: 0,
    activeCount: 0,
    byStage: {
      tracking: 0,
      pursuing: 0,
      bidding: 0,
      submitted: 0,
      won: 0,
      lost: 0,
      archived: 0,
    },
    byPriority: {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    },
    totalValue: '$0',
    upcomingDeadlines: 0,
    winRate: 0,
  });
  const [loading, setLoading] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(true);

  // Check for email in URL params on mount
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(emailParam);
      setInputEmail(emailParam);
      setShowEmailInput(false);
      // Fetch pipeline stats
      fetchPipelineStats(emailParam);
    }
  }, [searchParams]);

  const fetchPipelineStats = async (userEmail: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/pipeline/stats?email=${encodeURIComponent(userEmail)}`);
      if (response.ok) {
        const data = await response.json();
        // API returns stats directly, not wrapped in { success, stats }
        if (data.totalCount !== undefined) {
          setPipelineStats(data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch pipeline stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputEmail.trim()) {
      setEmail(inputEmail.trim().toLowerCase());
      setShowEmailInput(false);
      fetchPipelineStats(inputEmail.trim().toLowerCase());
    }
  };

  if (showEmailInput) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <span className="text-white font-bold text-2xl">BD</span>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">BD Assist</h1>
            <p className="text-violet-400">Your AI-Powered BD Department</p>
          </div>

          <div className="p-6 bg-gray-900 border border-gray-800 rounded-2xl">
            <form onSubmit={handleEmailSubmit}>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Enter your email
              </label>
              <input
                type="email"
                id="email"
                value={inputEmail}
                onChange={(e) => setInputEmail(e.target.value)}
                required
                className="w-full p-3 mb-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none"
                placeholder="you@example.com"
              />
              <button
                type="submit"
                className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl transition-colors"
              >
                Access Dashboard
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center">
                <span className="text-white font-bold text-lg">BD</span>
              </div>
              <div>
                <h1 className="text-xl font-bold">BD ASSIST</h1>
                <p className="text-xs text-gray-400">Your AI-Powered BD Department</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">{email}</span>
              <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Today's Brief Summary Card */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Today&apos;s Brief</h2>
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 rounded-xl p-6">
            <ul className="space-y-2 text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">•</span>
                <span>3 new opportunities matching your profile</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-400 mt-1">•</span>
                <span>1 deadline in 7 days</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-400 mt-1">•</span>
                <span>2 recompetes entering window</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Pipeline Snapshot */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Pipeline Snapshot</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center hover:border-violet-500/50 transition-colors">
              <div className="text-3xl font-bold text-violet-400 mb-1">
                {loading ? '...' : pipelineStats.byStage.tracking}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Tracking</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center hover:border-blue-500/50 transition-colors">
              <div className="text-3xl font-bold text-blue-400 mb-1">
                {loading ? '...' : pipelineStats.byStage.pursuing}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Pursuing</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center hover:border-yellow-500/50 transition-colors">
              <div className="text-3xl font-bold text-yellow-400 mb-1">
                {loading ? '...' : pipelineStats.byStage.bidding}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Bidding</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center hover:border-orange-500/50 transition-colors">
              <div className="text-3xl font-bold text-orange-400 mb-1">
                {loading ? '...' : pipelineStats.byStage.submitted}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Submitted</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center hover:border-emerald-500/50 transition-colors">
              <div className="text-3xl font-bold text-emerald-400 mb-1">
                {loading ? '...' : pipelineStats.byStage.won}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Won</div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setActiveTab('scanner')}
              className="px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <span className="text-xl">🔍</span>
              Scan Market
            </button>
            <button
              onClick={() => setActiveTab('pipeline')}
              className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2 border border-gray-700"
            >
              <span className="text-xl">➕</span>
              Add Opportunity
            </button>
            <button
              onClick={() => setActiveTab('teaming')}
              className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2 border border-gray-700"
            >
              <span className="text-xl">🤝</span>
              Find Partners
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-800 mb-6">
          <nav className="flex gap-1">
            <button
              onClick={() => setActiveTab('intel')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${
                activeTab === 'intel'
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              INTEL
            </button>
            <button
              onClick={() => setActiveTab('pipeline')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${
                activeTab === 'pipeline'
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              PIPELINE
            </button>
            <button
              onClick={() => setActiveTab('teaming')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${
                activeTab === 'teaming'
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              TEAMING
            </button>
            <button
              onClick={() => setActiveTab('scanner')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${
                activeTab === 'scanner'
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              SCANNER
            </button>
            <button
              onClick={() => setActiveTab('forecasts')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${
                activeTab === 'forecasts'
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              FORECASTS
            </button>
          </nav>
        </div>

        {/* Tab Content Area */}
        <div className="min-h-[400px]">
          {activeTab === 'intel' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <div className="w-16 h-16 rounded-xl bg-violet-600/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">📊</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Intelligence Dashboard</h3>
              <p className="text-gray-400 max-w-md mx-auto">
                Your personalized market intelligence briefings will appear here. Daily briefs, weekly deep dives, and pursuit-specific guidance.
              </p>
            </div>
          )}

          {activeTab === 'pipeline' && (
            <PipelineBoard email={email} />
          )}

          {activeTab === 'teaming' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <div className="w-16 h-16 rounded-xl bg-emerald-600/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">🤝</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Teams Manager</h3>
              <p className="text-gray-400 max-w-md mx-auto">
                Discover teaming partners, track your teaming agreements, and manage subcontractor relationships all in one place.
              </p>
            </div>
          )}

          {activeTab === 'scanner' && (
            <MarketScanner email={email} />
          )}

          {activeTab === 'forecasts' && (
            <ForecastsPanel email={email} />
          )}
        </div>
      </div>
    </div>
  );
}
