'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

export default function BriefingsDashboard() {
  const [email, setEmail] = useState('');
  const [inputEmail, setInputEmail] = useState('');
  const [status, setStatus] = useState<'loading' | 'gate' | 'verifying' | 'denied' | 'ready'>('loading');
  const [briefings, setBriefings] = useState<BriefingEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const selectedBriefing = briefings.find(b => b.briefing_date === selectedDate)?.content ?? null;

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

    const entries: BriefingEntry[] = data.briefings || [];
    // Single briefing response (days=1 fallback)
    if (data.briefing && !data.briefings) {
      entries.push({
        briefing_date: data.briefing_date,
        generated_at: data.generated_at,
        items_count: data.briefing?.totalItems || 0,
        content: data.briefing,
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

  // On mount, check localStorage
  useEffect(() => {
    const saved = localStorage.getItem('briefings_access_email');
    if (saved) {
      setEmail(saved);
      setStatus('verifying');
      fetch('/api/briefings/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: saved }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.hasAccess) {
            fetchBriefings(saved);
          } else {
            localStorage.removeItem('briefings_access_email');
            setStatus('gate');
          }
        })
        .catch(() => {
          setStatus('gate');
        });
    } else {
      setStatus('gate');
    }
  }, [fetchBriefings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputEmail.toLowerCase().trim();
    if (!trimmed) return;
    setError('');
    setStatus('verifying');
    try {
      await fetchBriefings(trimmed);
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('gate');
    }
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

  // --- Email Gate ---
  if (status === 'loading' || status === 'verifying') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading your briefings...</div>
      </div>
    );
  }

  if (status === 'gate') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full p-8 bg-gray-900 border border-gray-800 rounded-2xl">
          <h1 className="text-2xl font-bold text-white mb-2">Daily Briefings</h1>
          <p className="text-gray-400 mb-6">Enter the email associated with your briefing subscription.</p>
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              value={inputEmail}
              onChange={(e) => setInputEmail(e.target.value)}
              required
              className="w-full p-3 mb-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
              placeholder="you@example.com"
            />
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <button
              type="submit"
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-xl transition-colors"
            >
              View My Briefings
            </button>
          </form>
          <p className="text-gray-500 text-sm mt-4 text-center">
            Don&apos;t have access?{' '}
            <Link href="/store" className="text-amber-400 hover:underline">Get Daily Briefings</Link>
          </p>
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full p-8 bg-gray-900 border border-gray-800 rounded-2xl text-center">
          <h1 className="text-2xl font-bold text-white mb-2">No Briefing Access</h1>
          <p className="text-gray-400 mb-6">
            Daily briefings are included with Pro Giant ($997) and Ultimate ($1,497) bundles,
            or the Federal Help Center membership ($99/mo).
          </p>
          <Link
            href="/store"
            className="inline-block py-3 px-6 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-xl transition-colors"
          >
            View Plans
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
      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-300">
            &larr; Back to Tools
          </Link>
          <h1 className="text-xl font-bold mt-1">Daily GovCon Briefings</h1>
        </div>
        <div className="text-right">
          <p className="text-gray-500 text-sm">{email}</p>
          <button
            onClick={() => {
              localStorage.removeItem('briefings_access_email');
              setStatus('gate');
              setEmail('');
              setBriefings([]);
            }}
            className="text-gray-600 text-xs hover:text-gray-400"
          >
            Switch account
          </button>
        </div>
      </header>

      {briefings.length === 0 ? (
        /* Empty state */
        <div className="flex items-center justify-center py-32 px-4">
          <div className="text-center">
            <p className="text-5xl mb-4">&#128236;</p>
            <h2 className="text-xl font-semibold mb-2">No Briefings Yet</h2>
            <p className="text-gray-400 max-w-md">
              Your first briefing will appear here after the next daily delivery (9 AM UTC).
              Check your email — it may already be in your inbox.
            </p>
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
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
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
                      ? 'bg-amber-500/15 text-amber-400'
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

                {/* Summary */}
                <h2 className="text-2xl font-bold mb-1">{selectedBriefing.summary.headline}</h2>
                <p className="text-gray-400 mb-6">{selectedBriefing.summary.subheadline}</p>

                {/* Quick stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                  {selectedBriefing.summary.quickStats.map((stat, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-blue-400">
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
                {selectedBriefing.topItems.length > 0 && (
                  <section className="mb-8">
                    <h3 className="text-lg font-semibold mb-4 text-gray-300">Top Intelligence</h3>
                    <div className="space-y-3">
                      {selectedBriefing.topItems.flatMap(s => s.items).map(item => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          expanded={expandedItems.has(item.id)}
                          onToggle={() => toggleItem(item.id)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Categorized Items */}
                {Object.entries(selectedBriefing.categorizedItems)
                  .filter(([, section]) => section.items.length > 0)
                  .map(([key, section]) => (
                    <section key={key} className="mb-8">
                      <h3 className="text-lg font-semibold mb-4 text-gray-300">{section.title}</h3>
                      <div className="space-y-3">
                        {section.items.map(item => (
                          <ItemCard
                            key={item.id}
                            item={item}
                            expanded={expandedItems.has(item.id)}
                            onToggle={() => toggleItem(item.id)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}

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

function ItemCard({
  item,
  expanded,
  onToggle,
}: {
  item: BriefingItemFormatted;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isUrgent = item.urgencyBadge === 'URGENT' || item.urgencyBadge === 'HIGH';

  return (
    <div
      className={`bg-gray-900 border border-gray-800 rounded-lg overflow-hidden cursor-pointer transition-colors hover:border-gray-700 ${
        isUrgent ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-blue-500'
      }`}
      onClick={onToggle}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0">{item.categoryIcon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-sm text-white">{item.title}</h4>
              {item.urgencyBadge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  isUrgent ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {item.urgencyBadge}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{item.subtitle}</p>
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
          <p className="text-sm text-gray-400 leading-relaxed mb-3">{item.description}</p>
          {item.signals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {item.signals.map((signal, i) => (
                <span key={i} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                  {signal}
                </span>
              ))}
            </div>
          )}
          <a
            href={item.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-block text-sm font-medium text-blue-400 hover:text-blue-300"
          >
            {item.actionLabel} &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
