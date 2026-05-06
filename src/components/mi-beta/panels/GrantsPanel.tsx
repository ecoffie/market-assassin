'use client';

import { useState, useEffect } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface GrantsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface Grant {
  id: string;
  title: string;
  agency: string;
  amount: string;
  closeDate: string;
  category: string;
}

export default function GrantsPanel({ email, tier }: GrantsPanelProps) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');

  useEffect(() => {
    loadGrants();
  }, []);

  const loadGrants = async () => {
    // TODO: Fetch from Grants.gov API
    await new Promise(resolve => setTimeout(resolve, 500));
    setGrants([
      {
        id: '1',
        title: 'Small Business Innovation Research (SBIR) Phase I',
        agency: 'Department of Defense',
        amount: '$150,000',
        closeDate: '2026-06-15',
        category: 'Research & Development',
      },
      {
        id: '2',
        title: 'Cybersecurity Research Grant',
        agency: 'National Science Foundation',
        amount: '$500,000',
        closeDate: '2026-07-01',
        category: 'Technology',
      },
      {
        id: '3',
        title: 'Community Development Block Grant',
        agency: 'Housing and Urban Development',
        amount: '$1,000,000',
        closeDate: '2026-05-30',
        category: 'Community Development',
      },
    ]);
    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Federal Grants</h1>
        <p className="text-slate-400 mt-1">$700B+ in federal grant funding</p>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <input
          type="text"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          placeholder="Search grants..."
          className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        />
        <button className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors">
          Search
        </button>
      </div>

      {/* Quick Filters */}
      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 text-sm rounded-lg">
          All Grants
        </button>
        <button className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700">
          SBIR/STTR
        </button>
        <button className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700">
          R&D
        </button>
        <button className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700">
          Technology
        </button>
        <button className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700">
          Closing Soon
        </button>
      </div>

      {/* Grant List */}
      <div className="space-y-3">
        {grants.map((grant) => (
          <div
            key={grant.id}
            className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors cursor-pointer"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
                    {grant.category}
                  </span>
                </div>
                <h3 className="font-medium text-white mb-1">{grant.title}</h3>
                <p className="text-sm text-slate-400">{grant.agency}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-semibold text-emerald-400">{grant.amount}</div>
                <div className="text-xs text-slate-500">Closes {grant.closeDate}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* View More */}
      <div className="text-center">
        <button className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
          Load More Grants
        </button>
      </div>
    </div>
  );
}
