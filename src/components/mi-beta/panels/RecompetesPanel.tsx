'use client';

import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface RecompetesPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

export default function RecompetesPanel({ email, tier }: RecompetesPanelProps) {
  // TODO: Integrate with existing Recompete Tracker
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Recompete Tracker</h1>
        <p className="text-slate-400 mt-1">12,000+ expiring federal contracts</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <div className="text-5xl mb-4">⏰</div>
        <h3 className="text-xl font-semibold text-white mb-2">Coming Soon</h3>
        <p className="text-slate-400 mb-4">
          Track expiring contracts and identify recompete opportunities before
          your competition.
        </p>
        <a
          href="/recompete"
          className="inline-block px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          View Current Recompete Tool →
        </a>
      </div>
    </div>
  );
}
