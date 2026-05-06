'use client';

// RecompetesPanel - Expiring contracts tracker
// This is a placeholder - will be extracted from /recompete

interface RecompetesPanelProps {
  email: string;
}

export default function RecompetesPanel({ email }: RecompetesPanelProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Recompetes</h2>
        <p className="text-gray-400 mt-1">
          12,000+ expiring federal contracts
        </p>
      </div>

      {/* Filters placeholder */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
          <option>All NAICS</option>
        </select>
        <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
          <option>All Agencies</option>
        </select>
        <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
          <option>All States</option>
        </select>
      </div>

      {/* Table placeholder */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-gray-400 text-sm">Contract</th>
              <th className="px-4 py-3 text-left text-gray-400 text-sm">Agency</th>
              <th className="px-4 py-3 text-left text-gray-400 text-sm">Value</th>
              <th className="px-4 py-3 text-left text-gray-400 text-sm">Expires</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((i) => (
              <tr key={i} className="border-t border-gray-700">
                <td className="px-4 py-3 text-white">Sample Contract {i}</td>
                <td className="px-4 py-3 text-gray-400">DoD</td>
                <td className="px-4 py-3 text-emerald-400">$5.2M</td>
                <td className="px-4 py-3 text-amber-400">6 months</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 mt-4 text-center">
        Recompete Tracker will be embedded here for {email || 'user'}
      </p>
    </div>
  );
}
