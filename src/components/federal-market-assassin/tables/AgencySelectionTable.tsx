'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Agency, AlternativeSearchOption } from '@/types/federal-market-assassin';

interface AgencySelectionTableProps {
  agencies: Agency[];
  selectedAgencies: string[];
  onSelectionChange: (selected: string[]) => void;
  onGenerateReports: () => void;
  onBack: () => void;
  loading: boolean;
  alternativeSearches?: AlternativeSearchOption[];
  onAlternativeSearch?: (alternative: AlternativeSearchOption) => void;
}

interface CategorizedPainPoints {
  [category: string]: string[];
}

interface PainPointsApiResponse {
  success: boolean;
  agency: string;
  painPoints: string[];
  categorized: CategorizedPainPoints;
  ndaaPainPoints: string[];
  count: number;
}

type SortField = 'name' | 'spending' | 'contractCount';
type SortDirection = 'asc' | 'desc';

export default function AgencySelectionTable({
  agencies,
  selectedAgencies,
  onSelectionChange,
  onGenerateReports,
  onBack,
  loading,
  alternativeSearches,
  onAlternativeSearch,
}: AgencySelectionTableProps) {
  const [sortField, setSortField] = useState<SortField>('spending');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Modal state
  const [modalAgency, setModalAgency] = useState<Agency | null>(null);
  const [painPointsData, setPainPointsData] = useState<PainPointsApiResponse | null>(null);
  const [loadingPainPoints, setLoadingPainPoints] = useState(false);
  const [matchedCommand, setMatchedCommand] = useState<string | null>(null);
  const [additionalCommands, setAdditionalCommands] = useState<Array<{command: string, painPoints: PainPointsApiResponse}>>([]);

  const sortedAgencies = useMemo(() => {
    return [...agencies].sort((a, b) => {
      let comparison = 0;

      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'spending') {
        comparison = a.setAsideSpending - b.setAsideSpending;
      } else if (sortField === 'contractCount') {
        comparison = a.contractCount - b.contractCount;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [agencies, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleSelectAll = () => {
    onSelectionChange(agencies.map(a => a.id));
  };

  const handleSelectTop = (count: number) => {
    const topAgencies = sortedAgencies.slice(0, count).map(a => a.id);
    onSelectionChange(topAgencies);
  };

  const handleClearSelection = () => {
    onSelectionChange([]);
  };

  const toggleAgency = (agencyId: string) => {
    if (selectedAgencies.includes(agencyId)) {
      onSelectionChange(selectedAgencies.filter(id => id !== agencyId));
    } else {
      onSelectionChange([...selectedAgencies, agencyId]);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  };

  // Helper to extract DoD command abbreviations from agency names
  // Maps to exact database keys for pain points lookup
  const extractDoDCommands = (name: string): string[] => {
    const commands: string[] = [];
    const text = name.toUpperCase();

    // Navy commands (exact database keys)
    if (text.includes('NAVFAC') || text.includes('NAVAL FACILITIES')) commands.push('NAVFAC');
    if (text.includes('NAVSEA') || text.includes('NAVAL SEA SYSTEMS')) commands.push('NAVSEA');
    if (text.includes('NAVAIR') || text.includes('NAVAL AIR SYSTEMS')) commands.push('NAVAIR');
    if (text.includes('NAVWAR') || text.includes('SPAWAR') || text.includes('INFORMATION WARFARE')) commands.push('NAVWAR');
    if (text.includes('MARINE CORPS SYSTEMS')) commands.push('Marine Corps Systems Command');

    // Army commands (exact database keys)
    if (text.includes('USACE') || text.includes('CORPS OF ENGINEERS') || text.includes('ARMY CORPS')) commands.push('USACE');
    if (text.includes('ARMY CONTRACTING COMMAND') || (text.includes('ACC') && text.includes('ARMY'))) commands.push('Army Contracting Command');
    if (text.includes('ARMY MATERIEL COMMAND') || (text.includes('AMC') && text.includes('ARMY'))) commands.push('Army Materiel Command');

    // Air Force commands (exact database keys)
    if (text.includes('AIR FORCE MATERIEL') || text.includes('AFLCMC') || text.includes('LIFE CYCLE')) commands.push('Air Force Materiel Command');
    if (text.includes('AIR FORCE SUSTAINMENT') || text.includes('AFSC')) commands.push('Air Force Sustainment Center');
    if (text.includes('SPACE SYSTEMS COMMAND') || text.includes('SSC')) commands.push('Space Systems Command');

    // Defense agencies (exact database keys)
    if (text.includes('DISA') || text.includes('DEFENSE INFORMATION SYSTEMS')) commands.push('Defense Information Systems Agency');
    if (text.includes('DLA') || text.includes('DEFENSE LOGISTICS')) commands.push('Defense Logistics Agency');
    if (text.includes('DARPA') || text.includes('ADVANCED RESEARCH PROJECTS')) commands.push('DARPA');
    if (text.includes('MDA') || text.includes('MISSILE DEFENSE')) commands.push('Missile Defense Agency');
    if (text.includes('DCMA') || text.includes('DEFENSE CONTRACT MANAGEMENT')) commands.push('Defense Contract Management Agency');
    if (text.includes('DCAA') || text.includes('DEFENSE CONTRACT AUDIT')) commands.push('Defense Contract Audit Agency');
    if (text.includes('DHA') || text.includes('DEFENSE HEALTH')) commands.push('Defense Health Agency');

    return commands;
  };

  // Get all sub-commands for a parent agency
  const getSubCommandsForParent = (parentName: string): string[] => {
    const name = parentName.toUpperCase();
    if (name.includes('NAVY')) {
      return ['NAVSEA', 'NAVFAC', 'NAVAIR', 'NAVWAR', 'Marine Corps Systems Command'];
    }
    if (name.includes('ARMY')) {
      return ['USACE', 'Army Contracting Command', 'Army Materiel Command'];
    }
    if (name.includes('AIR FORCE')) {
      return ['Air Force Materiel Command', 'Air Force Sustainment Center', 'Space Systems Command'];
    }
    if (name.includes('DEFENSE') && !name.includes('DEPARTMENT')) {
      return ['Defense Logistics Agency', 'Defense Information Systems Agency', 'DARPA', 'Missile Defense Agency', 'Defense Health Agency'];
    }
    return [];
  };

  // Modal functions
  const openAgencyModal = useCallback(async (agency: Agency) => {
    setModalAgency(agency);
    setPainPointsData(null);
    setMatchedCommand(null);
    setAdditionalCommands([]);
    setLoadingPainPoints(true);

    try {
      // Build comprehensive search strategies
      const allTexts = [agency.name, agency.contractingOffice, agency.subAgency].filter(Boolean).join(' ');
      const extractedCommands = extractDoDCommands(allTexts);

      // First, try to find pain points for ALL extracted commands
      const commandResults: Array<{command: string, painPoints: PainPointsApiResponse}> = [];

      for (const command of extractedCommands) {
        try {
          const response = await fetch(`/api/pain-points?agency=${encodeURIComponent(command)}`);
          const data = await response.json();
          if (data.success && data.painPoints && data.painPoints.length > 0) {
            commandResults.push({ command, painPoints: data });
          }
        } catch (e) {
          console.error(`Error fetching pain points for ${command}:`, e);
        }
      }

      // If we found command-specific results, use those
      if (commandResults.length > 0) {
        setPainPointsData(commandResults[0].painPoints);
        setMatchedCommand(commandResults[0].command);
        setAdditionalCommands(commandResults.slice(1));
      } else {
        // No specific commands found - check if this is a parent agency
        // If so, fetch ALL sub-commands for that service branch
        const subCommands = getSubCommandsForParent(agency.name) ||
                          getSubCommandsForParent(agency.subAgency || '') ||
                          getSubCommandsForParent(agency.parentAgency || '');

        if (subCommands.length > 0) {
          // Fetch pain points for all sub-commands
          for (const command of subCommands) {
            try {
              const response = await fetch(`/api/pain-points?agency=${encodeURIComponent(command)}`);
              const data = await response.json();
              if (data.success && data.painPoints && data.painPoints.length > 0) {
                commandResults.push({ command, painPoints: data });
              }
            } catch (e) {
              console.error(`Error fetching pain points for ${command}:`, e);
            }
          }

          if (commandResults.length > 0) {
            setPainPointsData(commandResults[0].painPoints);
            setMatchedCommand(commandResults[0].command);
            setAdditionalCommands(commandResults.slice(1));
          }
        }

        // If still nothing, try the parent agency directly
        if (commandResults.length === 0) {
          const fallbackStrategies = [
            agency.subAgency,
            agency.parentAgency,
            agency.parentAgency?.replace('Department of the ', '').replace('Department of ', ''),
          ].filter(Boolean);

          for (const searchName of fallbackStrategies) {
            if (!searchName) continue;
            const response = await fetch(`/api/pain-points?agency=${encodeURIComponent(searchName)}`);
            const data = await response.json();
            if (data.success && data.painPoints && data.painPoints.length > 0) {
              setPainPointsData(data);
              setMatchedCommand(searchName);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading pain points:', error);
    } finally {
      setLoadingPainPoints(false);
    }
  }, []);

  const closeAgencyModal = useCallback(() => {
    setModalAgency(null);
    setPainPointsData(null);
    setMatchedCommand(null);
    setAdditionalCommands([]);
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalAgency) {
        closeAgencyModal();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [modalAgency, closeAgencyModal]);

  // Build SAM.gov search URL
  const getSamSearchUrl = (agencyName: string) => {
    const encoded = encodeURIComponent(agencyName);
    return `https://sam.gov/search/?index=opp&page=1&pageSize=25&sort=-modifiedDate&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&q=${encoded}`;
  };

  // Show alternative searches if no agencies found
  if (agencies.length === 0 && alternativeSearches && alternativeSearches.length > 0) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-slate-100 mb-2">
            Step 2: No Agencies Found
          </h2>
          <p className="text-slate-400 mb-4">
            We couldn&apos;t find any agencies matching your exact criteria. Try one of these expanded search options to find more results.
          </p>
        </div>

        {/* Alternative Search Options */}
        <div className="space-y-4 mb-6">
          <h3 className="text-xl font-semibold text-slate-200">Try These Expanded Searches:</h3>
          {alternativeSearches.map((alternative, index) => (
            <div
              key={index}
              className="border border-slate-600 rounded-lg p-4 hover:border-blue-500/50 hover:bg-slate-700/50 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-semibold text-slate-200 mb-1">
                    {alternative.label}
                  </h4>
                  <p className="text-sm text-slate-400 mb-2">
                    {alternative.description}
                  </p>
                  {alternative.estimatedResults !== undefined && alternative.estimatedResults > 0 && (
                    <p className="text-xs text-cyan-400 font-medium">
                      Estimated: ~{alternative.estimatedResults.toLocaleString()} results
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onAlternativeSearch?.(alternative)}
                  disabled={loading}
                  className="ml-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-600 text-white font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {loading ? 'Searching...' : 'Try This Search'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onBack}
          className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold rounded-lg transition-colors"
        >
          ← Back to Inputs
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-slate-100 mb-2">
          Step 2: Select Target Agencies
        </h2>
        <p className="text-slate-400">
          Found <strong className="text-cyan-400">{agencies.length}</strong> agencies matching your profile. Select which ones to include in your reports.
        </p>
      </div>

      {/* Action Bar - Sticky at top */}
      <div className="mb-4 p-4 bg-slate-900/50 border border-slate-600 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Back Button - Prominent */}
          <button
            onClick={onBack}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold rounded-lg transition-colors flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="w-px h-6 bg-slate-600"></div>
          <button
            onClick={() => handleSelectTop(10)}
            className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-semibold rounded-lg transition-colors border border-blue-500/30"
          >
            Top 10
          </button>
          <button
            onClick={() => handleSelectTop(20)}
            className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-semibold rounded-lg transition-colors border border-blue-500/30"
          >
            Top 20
          </button>
          <button
            onClick={handleSelectAll}
            className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-semibold rounded-lg transition-colors border border-blue-500/30"
          >
            All ({agencies.length})
          </button>
          <button
            onClick={handleClearSelection}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold rounded-lg transition-colors"
          >
            Clear
          </button>
          <span className="px-3 py-1.5 text-slate-300 font-semibold">
            Selected: <span className="text-cyan-400">{selectedAgencies.length}</span>
          </span>
        </div>

        <button
          onClick={onGenerateReports}
          disabled={selectedAgencies.length === 0 || loading}
          className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 text-white font-bold rounded-lg transition-all duration-200 flex items-center shadow-lg"
        >
          {loading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </>
          ) : (
            <>
              Generate Reports
              <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </>
          )}
        </button>
      </div>

      {/* Table - Limited height with scroll */}
      <div className="overflow-x-auto border border-slate-600 rounded-lg max-h-[400px] overflow-y-auto">
        <table className="w-full">
          <thead className="bg-slate-900 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedAgencies.length === agencies.length}
                  onChange={(e) => e.target.checked ? handleSelectAll() : handleClearSelection()}
                  className="w-4 h-4 text-blue-500 bg-slate-700 border-slate-500 rounded focus:ring-blue-500"
                />
              </th>
              <th
                onClick={() => handleSort('name')}
                className="px-4 py-3 text-left text-sm font-semibold text-slate-300 cursor-pointer hover:bg-slate-800"
              >
                <div className="flex items-center">
                  Agency Name
                  {sortField === 'name' && (
                    <span className="ml-2 text-cyan-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">
                Parent Agency
              </th>
              <th
                onClick={() => handleSort('spending')}
                className="px-4 py-3 text-left text-sm font-semibold text-slate-300 cursor-pointer hover:bg-slate-800"
              >
                <div className="flex items-center">
                  Set-Aside Spending
                  {sortField === 'spending' && (
                    <span className="ml-2 text-cyan-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => handleSort('contractCount')}
                className="px-4 py-3 text-left text-sm font-semibold text-slate-300 cursor-pointer hover:bg-slate-800"
              >
                <div className="flex items-center">
                  Contracts
                  {sortField === 'contractCount' && (
                    <span className="ml-2 text-cyan-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">
                Location
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAgencies.map((agency) => (
              <tr
                key={agency.id}
                className={`border-t border-slate-700 hover:bg-slate-700/50 cursor-pointer ${
                  selectedAgencies.includes(agency.id) ? 'bg-blue-500/20' : ''
                }`}
                onClick={() => toggleAgency(agency.id)}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedAgencies.includes(agency.id)}
                    onChange={() => toggleAgency(agency.id)}
                    className="w-4 h-4 text-blue-500 bg-slate-700 border-slate-500 rounded focus:ring-blue-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-200">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openAgencyModal(agency);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') openAgencyModal(agency);
                    }}
                    className="text-left text-cyan-400 hover:text-cyan-300 hover:underline font-semibold transition-colors cursor-pointer"
                  >
                    {agency.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {agency.parentAgency}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-emerald-400">
                  {formatCurrency(agency.setAsideSpending)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {agency.contractCount}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {agency.location}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Agency Details Modal */}
      {modalAgency && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={closeAgencyModal}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-100">{modalAgency.name}</h2>
              <button
                onClick={closeAgencyModal}
                className="text-slate-400 hover:text-slate-200 text-3xl font-bold leading-none"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Key Statistics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Set-Aside Spending</div>
                  <div className="text-2xl font-bold text-blue-400">{formatCurrency(modalAgency.setAsideSpending)}</div>
                </div>
                <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Total Contracts</div>
                  <div className="text-2xl font-bold text-slate-200">{modalAgency.contractCount}</div>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Location</div>
                  <div className="text-lg font-bold text-emerald-400">{modalAgency.location || 'N/A'}</div>
                </div>
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Office ID</div>
                  <div className="text-lg font-bold text-purple-400">{modalAgency.officeId || modalAgency.subAgencyCode || 'N/A'}</div>
                </div>
              </div>

              {/* Office Information */}
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-200 mb-4">Office Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-slate-500">Contracting Office</div>
                    <div className="text-base font-semibold text-slate-200">{modalAgency.contractingOffice || modalAgency.name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Sub-Agency</div>
                    <div className="text-base font-semibold text-slate-200">{modalAgency.subAgency || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Parent Agency</div>
                    <div className="text-base font-semibold text-slate-200">{modalAgency.parentAgency}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Location</div>
                    <div className="text-base text-slate-200">{modalAgency.location || 'Not specified'}</div>
                  </div>
                </div>
              </div>

              {/* Quick Links */}
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-cyan-300 mb-4">Market Research Links</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <a
                    href={getSamSearchUrl(modalAgency.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition border border-slate-600"
                  >
                    <div>
                      <div className="font-semibold text-slate-200">SAM.gov Opportunities</div>
                      <div className="text-sm text-slate-400">Search active contracts</div>
                    </div>
                    <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <a
                    href={`https://www.usaspending.gov/search/?hash=9f9d37c8e3a1b0f2d5c6a7b8e9f0a1b2`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition border border-slate-600"
                  >
                    <div>
                      <div className="font-semibold text-slate-200">USAspending.gov</div>
                      <div className="text-sm text-slate-400">View spending history</div>
                    </div>
                    <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Agency Pain Points */}
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-purple-300 mb-3">Agency Priorities & Pain Points</h3>
                {loadingPainPoints ? (
                  <p className="text-sm text-purple-400">Loading agency insights...</p>
                ) : painPointsData && painPointsData.painPoints && painPointsData.painPoints.length > 0 ? (
                  <div className="space-y-4">
                    {/* Show which command was matched */}
                    {matchedCommand && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-3 py-1 bg-purple-500 text-white text-sm font-bold rounded-full">
                          {matchedCommand}
                        </span>
                        <span className="text-xs text-purple-400">
                          {painPointsData.painPoints.length} priorities identified
                        </span>
                      </div>
                    )}
                    {/* Show categorized pain points if available */}
                    {painPointsData.categorized && Object.keys(painPointsData.categorized).length > 0 ? (
                      Object.entries(painPointsData.categorized).map(([category, points]) => (
                        points && points.length > 0 && (
                          <div key={category}>
                            <h4 className="font-semibold text-purple-300 mb-2 capitalize">{category}</h4>
                            <ul className="space-y-2 text-sm text-slate-300">
                              {points.map((painPoint, index) => (
                                <li key={index} className="flex items-start">
                                  <span className="text-purple-400 mr-2">•</span>
                                  <span className="flex-1">{painPoint}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      ))
                    ) : (
                      /* Fallback: show raw pain points if categorized is empty */
                      <div>
                        <h4 className="font-semibold text-purple-300 mb-2">Key Priorities</h4>
                        <ul className="space-y-2 text-sm text-slate-300">
                          {painPointsData.painPoints.map((painPoint, index) => (
                            <li key={index} className="flex items-start">
                              <span className="text-purple-400 mr-2">•</span>
                              <span className="flex-1">{painPoint}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* NDAA Pain Points */}
                    {painPointsData.ndaaPainPoints && painPointsData.ndaaPainPoints.length > 0 && (
                      <div className="pt-4 border-t border-purple-500/30">
                        <h4 className="font-semibold text-purple-300 mb-2">NDAA Priorities</h4>
                        <ul className="space-y-2 text-sm text-slate-400">
                          {painPointsData.ndaaPainPoints.map((painPoint, index) => (
                            <li key={index} className="flex items-start">
                              <span className="text-purple-400 mr-2">•</span>
                              <span>{painPoint}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Show additional commands if found */}
                    {additionalCommands.length > 0 && (
                      <div className="pt-4 border-t border-purple-500/30 space-y-4">
                        <h4 className="font-semibold text-purple-300">Related Commands</h4>
                        {additionalCommands.map((cmd, cmdIdx) => (
                          <div key={cmdIdx} className="bg-slate-900/50 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-1 bg-indigo-500 text-white text-xs font-bold rounded">
                                {cmd.command}
                              </span>
                              <span className="text-xs text-indigo-400">
                                {cmd.painPoints.painPoints.length} priorities
                              </span>
                            </div>
                            <ul className="space-y-1 text-sm text-slate-300">
                              {cmd.painPoints.painPoints.slice(0, 3).map((pp, ppIdx) => (
                                <li key={ppIdx} className="flex items-start">
                                  <span className="text-indigo-400 mr-2">•</span>
                                  <span className="flex-1">{pp}</span>
                                </li>
                              ))}
                              {cmd.painPoints.painPoints.length > 3 && (
                                <li className="text-xs text-indigo-400 italic">
                                  +{cmd.painPoints.painPoints.length - 3} more priorities...
                                </li>
                              )}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-purple-400 italic">
                    Agency priorities data not available for this office yet. Check the office website for current priorities.
                  </p>
                )}
              </div>

              {/* Market Research Tips */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-amber-300 mb-3">Market Research Tips</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>• Check SAM.gov for active opportunities from this office</li>
                  <li>• Research this office&apos;s typical contract sizes and durations</li>
                  <li>• Identify past awardees to understand competition</li>
                  <li>• Look for upcoming solicitations in your NAICS code</li>
                  <li>• Align your capabilities with the agency priorities shown above</li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  onClick={closeAgencyModal}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200 font-medium transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    if (!selectedAgencies.includes(modalAgency.id)) {
                      onSelectionChange([...selectedAgencies, modalAgency.id]);
                    }
                    closeAgencyModal();
                  }}
                  className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                    selectedAgencies.includes(modalAgency.id)
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  {selectedAgencies.includes(modalAgency.id) ? '✓ Selected' : 'Add to Selection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
