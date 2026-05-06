'use client';

// DashboardPanel - AI Briefings (Daily/Weekly/Pursuit)
// This is a placeholder - will be extracted from /briefings page

interface DashboardPanelProps {
  email: string;
}

export default function DashboardPanel({ email }: DashboardPanelProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">AI Briefings</h2>
        <p className="text-gray-400 mt-1">
          Your personalized market intelligence dashboard
        </p>
      </div>

      {/* Placeholder content - will be extracted from briefings page */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="text-emerald-400 text-3xl mb-2">📋</div>
          <h3 className="text-white font-semibold">Daily Brief</h3>
          <p className="text-gray-400 text-sm">Today&apos;s opportunities</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="text-purple-400 text-3xl mb-2">📊</div>
          <h3 className="text-white font-semibold">Weekly Deep Dive</h3>
          <p className="text-gray-400 text-sm">Strategic insights</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="text-amber-400 text-3xl mb-2">🎯</div>
          <h3 className="text-white font-semibold">Pursuit Brief</h3>
          <p className="text-gray-400 text-sm">Target recommendations</p>
        </div>
      </div>

      <div className="bg-gray-800/50 rounded-lg p-8 text-center border border-gray-700">
        <p className="text-gray-400">
          Briefing content will load here for <span className="text-emerald-400">{email || 'user'}</span>
        </p>
      </div>
    </div>
  );
}
