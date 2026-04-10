'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import MarketIntelligenceHeader from '@/components/briefings/MarketIntelligenceHeader';
import OnboardingWizard from '@/components/briefings/OnboardingWizard';
import SettingsPanel from '@/components/briefings/SettingsPanel';

interface QuickStat {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
}

interface BriefingItemFormatted {
  id: string;
  rank: number;
  category: string;
  categoryIcon: string;
  title: string;
  subtitle: string;
  description: string;
  urgencyBadge?: string;
  amount?: string;
  deadline?: string;
  actionUrl: string;
  actionLabel: string;
  signals: string[];
}

interface BriefingSection {
  title: string;
  items: BriefingItemFormatted[];
}

interface GeneratedBriefing {
  id: string;
  generatedAt: string;
  briefingDate: string;
  summary: {
    headline: string;
    subheadline: string;
    quickStats: QuickStat[];
    urgentAlerts: number;
  };
  topItems: BriefingSection[];
  categorizedItems: Record<string, BriefingSection>;
  totalItems: number;
  sourcesIncluded: string[];
}

interface BriefingEntry {
  briefing_date: string;
  generated_at: string;
  items_count: number;
  content: GeneratedBriefing;
}

interface LegacyAIBriefing {
  id?: string;
  generatedAt?: string;
  briefingDate?: string;
  opportunities?: Array<{
    rank?: number;
    agency?: string;
    contractName?: string;
    incumbent?: string;
    displacementAngle?: string;
    value?: string;
    window?: string;
  }>;
  teamingPlays?: Array<{
    playNumber?: number;
    strategyName?: string;
    rationale?: string;
    targetPrimes?: string[];
    suggestedOpener?: string;
  }>;
}

function isGeneratedBriefing(value: unknown): value is GeneratedBriefing {
  if (!value || typeof value !== 'object') return false;
  return 'summary' in value && 'topItems' in value;
}

function normalizeBriefing(raw: unknown, fallbackDate: string, fallbackGeneratedAt: string): GeneratedBriefing {
  if (isGeneratedBriefing(raw)) {
    return raw;
  }

  const legacy = (raw || {}) as LegacyAIBriefing;
  const opportunities = legacy.opportunities || [];
  const teamingPlays = legacy.teamingPlays || [];

  const topOpportunityItems: BriefingItemFormatted[] = opportunities.map((opp, index) => ({
    id: `opportunity-${index + 1}`,
    rank: opp.rank || index + 1,
    category: 'Opportunity',
    categoryIcon: '📄',
    title: opp.contractName || `Opportunity ${index + 1}`,
    subtitle: `${opp.agency || 'Federal agency'}${opp.incumbent ? ` • Incumbent: ${opp.incumbent}` : ''}`,
    description: opp.displacementAngle || 'Opportunity identified from your briefing pipeline.',
    urgencyBadge: index < 3 ? 'HIGH' : undefined,
    amount: opp.value,
    deadline: opp.window,
    actionUrl: '/briefings',
    actionLabel: 'View briefing workspace',
    signals: [opp.agency, opp.incumbent].filter(Boolean) as string[],
  }));

  const teamingItems: BriefingItemFormatted[] = teamingPlays.map((play, index) => ({
    id: `teaming-${index + 1}`,
    rank: play.playNumber || index + 1,
    category: 'Teaming Play',
    categoryIcon: '🤝',
    title: play.strategyName || `Teaming Play ${index + 1}`,
    subtitle: play.targetPrimes?.length ? `Targets: ${play.targetPrimes.join(', ')}` : 'Suggested teaming move',
    description: play.rationale || play.suggestedOpener || 'Recommended teaming move from your briefing.',
    actionUrl: '/briefings',
    actionLabel: 'Open briefing workspace',
    signals: play.targetPrimes || [],
  }));

  return {
    id: legacy.id || `legacy-${fallbackDate}`,
    generatedAt: legacy.generatedAt || fallbackGeneratedAt,
    briefingDate: legacy.briefingDate || fallbackDate,
    summary: {
      headline: opportunities.length > 0 ? `${opportunities.length} opportunities identified` : 'Market intelligence briefing',
      subheadline: teamingPlays.length > 0
        ? `${teamingPlays.length} teaming plays surfaced from your latest briefing`
        : 'Your latest market intelligence briefing is ready.',
      quickStats: [
        { label: 'Opportunities', value: opportunities.length },
        { label: 'Teaming Plays', value: teamingPlays.length },
      ],
      urgentAlerts: Math.min(3, opportunities.length),
    },
    topItems: [
      {
        title: 'Top Opportunities',
        items: topOpportunityItems.slice(0, 5),
      },
    ],
    categorizedItems: {
      opportunities: {
        title: 'All Opportunities',
        items: topOpportunityItems,
      },
      teaming: {
        title: 'Teaming Plays',
        items: teamingItems,
      },
    },
    totalItems: topOpportunityItems.length + teamingItems.length,
    sourcesIncluded: ['Briefing Log'],
  };
}

type PageStatus = 'loading' | 'gate' | 'verifying' | 'onboarding' | 'denied' | 'ready';

type FilterType = 'all' | 'urgent' | 'opportunity' | 'teaming';

export default function BriefingsDashboard() {
  const [email, setEmail] = useState('');
  const [inputEmail, setInputEmail] = useState('');
  const [status, setStatus] = useState<PageStatus>('gate');
  const [briefings, setBriefings] = useState<BriefingEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [linkSending, setLinkSending] = useState(false);
  const [linkMessage, setLinkMessage] = useState('');
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const selectedBriefing = briefings.find(b => b.briefing_date === selectedDate)?.content ?? null;

  // Filter items based on search term and active filter
  const filterItems = useCallback((items: BriefingItemFormatted[]): BriefingItemFormatted[] => {
    let filtered = items;

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.title.toLowerCase().includes(term) ||
        item.subtitle.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.signals.some(s => s.toLowerCase().includes(term))
      );
    }

    // Apply category filter
    if (activeFilter !== 'all') {
      filtered = filtered.filter(item => {
        if (activeFilter === 'urgent') {
          return item.urgencyBadge === 'URGENT' || item.urgencyBadge === 'HIGH';
        }
        if (activeFilter === 'opportunity') {
          return item.category === 'Opportunity';
        }
        if (activeFilter === 'teaming') {
          return item.category === 'Teaming Play';
        }
        return true;
      });
    }

    return filtered;
  }, [searchTerm, activeFilter]);

  // Get filtered counts for badges
  const getFilteredCounts = useCallback(() => {
    if (!selectedBriefing) return { all: 0, urgent: 0, opportunity: 0, teaming: 0 };

    const allItems = [
      ...selectedBriefing.topItems.flatMap(s => s.items),
      ...Object.values(selectedBriefing.categorizedItems).flatMap(s => s.items),
    ];

    // Dedupe by id
    const uniqueItems = Array.from(new Map(allItems.map(i => [i.id, i])).values());

    return {
      all: uniqueItems.length,
      urgent: uniqueItems.filter(i => i.urgencyBadge === 'URGENT' || i.urgencyBadge === 'HIGH').length,
      opportunity: uniqueItems.filter(i => i.category === 'Opportunity').length,
      teaming: uniqueItems.filter(i => i.category === 'Teaming Play').length,
    };
  }, [selectedBriefing]);

  const filterCounts = getFilteredCounts();

  // Export functions
  const exportToCSV = useCallback(() => {
    if (!selectedBriefing) return;

    const allItems = [
      ...selectedBriefing.topItems.flatMap(s => s.items),
      ...Object.values(selectedBriefing.categorizedItems).flatMap(s => s.items),
    ];
    const uniqueItems = Array.from(new Map(allItems.map(i => [i.id, i])).values());
    const filtered = filterItems(uniqueItems);

    const headers = ['Rank', 'Category', 'Title', 'Agency/Subtitle', 'Description', 'Amount', 'Deadline', 'Urgency', 'Signals'];
    const rows = filtered.map(item => [
      item.rank,
      item.category,
      item.title,
      item.subtitle,
      item.description,
      item.amount || '',
      item.deadline || '',
      item.urgencyBadge || '',
      item.signals.join('; '),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `briefing-${selectedBriefing.briefingDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [selectedBriefing, filterItems]);

  const exportToPrint = useCallback(() => {
    window.print();
  }, []);

  // Check if user has completed their profile (has NAICS codes)
  const checkProfileComplete = useCallback(async (userEmail: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(userEmail)}`);
      const data = await res.json();
      if (data.success && data.data) {
        const naicsCodes = data.data.naicsCodes || [];
        return naicsCodes.length > 0;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const fetchBriefings = useCallback(async (userEmail: string) => {
    const res = await fetch(`/api/briefings/latest?email=${encodeURIComponent(userEmail)}&days=30`);
    if (res.status === 403) {
      localStorage.removeItem('briefings_access_email');
      setStatus('denied');
      return;
    }
    const data = await res.json();
    if (!data.success) {
      setStatus('denied');
      return;
    }

    const entries: BriefingEntry[] = (data.briefings || []).map((entry: {
      briefing_date: string;
      generated_at: string;
      items_count: number;
      content: unknown;
    }) => ({
      ...entry,
      content: normalizeBriefing(entry.content, entry.briefing_date, entry.generated_at),
    }));
    // Single briefing response (days=1 fallback)
    if (data.briefing && !data.briefings) {
      entries.push({
        briefing_date: data.briefing_date,
        generated_at: data.generated_at,
        items_count: data.briefing?.totalItems || 0,
        content: normalizeBriefing(data.briefing, data.briefing_date, data.generated_at),
      });
    }

    setBriefings(entries);
    if (entries.length > 0) {
      setSelectedDate(entries[0].briefing_date);
    }
    setEmail(userEmail);
    localStorage.setItem('briefings_access_email', userEmail);
    setStatus('ready');
  }, []);

  const verifyAndLoadUser = useCallback(async (userEmail: string) => {
    setStatus('verifying');

    try {
      // First check access
      const response = await fetch('/api/briefings/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail }),
      });
      const data = await response.json();

      if (!data.hasAccess) {
        localStorage.removeItem('briefings_access_email');
        setStatus('denied');
        return;
      }

      // Check if profile is complete
      const profileComplete = await checkProfileComplete(userEmail);

      if (!profileComplete) {
        setEmail(userEmail);
        localStorage.setItem('briefings_access_email', userEmail);
        setStatus('onboarding');
        return;
      }

      // Profile complete, load briefings
      await fetchBriefings(userEmail);
    } catch {
      setStatus('gate');
    }
  }, [checkProfileComplete, fetchBriefings]);

  // On mount, check localStorage
  useEffect(() => {
    const saved = localStorage.getItem('briefings_access_email');
    if (!saved) {
      return;
    }
    void verifyAndLoadUser(saved);
  }, [verifyAndLoadUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputEmail.toLowerCase().trim();
    if (!trimmed) return;
    setError('');
    await verifyAndLoadUser(trimmed);
  };

  const handleSendSecureLink = async () => {
    const trimmed = inputEmail.toLowerCase().trim();
    if (!trimmed) {
      setError('Enter your email first so we can send the secure link.');
      return;
    }

    setLinkSending(true);
    setLinkMessage('');
    setError('');

    try {
      const response = await fetch('/api/access-links/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, destination: 'briefings' }),
      });
      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Could not send secure link.');
        return;
      }

      setLinkMessage('Secure link sent. Check your email to open your briefings.');
    } catch {
      setError('Could not send secure link. Please try again.');
    } finally {
      setLinkSending(false);
    }
  };

  const handleOnboardingComplete = async () => {
    // After onboarding, fetch briefings
    await fetchBriefings(email);
  };

  const handleSwitchAccount = () => {
    localStorage.removeItem('briefings_access_email');
    setStatus('gate');
    setEmail('');
    setBriefings([]);
    setInputEmail('');
  };

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatDateLong = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  // --- Loading State ---
  if (status === 'loading' || status === 'verifying') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">MI</span>
          </div>
          <div className="text-gray-400 text-lg">Loading your briefings...</div>
        </div>
      </div>
    );
  }

  // --- Email Gate with Market Intelligence Branding ---
  if (status === 'gate') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          {/* Header branding */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <span className="text-white font-bold text-2xl">MI</span>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Market Intelligence</h1>
            <p className="text-purple-400">Your personalized GovCon briefings</p>
          </div>

          {/* Features list */}
          <div className="mb-8 space-y-3">
            <div className="flex items-center gap-3 text-gray-300">
              <span className="w-6 h-6 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400 text-sm">✓</span>
              <span>Daily Brief — prioritized opportunities</span>
            </div>
            <div className="flex items-center gap-3 text-gray-300">
              <span className="w-6 h-6 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400 text-sm">✓</span>
              <span>Weekly Deep Dive — strategic analysis</span>
            </div>
            <div className="flex items-center gap-3 text-gray-300">
              <span className="w-6 h-6 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400 text-sm">✓</span>
              <span>Pursuit Brief — capture guidance</span>
            </div>
          </div>

          {/* Login form */}
          <div className="p-6 bg-gray-900 border border-gray-800 rounded-2xl">
            <form onSubmit={handleSubmit}>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Enter your email
              </label>
              <input
                type="email"
                id="email"
                value={inputEmail}
                onChange={(e) => setInputEmail(e.target.value)}
                required
                className="w-full p-3 mb-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                placeholder="you@example.com"
              />
              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
              <button
                type="submit"
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors"
              >
                View My Briefings
              </button>
            </form>
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleSendSecureLink}
                disabled={linkSending}
                className="text-sm text-purple-400 hover:text-purple-300 disabled:opacity-50"
              >
                {linkSending ? 'Sending secure link...' : 'Email me a secure access link'}
              </button>
            </div>
            {linkMessage ? <p className="text-green-400 text-sm mt-3 text-center">{linkMessage}</p> : null}
          </div>

          <p className="text-gray-500 text-sm mt-6 text-center">
            Don&apos;t have access?{' '}
            <Link href="/market-intelligence" className="text-purple-400 hover:underline">
              View pricing
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // --- Onboarding Wizard ---
  if (status === 'onboarding') {
    return <OnboardingWizard email={email} onComplete={handleOnboardingComplete} />;
  }

  // --- Access Denied ---
  if (status === 'denied') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full p-8 bg-gray-900 border border-gray-800 rounded-2xl text-center">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">MI</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">No Access Found</h1>
          <p className="text-gray-400 mb-6">
            Market Intelligence includes daily briefs, weekly deep dives, and pursuit briefs.
            Purchase access to unlock your personalized GovCon intelligence.
          </p>
          <Link
            href="/market-intelligence"
            className="inline-block py-3 px-6 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors"
          >
            View Access Options
          </Link>
          <button
            onClick={() => { setStatus('gate'); setError(''); }}
            className="block mx-auto mt-4 text-gray-500 text-sm hover:text-gray-300"
          >
            Try a different email
          </button>
        </div>
      </div>
    );
  }

  // --- Dashboard ---
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header with Market Intelligence branding */}
      <MarketIntelligenceHeader
        email={email}
        onSettingsClick={() => setSettingsPanelOpen(true)}
        onSwitchAccount={handleSwitchAccount}
      />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={settingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        email={email}
      />

      {briefings.length === 0 ? (
        /* Empty state */
        <div className="flex items-center justify-center py-32 px-4">
          <div className="text-center">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600/20 to-purple-800/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">📨</span>
            </div>
            <h2 className="text-xl font-semibold mb-2">No Briefings Yet</h2>
            <p className="text-gray-400 max-w-md">
              Your first briefing will appear here after the next daily delivery (7 AM UTC).
              Check your email — it may already be in your inbox.
            </p>
            <button
              onClick={() => setSettingsPanelOpen(true)}
              className="mt-6 px-6 py-2 bg-purple-600/20 text-purple-400 rounded-lg hover:bg-purple-600/30 transition-colors"
            >
              Review your settings
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row">
          {/* Date sidebar - horizontal on mobile, vertical on desktop */}
          <aside className="lg:w-64 border-b lg:border-b-0 lg:border-r border-gray-800 lg:min-h-[calc(100vh-65px)]">
            {/* Mobile: horizontal scroll */}
            <div className="flex lg:hidden overflow-x-auto gap-2 p-3">
              {briefings.map(b => (
                <button
                  key={b.briefing_date}
                  onClick={() => { setSelectedDate(b.briefing_date); setExpandedItems(new Set()); }}
                  className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedDate === b.briefing_date
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                      : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
                  }`}
                >
                  {formatDate(b.briefing_date)}
                  <span className="ml-1.5 text-xs opacity-60">{b.items_count}</span>
                </button>
              ))}
            </div>
            {/* Desktop: vertical list */}
            <div className="hidden lg:block p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 px-2">Past Briefings</p>
              {briefings.map(b => (
                <button
                  key={b.briefing_date}
                  onClick={() => { setSelectedDate(b.briefing_date); setExpandedItems(new Set()); }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                    selectedDate === b.briefing_date
                      ? 'bg-purple-500/15 text-purple-400'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-300'
                  }`}
                >
                  <span className="font-medium text-sm">{formatDate(b.briefing_date)}</span>
                  <span className="float-right text-xs opacity-50">{b.items_count} items</span>
                </button>
              ))}
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 max-w-4xl mx-auto p-4 lg:p-8">
            {selectedBriefing ? (
              <>
                {/* Date heading */}
                <p className="text-gray-500 text-sm mb-1">{formatDateLong(selectedBriefing.briefingDate)}</p>

                {/* Search and Filter Bar */}
                <div className="mb-6 mt-4 space-y-3">
                  {/* Search input */}
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search opportunities, agencies, keywords..."
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Filter buttons and Export */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setActiveFilter('all')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          activeFilter === 'all'
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                            : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
                        }`}
                      >
                        All <span className="ml-1 opacity-60">{filterCounts.all}</span>
                      </button>
                      <button
                        onClick={() => setActiveFilter('urgent')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          activeFilter === 'urgent'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                            : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
                        }`}
                      >
                        Urgent <span className="ml-1 opacity-60">{filterCounts.urgent}</span>
                      </button>
                      <button
                        onClick={() => setActiveFilter('opportunity')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          activeFilter === 'opportunity'
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                            : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
                        }`}
                      >
                        Opportunities <span className="ml-1 opacity-60">{filterCounts.opportunity}</span>
                      </button>
                      <button
                        onClick={() => setActiveFilter('teaming')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          activeFilter === 'teaming'
                            ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                            : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
                        }`}
                      >
                        Teaming <span className="ml-1 opacity-60">{filterCounts.teaming}</span>
                      </button>
                    </div>

                    {/* Export buttons */}
                    <div className="flex gap-2 print:hidden">
                      <button
                        onClick={exportToCSV}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700 hover:text-gray-300 transition-colors flex items-center gap-1.5"
                        title="Export to CSV"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        CSV
                      </button>
                      <button
                        onClick={exportToPrint}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700 hover:text-gray-300 transition-colors flex items-center gap-1.5"
                        title="Print / Save as PDF"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Print
                      </button>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <h2 className="text-2xl font-bold mb-1">{selectedBriefing.summary.headline}</h2>
                <p className="text-gray-400 mb-6">{selectedBriefing.summary.subheadline}</p>

                {/* Quick stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                  {selectedBriefing.summary.quickStats.map((stat, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-purple-400">
                        {stat.value}
                        {stat.trend === 'up' && <span className="text-green-400 text-sm ml-1">&#9650;</span>}
                        {stat.trend === 'down' && <span className="text-red-400 text-sm ml-1">&#9660;</span>}
                      </div>
                      <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">{stat.label}</div>
                    </div>
                  ))}
                  {selectedBriefing.summary.urgentAlerts > 0 && (
                    <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-red-400">{selectedBriefing.summary.urgentAlerts}</div>
                      <div className="text-xs text-red-400/70 uppercase tracking-wider mt-1">Urgent Alerts</div>
                    </div>
                  )}
                </div>

                {/* Top Items */}
                {selectedBriefing.topItems.length > 0 && filterItems(selectedBriefing.topItems.flatMap(s => s.items)).length > 0 && (
                  <section className="mb-8">
                    <h3 className="text-lg font-semibold mb-4 text-gray-300">Top Intelligence</h3>
                    <div className="space-y-3">
                      {filterItems(selectedBriefing.topItems.flatMap(s => s.items)).map(item => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          expanded={expandedItems.has(item.id)}
                          onToggle={() => toggleItem(item.id)}
                          searchTerm={searchTerm}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Categorized Items */}
                {Object.entries(selectedBriefing.categorizedItems)
                  .filter(([, section]) => filterItems(section.items).length > 0)
                  .map(([key, section]) => (
                    <section key={key} className="mb-8">
                      <h3 className="text-lg font-semibold mb-4 text-gray-300">{section.title}</h3>
                      <div className="space-y-3">
                        {filterItems(section.items).map(item => (
                          <ItemCard
                            key={item.id}
                            item={item}
                            expanded={expandedItems.has(item.id)}
                            onToggle={() => toggleItem(item.id)}
                            searchTerm={searchTerm}
                          />
                        ))}
                      </div>
                    </section>
                  ))}

                {/* No results message */}
                {(searchTerm || activeFilter !== 'all') &&
                  filterItems(selectedBriefing.topItems.flatMap(s => s.items)).length === 0 &&
                  Object.values(selectedBriefing.categorizedItems).every(s => filterItems(s.items).length === 0) && (
                  <div className="text-center py-12 text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="text-sm">No items match your search or filter</p>
                    <button
                      onClick={() => { setSearchTerm(''); setActiveFilter('all'); }}
                      className="mt-3 text-sm text-purple-400 hover:text-purple-300"
                    >
                      Clear filters
                    </button>
                  </div>
                )}

                {/* Sources */}
                <div className="mt-12 pt-6 border-t border-gray-800 text-center">
                  <p className="text-gray-600 text-xs">
                    Sources: {selectedBriefing.sourcesIncluded.join(', ')} &middot; Generated by GovCon Giants AI
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-20 text-gray-500">Select a briefing from the sidebar</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function highlightText(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm.trim()) return text;
  const parts = text.split(new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === searchTerm.toLowerCase() ? (
      <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</mark>
    ) : (
      part
    )
  );
}

function ItemCard({
  item,
  expanded,
  onToggle,
  searchTerm = '',
}: {
  item: BriefingItemFormatted;
  expanded: boolean;
  onToggle: () => void;
  searchTerm?: string;
}) {
  const isUrgent = item.urgencyBadge === 'URGENT' || item.urgencyBadge === 'HIGH';

  return (
    <div
      className={`bg-gray-900 border border-gray-800 rounded-lg overflow-hidden cursor-pointer transition-colors hover:border-gray-700 ${
        isUrgent ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-purple-500'
      }`}
      onClick={onToggle}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0">{item.categoryIcon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-sm text-white">{highlightText(item.title, searchTerm)}</h4>
              {item.urgencyBadge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  isUrgent ? 'bg-red-500/20 text-red-400' : 'bg-purple-500/20 text-purple-400'
                }`}>
                  {item.urgencyBadge}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{highlightText(item.subtitle, searchTerm)}</p>
          </div>
          <div className="shrink-0 text-right">
            {item.amount && <p className="text-sm font-semibold text-green-400">{item.amount}</p>}
            {item.deadline && <p className="text-xs text-gray-500">{item.deadline}</p>}
          </div>
        </div>

        {/* Expanded content */}
        <div
          className={`transition-all duration-200 overflow-hidden ${
            expanded ? 'max-h-96 opacity-100 mt-3' : 'max-h-0 opacity-0'
          }`}
        >
          <p className="text-sm text-gray-400 leading-relaxed mb-3">{highlightText(item.description, searchTerm)}</p>
          {item.signals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {item.signals.map((signal, i) => (
                <span key={i} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                  {highlightText(signal, searchTerm)}
                </span>
              ))}
            </div>
          )}
          <a
            href={item.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-block text-sm font-medium text-purple-400 hover:text-purple-300"
          >
            {item.actionLabel} &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
