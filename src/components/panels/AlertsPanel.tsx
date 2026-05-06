'use client';

// AlertsPanel - Daily opportunity alerts
// This is a placeholder - will show simple list (Free) or AI analysis (Pro)

interface AlertsPanelProps {
  email: string;
}

export default function AlertsPanel({ email }: AlertsPanelProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Daily Alerts</h2>
        <p className="text-gray-400 mt-1">
          New opportunities matching your profile
        </p>
      </div>

      {/* Placeholder alerts */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-white font-medium">Sample Opportunity {i}</h3>
                <p className="text-gray-400 text-sm mt-1">
                  NAICS 541512 | Department of Defense
                </p>
              </div>
              <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                RFP
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-gray-800/50 rounded-lg p-6 text-center border border-gray-700">
        <p className="text-gray-400">
          Alerts for <span className="text-emerald-400">{email || 'user'}</span> will appear here
        </p>
      </div>
    </div>
  );
}
