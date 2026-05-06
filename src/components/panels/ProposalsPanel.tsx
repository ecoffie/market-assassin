'use client';

interface ProposalsPanelProps {
  email: string;
}

export default function ProposalsPanel({ email }: ProposalsPanelProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">📝</span>
          <h1 className="text-2xl font-bold text-white">AI Proposal Assist</h1>
          <span className="px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded">
            COMING SOON
          </span>
        </div>
        <p className="text-gray-400">
          AI-powered proposal development — from RFP analysis to compliant drafts
        </p>
      </div>

      {/* Coming Soon Card */}
      <div className="bg-gradient-to-br from-purple-900/30 to-purple-800/20 rounded-xl border border-purple-500/30 p-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-white mb-4">
            Migrating from Mill Pond WorkBench
          </h2>
          <p className="text-gray-300 mb-6">
            We're bringing our 18-month proven proposal workbench directly into Market Intelligence.
            Same powerful AI capabilities, no seat fees.
          </p>

          {/* Feature Preview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {[
              {
                icon: '📋',
                title: 'RFP Analysis',
                description: 'Upload RFP, extract requirements automatically',
              },
              {
                icon: '✅',
                title: 'Compliance Matrix',
                description: 'Auto-generate compliance matrix from solicitation',
              },
              {
                icon: '🎯',
                title: 'Bid/No-Bid',
                description: 'AI-powered go/no-go recommendations',
              },
              {
                icon: '✍️',
                title: 'Section Drafts',
                description: 'Generate first drafts using your profile',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="bg-gray-900/50 rounded-lg p-4 border border-gray-800"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{feature.icon}</span>
                  <span className="font-medium text-white">{feature.title}</span>
                </div>
                <p className="text-sm text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>

          {/* Current Workaround */}
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
            <p className="text-sm text-gray-400">
              <span className="text-white font-medium">In the meantime:</span>{' '}
              Access our current proposal workbench at{' '}
              <a
                href="https://opngoviq.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline"
              >
                opngoviq.com
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* What's Different */}
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Why We're Building This In-House
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4">
            <div className="text-3xl font-bold text-red-400 mb-1">$435/mo</div>
            <div className="text-sm text-gray-400">Current seat costs</div>
          </div>
          <div className="text-center p-4">
            <div className="text-3xl font-bold text-emerald-400 mb-1">$0</div>
            <div className="text-sm text-gray-400">Seat costs after migration</div>
          </div>
          <div className="text-center p-4">
            <div className="text-3xl font-bold text-purple-400 mb-1">Unlimited</div>
            <div className="text-sm text-gray-400">Users on MI platform</div>
          </div>
        </div>
      </div>
    </div>
  );
}
