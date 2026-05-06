'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface ContractorsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface Contractor {
  company: string;
  sblo_name: string;
  title: string;
  email: string;
  phone: string;
  address: string;
  naics: string;
  source: string;
  contract_count: string;
  total_contract_value: string;
  agencies: string;
  has_subcontract_plan: string;
  has_email: boolean;
  has_phone: boolean;
  has_contact: boolean;
  contract_value_num: number;
}

interface ContractorStats {
  totalContractors: number;
  withContact: number;
  withEmail: number;
  withPhone: number;
  sources: string[];
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

export default function ContractorsPanel({ email, tier }: ContractorsPanelProps) {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [stats, setStats] = useState<ContractorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);

  // Search filters
  const [searchQuery, setSearchQuery] = useState('');
  const [naicsFilter, setNaicsFilter] = useState('');
  const [contactFilter, setContactFilter] = useState<'all' | 'withContact' | 'withEmail'>('all');
  const [sortBy, setSortBy] = useState<'contract_value' | 'company' | 'contract_count'>('contract_value');

  // Pagination
  const [page, setPage] = useState(0);
  const limit = 25;

  // Load stats on mount
  useEffect(() => {
    loadStats();
    searchContractors('', '', 'all', 'contract_value', 0);
  }, []);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/contractors?action=stats');
      const data = await res.json();
      if (data.totalContractors) {
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const searchContractors = useCallback(async (
    search: string,
    naics: string,
    contact: 'all' | 'withContact' | 'withEmail',
    sort: 'contract_value' | 'company' | 'contract_count',
    pageNum: number
  ) => {
    setSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (naics) params.set('naics', naics);
      if (contact === 'withContact') params.set('hasContact', 'true');
      if (contact === 'withEmail') params.set('hasEmail', 'true');
      params.set('sortBy', sort);
      params.set('sortOrder', 'desc');
      params.set('limit', limit.toString());
      params.set('offset', (pageNum * limit).toString());

      const res = await fetch(`/api/contractors?${params.toString()}`);
      const data = await res.json();

      if (data.contractors) {
        setContractors(data.contractors);
        setTotalCount(data.totalCount || 0);
        setFilteredCount(data.filteredCount || 0);
      } else if (data.error) {
        setError(data.error);
        setContractors([]);
      }
    } catch (err) {
      console.error('Contractor search error:', err);
      setError('Failed to search contractors');
      setContractors([]);
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    setPage(0);
    searchContractors(searchQuery, naicsFilter, contactFilter, sortBy, 0);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    searchContractors(searchQuery, naicsFilter, contactFilter, sortBy, newPage);
  };

  const totalPages = Math.ceil(filteredCount / limit);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-slate-800 rounded-xl" />
            ))}
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-28 bg-slate-800 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Federal Contractors</h1>
        <p className="text-slate-400 mt-1">
          {stats ? `${stats.totalContractors.toLocaleString()} contractors` : '3,500+ contractors'} with SBLO contacts
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{stats.totalContractors.toLocaleString()}</div>
            <div className="text-xs text-slate-500">Total Contractors</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-emerald-400">{stats.withContact.toLocaleString()}</div>
            <div className="text-xs text-slate-500">With SBLO Contact</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-400">{stats.withEmail.toLocaleString()}</div>
            <div className="text-xs text-slate-500">With Email</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-amber-400">{stats.withPhone.toLocaleString()}</div>
            <div className="text-xs text-slate-500">With Phone</div>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Company, contact name, or email..."
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* NAICS Filter */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">NAICS Code</label>
            <input
              type="text"
              value={naicsFilter}
              onChange={(e) => setNaicsFilter(e.target.value)}
              placeholder="541512"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Contact Filter */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Contact Info</label>
            <select
              value={contactFilter}
              onChange={(e) => setContactFilter(e.target.value as 'all' | 'withContact' | 'withEmail')}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All Contractors</option>
              <option value="withContact">With SBLO Contact</option>
              <option value="withEmail">With Email</option>
            </select>
          </div>

          {/* Search Button */}
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={searching}
              className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Sort Options */}
        <div className="flex gap-2 mt-4 pt-4 border-t border-slate-800">
          <span className="text-xs text-slate-500 mr-2 self-center">Sort by:</span>
          {[
            { key: 'contract_value', label: 'Contract Value' },
            { key: 'contract_count', label: 'Contract Count' },
            { key: 'company', label: 'Company Name' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setSortBy(key as typeof sortBy);
                setPage(0);
                searchContractors(searchQuery, naicsFilter, contactFilter, key as typeof sortBy, 0);
              }}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                sortBy === key
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Results Count */}
      {!searching && contractors.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Showing {page * limit + 1}-{Math.min((page + 1) * limit, filteredCount)} of {filteredCount.toLocaleString()} contractors
          </span>
          {filteredCount !== totalCount && (
            <span className="text-slate-500">(filtered from {totalCount.toLocaleString()})</span>
          )}
        </div>
      )}

      {/* Contractor List */}
      {contractors.length > 0 && (
        <div className="space-y-3">
          {contractors.map((contractor, idx) => (
            <div
              key={`${contractor.company}-${idx}`}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-emerald-500/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Company Info */}
                <div className="flex-1 min-w-0">
                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {contractor.has_contact && (
                      <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
                        SBLO Contact
                      </span>
                    )}
                    {contractor.has_email && (
                      <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                        Email
                      </span>
                    )}
                    {contractor.has_phone && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                        Phone
                      </span>
                    )}
                    {contractor.has_subcontract_plan === 'Yes' && (
                      <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                        Subcontract Plan
                      </span>
                    )}
                  </div>

                  {/* Company Name */}
                  <h3 className="text-white font-semibold text-lg mb-1">{contractor.company}</h3>

                  {/* SBLO Contact */}
                  {contractor.sblo_name && contractor.sblo_name !== 'N/A' && (
                    <div className="mb-2">
                      <span className="text-emerald-400 font-medium">{contractor.sblo_name}</span>
                      {contractor.title && contractor.title !== 'N/A' && (
                        <span className="text-slate-500 text-sm"> — {contractor.title}</span>
                      )}
                    </div>
                  )}

                  {/* Contact Info */}
                  <div className="flex flex-wrap gap-4 text-sm">
                    {contractor.email && contractor.email !== 'N/A' && (
                      <a
                        href={`mailto:${contractor.email}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        ✉️ {contractor.email}
                      </a>
                    )}
                    {contractor.phone && contractor.phone !== 'N/A' && (
                      <a
                        href={`tel:${contractor.phone}`}
                        className="text-slate-400 hover:text-slate-300"
                      >
                        📞 {contractor.phone}
                      </a>
                    )}
                  </div>

                  {/* NAICS & Agencies */}
                  <div className="flex flex-wrap gap-3 mt-3 text-xs text-slate-500">
                    {contractor.naics && contractor.naics !== 'N/A' && (
                      <span>NAICS: {contractor.naics.slice(0, 50)}{contractor.naics.length > 50 ? '...' : ''}</span>
                    )}
                    {contractor.agencies && contractor.agencies !== 'N/A' && (
                      <span>Agencies: {contractor.agencies.slice(0, 60)}{contractor.agencies.length > 60 ? '...' : ''}</span>
                    )}
                  </div>
                </div>

                {/* Contract Stats */}
                <div className="text-right shrink-0 min-w-[140px]">
                  <div className="text-xl font-bold text-emerald-400">
                    {formatCurrency(contractor.contract_value_num)}
                  </div>
                  <div className="text-xs text-slate-500">Total Contract Value</div>
                  <div className="text-lg font-semibold text-white mt-2">
                    {contractor.contract_count}
                  </div>
                  <div className="text-xs text-slate-500">Contracts</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 0 || searching}
            className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 5 + i;
              } else {
                pageNum = page - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  disabled={searching}
                  className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                    page === pageNum
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {pageNum + 1}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages - 1 || searching}
            className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}

      {/* Empty State */}
      {!searching && contractors.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="text-5xl mb-4">🏢</div>
          <h3 className="text-xl font-semibold text-white mb-2">No Contractors Found</h3>
          <p className="text-slate-400 mb-4">
            Try adjusting your search criteria or filters.
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setNaicsFilter('');
              setContactFilter('all');
              setPage(0);
              searchContractors('', '', 'all', 'contract_value', 0);
            }}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Quick Filters */}
      <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-800">
        <span className="text-xs text-slate-500 self-center mr-2">Quick searches:</span>
        {[
          { label: '🔒 Cybersecurity', naics: '541512' },
          { label: '📊 Management Consulting', naics: '541611' },
          { label: '🏗️ Engineering', naics: '541330' },
          { label: '💻 IT Services', naics: '541519' },
          { label: '📝 Professional Services', naics: '541990' },
        ].map(({ label, naics }) => (
          <button
            key={naics}
            onClick={() => {
              setNaicsFilter(naics);
              setPage(0);
              searchContractors(searchQuery, naics, contactFilter, sortBy, 0);
            }}
            className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700 hover:text-white transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
