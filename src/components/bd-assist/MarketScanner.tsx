'use client';

import { useState } from 'react';

interface MarketScannerProps {
  email?: string;
  initialNaics?: string;
  initialState?: string;
}

interface Agency {
  name: string;
  annualSpend: number;
  department: string;
}

// Format currency for display
function formatCurrency(amount: number | string): string {
  if (typeof amount === 'string') return amount;
  if (!amount || amount === 0) return '$0';
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

interface ProcurementMethod {
  method: string;
  percentage: number;
  action?: string;
}

interface Incumbent {
  company: string;
  agency?: string;
  contractValue: number;
  expirationDate: string;
  setAside?: string;
  isRecompete?: boolean;
  daysUntilExpiration?: number;
}

interface AvailableOpportunity {
  source: string;
  count: number;
  url?: string;
}

interface Event {
  name: string;
  date: string;
  location?: string;
  type: string;
  url?: string;
}

interface Contact {
  name: string;
  title: string;
  email?: string;
  phone?: string;
  agency?: string;
}

interface ScanResult {
  input: {
    naics: string;
    naicsDescription: string;
    state: string;
    stateName: string;
  };
  whoIsBuying: {
    agencies: Agency[];
    totalSpend: number | string;
    topBuyer?: string;
    concentration?: string;
  };
  howAreTheyBuying: {
    breakdown: ProcurementMethod[];
    visibilityGap?: string;
  };
  whoHasItNow: {
    incumbents: Incumbent[];
    totalRecompetes: number;
  };
  whatIsAvailable: {
    samGov: AvailableOpportunity;
    grantsGov: AvailableOpportunity;
    gsaEbuy: AvailableOpportunity;
    forecasts: AvailableOpportunity;
  };
  whatEvents: Event[];
  whoToTalkTo: {
    osdubuContacts: Contact[];
    sbSpecialists: Contact[];
    contractingOfficers: Contact[];
    teamingPartners: Contact[];
  };
  generatedAt: string;
  processingTimeMs: number;
}

// State codes with display names
const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }
];

export default function MarketScanner({ email, initialNaics = '', initialState = '' }: MarketScannerProps) {
  const [naics, setNaics] = useState(initialNaics);
  const [state, setState] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['whoIsBuying']));

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const handleScan = async () => {
    if (!naics.trim()) {
      setError('Please enter a valid NAICS code');
      return;
    }

    if (naics.length < 5 || naics.length > 6 || !/^\d+$/.test(naics)) {
      setError('Please enter a valid 5-6 digit NAICS code');
      return;
    }

    if (!state) {
      setError('Please select a state');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const params = new URLSearchParams({ naics, state });
      if (email) params.append('email', email);

      const response = await fetch(`/api/market-scanner?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to scan market');
      }

      setResult(data);
      // Auto-expand first section
      setExpandedSections(new Set(['whoIsBuying']));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan market. Please try again.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Federal Market Scanner</h1>
        <p className="text-gray-400">Complete market intelligence in one scan</p>
      </div>

      {/* Input Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="naics" className="block text-sm font-medium text-gray-300 mb-2">
              NAICS Code
            </label>
            <input
              type="text"
              id="naics"
              value={naics}
              onChange={(e) => setNaics(e.target.value.replace(/\D/g, ''))}
              placeholder="238220"
              maxLength={6}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="state" className="block text-sm font-medium text-gray-300 mb-2">
              State
            </label>
            <select
              id="state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-blue-500 focus:outline-none appearance-none"
            >
              <option value="">Select state...</option>
              {US_STATES.map(s => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleScan}
              disabled={loading}
              className="w-full px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Scanning...
                </>
              ) : (
                <>
                  <span className="text-lg">🔍</span>
                  SCAN
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 relative">
            <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-gray-400 text-lg">Scanning market...</p>
          <p className="text-gray-600 text-sm mt-2">Analyzing agencies, incumbents, and opportunities</p>
        </div>
      )}

      {/* Results Display */}
      {!loading && result && (
        <div className="space-y-4">
          {/* Result Header */}
          <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-lg p-4">
            <h2 className="text-xl font-bold text-white mb-1">
              {result.input.naicsDescription} in {result.input.stateName}
            </h2>
            <p className="text-gray-400 text-sm">
              NAICS {result.input.naics} • Generated {new Date(result.generatedAt).toLocaleString()}
            </p>
          </div>

          {/* Section 1: WHO IS BUYING? */}
          <SectionCard
            title="WHO IS BUYING?"
            icon="💰"
            color="blue"
            expanded={expandedSections.has('whoIsBuying')}
            onToggle={() => toggleSection('whoIsBuying')}
          >
            <div className="space-y-3">
              {result.whoIsBuying.agencies.length > 0 ? (
                result.whoIsBuying.agencies.map((agency, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <div className="flex-1">
                      <span className="text-white font-medium">{agency.name}</span>
                      {agency.department && (
                        <span className="text-gray-500 text-sm ml-2">({agency.department})</span>
                      )}
                    </div>
                    <span className="text-green-400 font-semibold">{formatCurrency(agency.annualSpend)}/year</span>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-4">No spending data found for this NAICS/state combination. Try a different state or broader NAICS code.</p>
              )}
              <div className="pt-3 border-t-2 border-blue-500/30 flex justify-between items-center">
                <span className="text-gray-400 font-medium">Total Market</span>
                <span className="text-green-400 font-bold text-lg">{formatCurrency(result.whoIsBuying.totalSpend)}/year</span>
              </div>
              {result.whoIsBuying.topBuyer && result.whoIsBuying.topBuyer !== 'Unknown' && (
                <p className="text-sm text-gray-400">
                  Top buyer: <span className="text-blue-400">{result.whoIsBuying.topBuyer}</span>
                </p>
              )}
            </div>
          </SectionCard>

          {/* Section 2: HOW ARE THEY BUYING? */}
          <SectionCard
            title="HOW ARE THEY BUYING?"
            icon="🛒"
            color="purple"
            expanded={expandedSections.has('howAreTheyBuying')}
            onToggle={() => toggleSection('howAreTheyBuying')}
          >
            <div className="space-y-4">
              {result.howAreTheyBuying.breakdown.map((method, idx) => (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1">
                      <span className="text-white font-medium">{method.method}</span>
                      {method.action && (
                        <span className="ml-2 text-xs text-purple-400">({method.action})</span>
                      )}
                    </div>
                    <span className="text-purple-400 font-semibold">{method.percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-purple-500 rounded-full h-2 transition-all"
                      style={{ width: `${method.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
              {result.howAreTheyBuying.visibilityGap && (
                <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
                  <strong>Visibility Gap:</strong> {result.howAreTheyBuying.visibilityGap}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Section 3: WHO HAS IT NOW? */}
          <SectionCard
            title="WHO HAS IT NOW?"
            icon="🏢"
            color="amber"
            expanded={expandedSections.has('whoHasItNow')}
            onToggle={() => toggleSection('whoHasItNow')}
          >
            <div className="space-y-3">
              {result.whoHasItNow.incumbents.map((incumbent, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${
                    incumbent.isRecompete
                      ? 'bg-amber-900/20 border-amber-500/50'
                      : 'bg-gray-800 border-gray-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="text-white font-semibold">{incumbent.company}</h4>
                      {incumbent.agency && (
                        <span className="text-xs text-violet-400">{incumbent.agency}</span>
                      )}
                      {incumbent.setAside && (
                        <span className="text-xs text-gray-400 ml-2">• {incumbent.setAside}</span>
                      )}
                    </div>
                    {incumbent.isRecompete && (
                      <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded">
                        RECOMPETE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400">
                      ${(incumbent.contractValue / 1000000).toFixed(1)}M
                    </span>
                    <span className="text-gray-500">
                      Expires: {incumbent.expirationDate}
                      {incumbent.daysUntilExpiration !== undefined && (
                        <span className={`ml-2 ${incumbent.daysUntilExpiration <= 90 ? 'text-red-400' : incumbent.daysUntilExpiration <= 180 ? 'text-amber-400' : ''}`}>
                          ({incumbent.daysUntilExpiration} days)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
              {result.whoHasItNow.totalRecompetes > 0 && (
                <div className="pt-3 border-t border-amber-500/30 text-amber-400 font-semibold text-center">
                  {result.whoHasItNow.totalRecompetes} recompete opportunity{result.whoHasItNow.totalRecompetes !== 1 ? 'es' : ''} expiring within 18 months
                </div>
              )}
            </div>
          </SectionCard>

          {/* Section 4: WHAT'S AVAILABLE NOW? */}
          <SectionCard
            title="WHAT'S AVAILABLE NOW?"
            icon="📋"
            color="green"
            expanded={expandedSections.has('whatIsAvailable')}
            onToggle={() => toggleSection('whatIsAvailable')}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <OpportunitySource
                source="SAM.gov"
                count={result.whatIsAvailable.samGov.count}
                url={`https://sam.gov/search/?index=opp&naics=${result.input.naics}`}
              />
              <OpportunitySource
                source="Grants.gov"
                count={result.whatIsAvailable.grantsGov.count}
                url="https://grants.gov/search-grants"
              />
              <OpportunitySource
                source="GSA eBuy"
                count={result.whatIsAvailable.gsaEbuy.count}
                url="https://www.ebuy.gsa.gov/"
              />
              <OpportunitySource
                source="Agency Forecasts"
                count={result.whatIsAvailable.forecasts.count}
                url="https://tools.govcongiants.org/forecasts"
              />
            </div>
          </SectionCard>

          {/* Section 5: WHAT EVENTS? */}
          <SectionCard
            title="WHAT EVENTS?"
            icon="📅"
            color="cyan"
            expanded={expandedSections.has('whatEvents')}
            onToggle={() => toggleSection('whatEvents')}
          >
            {result.whatEvents.length > 0 ? (
              <div className="space-y-3">
                {result.whatEvents.map((event, idx) => (
                  <div key={idx} className="p-3 bg-gray-800 border border-gray-700 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="text-white font-semibold flex-1">{event.name}</h4>
                      <span className="px-2 py-1 bg-cyan-500/20 text-cyan-400 text-xs rounded">
                        {event.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span>📅 {event.date}</span>
                      {event.location && <span>📍 {event.location}</span>}
                    </div>
                    {event.url && (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 text-sm mt-2 inline-block"
                      >
                        Register / Info →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No upcoming events found for this market</p>
            )}
          </SectionCard>

          {/* Section 6: WHO TO TALK TO? */}
          <SectionCard
            title="WHO TO TALK TO?"
            icon="👥"
            color="indigo"
            expanded={expandedSections.has('whoToTalkTo')}
            onToggle={() => toggleSection('whoToTalkTo')}
          >
            <div className="space-y-6">
              {result.whoToTalkTo.osdubuContacts.length > 0 && (
                <ContactGroup
                  title="OSBDU Contacts"
                  contacts={result.whoToTalkTo.osdubuContacts}
                />
              )}
              {result.whoToTalkTo.sbSpecialists.length > 0 && (
                <ContactGroup
                  title="Small Business Specialists"
                  contacts={result.whoToTalkTo.sbSpecialists}
                />
              )}
              {result.whoToTalkTo.contractingOfficers.length > 0 && (
                <ContactGroup
                  title="Contracting Officers"
                  contacts={result.whoToTalkTo.contractingOfficers}
                />
              )}
              {result.whoToTalkTo.teamingPartners.length > 0 && (
                <ContactGroup
                  title="Potential Teaming Partners"
                  contacts={result.whoToTalkTo.teamingPartners}
                />
              )}
            </div>
          </SectionCard>

          {/* Export Actions */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h3 className="text-white font-semibold mb-4">Export Report</h3>
            <div className="flex flex-wrap gap-3">
              <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors flex items-center gap-2">
                <span>📄</span>
                Export as PDF
              </button>
              <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors flex items-center gap-2">
                <span>📊</span>
                Export as CSV
              </button>
              <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors flex items-center gap-2">
                <span>📧</span>
                Email Report
              </button>
            </div>
          </div>

          {/* Processing Time */}
          <div className="text-center text-gray-600 text-sm">
            Scan completed in {result.processingTimeMs}ms
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !result && !error && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-12 text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-white mb-2">Ready to Scan</h3>
          <p className="text-gray-400">
            Enter a NAICS code and state to get complete market intelligence
          </p>
        </div>
      )}
    </div>
  );
}

interface SectionCardProps {
  title: string;
  icon: string;
  color: 'blue' | 'purple' | 'amber' | 'green' | 'cyan' | 'indigo';
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function SectionCard({ title, icon, color, expanded, onToggle, children }: SectionCardProps) {
  const colorClasses = {
    blue: 'border-blue-500/50 bg-blue-900/20',
    purple: 'border-purple-500/50 bg-purple-900/20',
    amber: 'border-amber-500/50 bg-amber-900/20',
    green: 'border-green-500/50 bg-green-900/20',
    cyan: 'border-cyan-500/50 bg-cyan-900/20',
    indigo: 'border-indigo-500/50 bg-indigo-900/20',
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${colorClasses[color]}`}>
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <h3 className="text-lg font-bold text-white">{title}</h3>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="p-4 border-t border-gray-800">
          {children}
        </div>
      )}
    </div>
  );
}

interface OpportunitySourceProps {
  source: string;
  count: number;
  url?: string;
}

function OpportunitySource({ source, count, url }: OpportunitySourceProps) {
  const content = (
    <div className="p-4 bg-gray-800 border border-gray-700 rounded-lg hover:border-green-500/50 transition-colors">
      <div className="text-2xl font-bold text-green-400 mb-1">{count}</div>
      <div className="text-sm text-gray-300">{source}</div>
    </div>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }

  return content;
}

interface ContactGroupProps {
  title: string;
  contacts: Contact[];
}

function ContactGroup({ title, contacts }: ContactGroupProps) {
  return (
    <div>
      <h4 className="text-indigo-400 font-semibold mb-3 text-sm uppercase tracking-wide">{title}</h4>
      <div className="space-y-3">
        {contacts.map((contact, idx) => (
          <div key={idx} className="p-3 bg-gray-800 border border-gray-700 rounded-lg">
            <div className="font-semibold text-white">{contact.name}</div>
            <div className="text-sm text-gray-400 mb-2">{contact.title}</div>
            {contact.agency && (
              <div className="text-xs text-gray-500 mb-2">{contact.agency}</div>
            )}
            <div className="flex flex-wrap gap-3 text-sm">
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <span>📧</span>
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <span>📞</span>
                  {contact.phone}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
