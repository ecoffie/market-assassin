'use client';

import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface ForecastsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

export default function ForecastsPanel({ email, tier }: ForecastsPanelProps) {
  // TODO: Integrate with existing ForecastsPanel from bd-assist
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Procurement Forecasts</h1>
        <p className="text-slate-400 mt-1">7,700+ upcoming agency procurements</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <div className="text-5xl mb-4">🔮</div>
        <h3 className="text-xl font-semibold text-white mb-2">Coming Soon</h3>
        <p className="text-slate-400 mb-4">
          This panel will integrate the existing Forecasts tool with real-time data
          from 11 federal agencies.
        </p>
        <a
          href="/forecasts"
          className="inline-block px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          View Current Forecasts Tool →
        </a>
      </div>
    </div>
  );
}
