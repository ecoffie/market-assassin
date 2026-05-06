'use client';

import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface ContactsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

export default function ContactsPanel({ email, tier }: ContactsPanelProps) {
  // TODO: Integrate with existing ContactsPanel from bd-assist
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Teaming CRM</h1>
        <p className="text-slate-400 mt-1">Manage partner relationships and outreach</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <div className="text-5xl mb-4">🤝</div>
        <h3 className="text-xl font-semibold text-white mb-2">Coming Soon</h3>
        <p className="text-slate-400 mb-4">
          Track teaming partners, manage relationships, and coordinate outreach
          for joint pursuits.
        </p>
        <a
          href="/bd-assist"
          className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          View Current BD Assist →
        </a>
      </div>
    </div>
  );
}
