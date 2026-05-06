'use client';

// MarketResearchPanel - Federal Market Assassin
// This is a placeholder - will be extracted from /federal-market-assassin

interface MarketResearchPanelProps {
  email: string;
}

export default function MarketResearchPanel({ email }: MarketResearchPanelProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Market Research</h2>
        <p className="text-gray-400 mt-1">
          Generate strategic reports for your target markets
        </p>
      </div>

      {/* Report types grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {[
          { name: 'Agency Analytics', icon: '📊', free: true },
          { name: 'Budget Authority', icon: '💰', free: true },
          { name: 'Gov Buyers', icon: '👔', free: true },
          { name: 'OSBP Contacts', icon: '📇', free: true },
          { name: 'Pain Points', icon: '🎯', free: false },
          { name: 'Prime Contractors', icon: '🏢', free: false },
          { name: 'Competitive Intel', icon: '🔍', free: false },
          { name: 'Market Entry', icon: '🚀', free: false },
        ].map((report) => (
          <div
            key={report.name}
            className={`bg-gray-800 rounded-lg p-4 border ${
              report.free ? 'border-emerald-500/30' : 'border-gray-700'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{report.icon}</span>
              <div>
                <h3 className="text-white font-medium">{report.name}</h3>
                <span className={`text-xs ${report.free ? 'text-emerald-400' : 'text-purple-400'}`}>
                  {report.free ? 'FREE' : 'PRO'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gray-800/50 rounded-lg p-6 text-center border border-gray-700">
        <p className="text-gray-400">
          Federal Market Assassin will be embedded here
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Logged in as: <span className="text-emerald-400">{email || 'guest'}</span>
        </p>
      </div>
    </div>
  );
}
