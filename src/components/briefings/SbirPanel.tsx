'use client';

import { useState, useEffect, useCallback } from 'react';
import { SaveToPipelineButton } from '@/components/briefings/SaveToPipelineButton';

interface SbirOpportunity {
  id: string;
  title: string;
  agency: string;
  phase?: string;
  amount?: number;
  startDate?: string;
  endDate?: string;
  organization?: string;
  location?: string;
  description?: string;
  source: string;
  url?: string;
}

interface SbirMetadata {
  summary: {
    description: string;
    phase1Award: string;
    phase2Award: string;
    eligibility: string;
    multisiteOpportunities: number;
  };
  nihInstitutes: { code: string; name: string }[];
  phaseOptions: { value: string; label: string }[];
  sourceOptions: { value: string; label: string }[];
}

interface SbirPanelProps {
  email: string;
}

const PHASE_COLORS: Record<string, { bg: string; text: string }> = {
  'SBIR Phase I': { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  'SBIR Phase II': { bg: 'bg-green-500/20', text: 'text-green-400' },
  'STTR Phase I': { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  'STTR Phase II': { bg: 'bg-teal-500/20', text: 'text-teal-400' },
  'SBIR': { bg: 'bg-violet-500/20', text: 'text-violet-400' },
  'SBIR/STTR': { bg: 'bg-purple-500/20', text: 'text-purple-400' },
};

const AGENCY_COLORS: Record<string, { bg: string; text: string }> = {
  NCI: { bg: 'bg-red-500/20', text: 'text-red-400' },
  NIAID: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  NHLBI: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  NINDS: { bg: 'bg-indigo-500/20', text: 'text-indigo-400' },
  NIMH: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  NIH: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  NSF: { bg: 'bg-violet-500/20', text: 'text-violet-400' },
  DOD: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  DOE: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  NASA: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
};

function formatCurrency(value: number | undefined): string {
  if (!value) return 'TBD';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'TBD';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function SbirPanel({ email }: SbirPanelProps) {
  const [metadata, setMetadata] = useState<SbirMetadata | null>(null);
  const [opportunities, setOpportunities] = useState<SbirOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search filters
  const [keywordFilter, setKeywordFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('nih');

  // Fetch metadata on mount
  useEffect(() => {
    async function fetchMetadata() {
      try {
        const response = await fetch('/api/sbir');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setMetadata(data);
          }
        }
      } catch (err) {
        console.error('Failed to fetch SBIR metadata:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchMetadata();
  }, []);

  // Search SBIR opportunities
  const handleSearch = useCallback(async () => {
    if (!keywordFilter && !agencyFilter) {
      setOpportunities([]);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (keywordFilter) params.append('keyword', keywordFilter);
      if (agencyFilter) params.append('agency', agencyFilter);
      if (phaseFilter !== 'all') params.append('phase', phaseFilter);
      params.append('source', sourceFilter);
      params.append('limit', '50');

      const response = await fetch(`/api/sbir?${params.toString()}`, {
        headers: { 'X-User-Email': email },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.opportunities) {
          setOpportunities(data.opportunities);
        } else if (data.error) {
          setError(data.error);
        }
      } else {
        setError('Failed to search SBIR opportunities');
      }
    } catch (err) {
      console.error('SBIR search error:', err);
      setError('Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  }, [keywordFilter, agencyFilter, phaseFilter, sourceFilter, email]);

  const getPhaseColors = (phase: string | undefined) => {
    return PHASE_COLORS[phase || ''] || { bg: 'bg-gray-500/20', text: 'text-gray-400' };
  };

  const getAgencyColors = (agency: string) => {
    return AGENCY_COLORS[agency] || { bg: 'bg-gray-500/20', text: 'text-gray-400' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading SBIR intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <span className="text-xl">🔬</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Phase I Award</p>
              <p className="text-2xl font-bold text-white">{metadata?.summary.phase1Award || '$275K'}</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <span className="text-xl">🚀</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Phase II Award</p>
              <p className="text-2xl font-bold text-white">{metadata?.summary.phase2Award || '$1.1M'}</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <span className="text-xl">🏛️</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">NIH Institutes</p>
              <p className="text-2xl font-bold text-white">{metadata?.nihInstitutes.length || 10}+</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <span className="text-xl">📊</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Multisite Opps</p>
              <p className="text-2xl font-bold text-white">{metadata?.summary.multisiteOpportunities || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Eligibility Banner */}
      <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-white font-medium">Eligibility Requirements</p>
            <p className="text-gray-400 text-sm">{metadata?.summary.eligibility || 'US small business, <500 employees, 51%+ US-owned'}</p>
          </div>
        </div>
      </div>

      {/* Search Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Search SBIR/STTR Opportunities</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Keyword</label>
            <input
              type="text"
              value={keywordFilter}
              onChange={(e) => setKeywordFilter(e.target.value)}
              placeholder="cancer, AI, biotech..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Agency/Institute</label>
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Agencies</option>
              {metadata?.nihInstitutes.map((inst) => (
                <option key={inst.code} value={inst.code}>
                  {inst.code} - {inst.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Phase</label>
            <select
              value={phaseFilter}
              onChange={(e) => setPhaseFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
            >
              {metadata?.phaseOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Data Source</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
            >
              {metadata?.sourceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || (!keywordFilter && !agencyFilter)}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {searching ? 'Searching...' : 'Search SBIR/STTR'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Search Results */}
      {opportunities.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              {opportunities.length} Opportunities Found
            </h3>
          </div>
          <div className="divide-y divide-gray-800">
            {opportunities.map((opp) => {
              const phaseColors = getPhaseColors(opp.phase);
              const agencyColors = getAgencyColors(opp.agency);
              return (
                <div key={opp.id} className="p-5 hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${agencyColors.bg} ${agencyColors.text}`}>
                          {opp.agency}
                        </span>
                        {opp.phase && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${phaseColors.bg} ${phaseColors.text}`}>
                            {opp.phase}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                          {opp.source}
                        </span>
                      </div>
                      <h4 className="text-white font-medium mb-1 line-clamp-2">{opp.title}</h4>
                      {opp.organization && (
                        <p className="text-gray-500 text-sm mb-1">
                          {opp.organization} {opp.location && `• ${opp.location}`}
                        </p>
                      )}
                      {opp.description && (
                        <p className="text-gray-400 text-sm line-clamp-2 mb-2">{opp.description}</p>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                        {opp.startDate && (
                          <span>Start: {formatDate(opp.startDate)}</span>
                        )}
                        {opp.endDate && (
                          <span>End: {formatDate(opp.endDate)}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {opp.amount && (
                        <div className="text-lg font-bold text-white mb-2">
                          {formatCurrency(opp.amount)}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {opp.url && (
                          <a
                            href={opp.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block px-3 py-1.5 bg-blue-600/20 text-blue-400 text-xs font-medium rounded hover:bg-blue-600/30 transition-colors"
                          >
                            View Details →
                          </a>
                        )}
                        <SaveToPipelineButton
                          opportunity={{
                            title: opp.title,
                            noticeId: opp.id,
                            agency: opp.agency,
                            deadline: opp.endDate,
                            samLink: opp.url,
                          }}
                          email={email}
                          variant="small"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* NIH Institute Quick Select */}
      {opportunities.length === 0 && metadata && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">NIH Institutes</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {metadata.nihInstitutes.slice(0, 10).map((inst) => {
              const colors = getAgencyColors(inst.code);
              return (
                <button
                  key={inst.code}
                  onClick={() => {
                    setAgencyFilter(inst.code);
                    setTimeout(handleSearch, 100);
                  }}
                  className={`p-3 rounded-lg border border-gray-700 hover:border-blue-500/50 transition-colors text-left ${colors.bg}`}
                >
                  <div className={`text-sm font-bold ${colors.text}`}>{inst.code}</div>
                  <div className="text-xs text-gray-400 line-clamp-1">{inst.name}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SBIR 101 Info */}
      {opportunities.length === 0 && !error && (
        <div className="bg-gradient-to-br from-blue-900/30 to-indigo-900/30 border border-blue-500/30 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-3">What is SBIR/STTR?</h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-blue-400 font-medium mb-1">SBIR (Small Business Innovation Research)</p>
              <p className="text-gray-400">
                Competitive awards for small businesses to conduct federal R&D with commercialization potential.
                11 federal agencies participate with ~$3.5B annual funding.
              </p>
            </div>
            <div>
              <p className="text-cyan-400 font-medium mb-1">STTR (Small Business Technology Transfer)</p>
              <p className="text-gray-400">
                Similar to SBIR but requires partnership with a research institution (university, federal lab).
                At least 40% of work done by small business, 30% by research partner.
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-blue-500/20">
            <p className="text-gray-400 text-sm">
              <strong className="text-white">Pro Tip:</strong> Phase I is proof-of-concept (~$275K, 6-12 months).
              Phase II is full development (~$1.1M, 2 years). Phase III is commercialization (no set funding).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
