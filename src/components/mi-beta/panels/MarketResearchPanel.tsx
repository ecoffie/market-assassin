'use client';

import { useState } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface MarketResearchPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface Report {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: 'free' | 'pro';
}

const REPORTS: Report[] = [
  { id: 'analytics', title: 'Market Analytics', description: 'Spending patterns and trends', icon: '📊', tier: 'free' },
  { id: 'budget', title: 'Budget Authority', description: 'Agency budget analysis', icon: '💰', tier: 'free' },
  { id: 'buyers', title: 'Gov Buyers', description: 'Decision maker identification', icon: '👤', tier: 'free' },
  { id: 'osbp', title: 'OSBP Contacts', description: 'Small business office contacts', icon: '🤝', tier: 'free' },
  { id: 'pain', title: 'Pain Points', description: 'Agency challenges and needs', icon: '🎯', tier: 'pro' },
  { id: 'primes', title: 'Prime Analysis', description: 'Incumbent contractor intel', icon: '🏢', tier: 'pro' },
  { id: 'vehicles', title: 'Contract Vehicles', description: 'Relevant acquisition vehicles', icon: '🚗', tier: 'pro' },
  { id: 'positioning', title: 'Positioning', description: 'Strategic market position', icon: '📈', tier: 'pro' },
  { id: 'teaming', title: 'Teaming Partners', description: 'Potential partner analysis', icon: '🤲', tier: 'pro' },
  { id: 'forecast', title: 'Market Forecast', description: 'Future opportunity pipeline', icon: '🔮', tier: 'pro' },
];

export default function MarketResearchPanel({ email, tier }: MarketResearchPanelProps) {
  const [selectedNaics, setSelectedNaics] = useState('541512');
  const [selectedAgency, setSelectedAgency] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const canAccessReport = (reportTier: 'free' | 'pro') => {
    if (reportTier === 'free') return true;
    return tier !== 'free';
  };

  const handleGenerate = async (reportId: string) => {
    if (!canAccessReport(REPORTS.find(r => r.id === reportId)?.tier || 'pro')) {
      return;
    }
    setIsGenerating(true);
    // TODO: Generate report
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsGenerating(false);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Market Research</h1>
        <p className="text-slate-400 mt-1">Generate strategic intelligence reports</p>
      </div>

      {/* Input Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="font-semibold text-white mb-4">Research Parameters</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">NAICS Code</label>
            <input
              type="text"
              value={selectedNaics}
              onChange={(e) => setSelectedNaics(e.target.value)}
              placeholder="e.g., 541512"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">Target Agency (optional)</label>
            <input
              type="text"
              value={selectedAgency}
              onChange={(e) => setSelectedAgency(e.target.value)}
              placeholder="e.g., Department of Defense"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Reports Grid */}
      <div>
        <h3 className="font-semibold text-white mb-4">Available Reports</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORTS.map((report) => {
            const hasAccess = canAccessReport(report.tier);
            return (
              <div
                key={report.id}
                className={`
                  bg-slate-900 border rounded-xl p-4 transition-all
                  ${hasAccess
                    ? 'border-slate-800 hover:border-emerald-500/50 cursor-pointer'
                    : 'border-slate-800/50 opacity-60'
                  }
                `}
                onClick={() => hasAccess && handleGenerate(report.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-2xl">{report.icon}</span>
                  {!hasAccess && (
                    <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                      Pro
                    </span>
                  )}
                </div>
                <h4 className="font-medium text-white mb-1">{report.title}</h4>
                <p className="text-sm text-slate-500">{report.description}</p>
                {hasAccess && (
                  <button
                    className="mt-3 w-full py-2 text-sm bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded-lg transition-colors"
                    disabled={isGenerating}
                  >
                    {isGenerating ? 'Generating...' : 'Generate'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upgrade CTA for Free Users */}
      {tier === 'free' && (
        <div className="bg-gradient-to-r from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-6 text-center">
          <h3 className="font-semibold text-white mb-2">Unlock All 10 Reports</h3>
          <p className="text-slate-400 text-sm mb-4">
            Upgrade to Pro to access Pain Points, Prime Analysis, Teaming Partners, and more.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro
          </a>
        </div>
      )}
    </div>
  );
}
