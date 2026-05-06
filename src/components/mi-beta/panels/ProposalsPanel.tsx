'use client';

import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface ProposalsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

export default function ProposalsPanel({ email, tier }: ProposalsPanelProps) {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">AI Proposal Assist</h1>
        <p className="text-slate-400 mt-1">AI-powered proposal writing and review</p>
      </div>

      <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-8 text-center">
        <div className="text-5xl mb-4">📝</div>
        <span className="inline-block px-3 py-1 bg-purple-500/20 text-purple-400 text-sm rounded-full mb-4">
          Coming Q3 2026
        </span>
        <h3 className="text-xl font-semibold text-white mb-2">Proposal Assistant</h3>
        <p className="text-slate-400 mb-4 max-w-md mx-auto">
          AI-powered tools to help you write winning proposals: compliance matrix generation,
          win theme development, and automated section drafting.
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto text-sm">
          <div className="p-3 bg-slate-800/50 rounded-lg">
            <div className="text-purple-400 font-medium">Compliance Matrix</div>
            <div className="text-slate-500 text-xs">Auto-generate from RFP</div>
          </div>
          <div className="p-3 bg-slate-800/50 rounded-lg">
            <div className="text-purple-400 font-medium">Win Themes</div>
            <div className="text-slate-500 text-xs">AI-suggested themes</div>
          </div>
          <div className="p-3 bg-slate-800/50 rounded-lg">
            <div className="text-purple-400 font-medium">Section Drafts</div>
            <div className="text-slate-500 text-xs">Past performance, tech approach</div>
          </div>
          <div className="p-3 bg-slate-800/50 rounded-lg">
            <div className="text-purple-400 font-medium">Review Checklist</div>
            <div className="text-slate-500 text-xs">Pre-submission QC</div>
          </div>
        </div>
      </div>
    </div>
  );
}
