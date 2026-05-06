'use client';

import { useState, useEffect } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface DashboardPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface BriefingData {
  daily?: {
    date: string;
    headline: string;
    itemCount: number;
  };
  weekly?: {
    date: string;
    headline: string;
  };
  pursuit?: {
    date: string;
    targetCount: number;
  };
}

export default function DashboardPanel({ email, tier }: DashboardPanelProps) {
  const [briefings, setBriefings] = useState<BriefingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (email) {
      loadBriefings();
    } else {
      setIsLoading(false);
    }
  }, [email]);

  const loadBriefings = async () => {
    // TODO: Fetch real briefing data
    // For now, show placeholder data
    await new Promise(resolve => setTimeout(resolve, 500));
    setBriefings({
      daily: {
        date: new Date().toISOString().split('T')[0],
        headline: 'Your personalized daily intelligence briefing',
        itemCount: 12,
      },
      weekly: {
        date: new Date().toISOString().split('T')[0],
        headline: 'Weekly market deep dive analysis',
      },
      pursuit: {
        date: new Date().toISOString().split('T')[0],
        targetCount: 3,
      },
    });
    setIsLoading(false);
  };

  if (tier === 'free') {
    return (
      <div className="p-6">
        <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-2xl font-bold text-white mb-3">AI Briefings</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Get personalized daily intelligence, weekly deep dives, and pursuit-specific
            briefings powered by AI analysis of your target market.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro - $149/mo
          </a>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-slate-800 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">AI Briefings</h1>
        <p className="text-slate-400 mt-1">Your personalized market intelligence</p>
      </div>

      {/* Briefing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Daily Brief */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-emerald-500/50 transition-colors cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <span className="text-xl">📋</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Daily Brief</h3>
              <p className="text-xs text-slate-500">{briefings?.daily?.date}</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">{briefings?.daily?.headline}</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400">{briefings?.daily?.itemCount} items</span>
            <span className="text-xs text-slate-500">View →</span>
          </div>
        </div>

        {/* Weekly Deep Dive */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-purple-500/50 transition-colors cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <span className="text-xl">📊</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Weekly Deep Dive</h3>
              <p className="text-xs text-slate-500">{briefings?.weekly?.date}</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">{briefings?.weekly?.headline}</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-purple-400">Strategic analysis</span>
            <span className="text-xs text-slate-500">View →</span>
          </div>
        </div>

        {/* Pursuit Brief */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-blue-500/50 transition-colors cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <span className="text-xl">🎯</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Pursuit Brief</h3>
              <p className="text-xs text-slate-500">{briefings?.pursuit?.date}</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">Top opportunities to pursue this week</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-400">{briefings?.pursuit?.targetCount} targets</span>
            <span className="text-xs text-slate-500">View →</span>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="font-semibold text-white mb-4">This Week&apos;s Highlights</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-slate-800/50 rounded-lg">
            <div className="text-2xl font-bold text-emerald-400">12</div>
            <div className="text-xs text-slate-500">New Opportunities</div>
          </div>
          <div className="text-center p-4 bg-slate-800/50 rounded-lg">
            <div className="text-2xl font-bold text-purple-400">3</div>
            <div className="text-xs text-slate-500">High Match</div>
          </div>
          <div className="text-center p-4 bg-slate-800/50 rounded-lg">
            <div className="text-2xl font-bold text-blue-400">$2.4M</div>
            <div className="text-xs text-slate-500">Est. Value</div>
          </div>
          <div className="text-center p-4 bg-slate-800/50 rounded-lg">
            <div className="text-2xl font-bold text-amber-400">5</div>
            <div className="text-xs text-slate-500">Closing Soon</div>
          </div>
        </div>
      </div>
    </div>
  );
}
