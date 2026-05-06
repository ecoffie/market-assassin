'use client';

// ContractorsPanel - Federal Contractor Database
// This is a placeholder - will be extracted from /contractor-database

interface ContractorsPanelProps {
  email: string;
}

export default function ContractorsPanel({ email }: ContractorsPanelProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Contractor Database</h2>
        <p className="text-gray-400 mt-1">
          3,500+ federal contractors with SBLO contacts
        </p>
      </div>

      {/* Search bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search contractors by name, NAICS, or capability..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500"
        />
      </div>

      {/* Contractor cards placeholder */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-white font-medium">Sample Contractor {i}</h3>
                <p className="text-gray-400 text-sm">NAICS: 541512, 541611</p>
                <p className="text-emerald-400 text-sm mt-2">SBLO: John Smith</p>
              </div>
              <button className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded">
                Contact
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-500 mt-6 text-center">
        Full contractor database will be embedded here
      </p>
    </div>
  );
}
