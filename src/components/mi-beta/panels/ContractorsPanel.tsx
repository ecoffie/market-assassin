'use client';

import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface ContractorsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

export default function ContractorsPanel({ email, tier }: ContractorsPanelProps) {
  // TODO: Integrate with existing Contractor Database
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Federal Contractors</h1>
        <p className="text-slate-400 mt-1">3,500+ contractors with SBLO contacts</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <div className="text-5xl mb-4">🏢</div>
        <h3 className="text-xl font-semibold text-white mb-2">Coming Soon</h3>
        <p className="text-slate-400 mb-4">
          Search federal contractors, find teaming partners, and access small business
          liaison officer contacts.
        </p>
        <a
          href="/contractor-database"
          className="inline-block px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          View Current Contractor Database →
        </a>
      </div>
    </div>
  );
}
