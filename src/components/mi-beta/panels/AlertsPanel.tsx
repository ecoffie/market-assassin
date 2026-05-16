'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';

interface AlertsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface Alert {
  id: string;
  title: string;
  solicitationNumber?: string;
  department?: string;
  subTier?: string;
  office?: string;
  postedDate?: string;
  responseDeadline?: string;
  noticeType?: string;
  naicsCode?: string;
  pscCode?: string;
  setAside?: string;
  setAsideDescription?: string;
  popState?: string;
  popCity?: string;
  url: string;
  daysLeft?: number | null;
  isUrgent?: boolean;
  isClosingSoon?: boolean;
}

type AlertFilter = 'all' | 'solicitation' | 'sources' | 'setaside' | 'urgent';
type SortMode = 'deadline' | 'posted' | 'agency';

export default function AlertsPanel({ email, tier }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('deadline');
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [savingAlertIds, setSavingAlertIds] = useState<Set<string>>(new Set());
  const [savedAlertIds, setSavedAlertIds] = useState<Set<string>>(new Set());
  const [totalCount, setTotalCount] = useState(0);

  const canUsePipeline = tier !== 'free';
  const isFreeTier = tier === 'free';
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const loadAlerts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (email) params.set('email', email);
      params.set('limit', '50');

      const res = await fetch(`/api/mi-beta/opportunities?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();

      if (data.success) {
        setAlerts(data.opportunities || []);
        setTotalCount(data.count || 0);
      } else {
        setError(data.error || 'Failed to load opportunities');
        setAlerts([]);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
      setError('Failed to connect to server');
      setAlerts([]);
    } finally {
      setIsLoading(false);
    }
  }, [email, getAuthHeaders]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const saveToPipeline = async (alert: Alert) => {
    if (!email) {
      setError('Enter an email before saving opportunities.');
      return;
    }

    if (!canUsePipeline) {
      setNotice('Pipeline tracking is included with MI Pro. Upgrade to save opportunities.');
      return;
    }

    setError(null);
    setNotice(null);
    setSavingAlertIds(prev => new Set(prev).add(alert.id));

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          notice_id: alert.id,
          source: 'mi_beta_alerts',
          external_url: alert.url,
          title: alert.title,
          agency: alert.department || alert.office || 'Unknown Agency',
          naics_code: alert.naicsCode,
          set_aside: alert.setAside,
          response_deadline: alert.responseDeadline,
          stage: 'tracking',
          priority: alert.isUrgent ? 'critical' : alert.isClosingSoon ? 'high' : 'medium',
          notes: [
            alert.noticeType ? `Notice type: ${alert.noticeType}` : null,
            alert.solicitationNumber ? `Solicitation: ${alert.solicitationNumber}` : null,
            alert.office ? `Office: ${alert.office}` : null,
          ].filter(Boolean).join('\n'),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSavedAlertIds(prev => new Set(prev).add(alert.id));
        setNotice('Saved to Pipeline Tracker.');
        return;
      }

      if (res.status === 409) {
        setSavedAlertIds(prev => new Set(prev).add(alert.id));
        setNotice('This opportunity is already in your pipeline.');
        return;
      }

      setError(data.error || 'Failed to save opportunity to pipeline.');
    } catch (err) {
      console.error('Failed to save opportunity:', err);
      setError('Failed to save opportunity to pipeline.');
    } finally {
      setSavingAlertIds(prev => {
        const next = new Set(prev);
        next.delete(alert.id);
        return next;
      });
    }
  };

  const getNoticeTypeBadge = (type?: string) => {
    if (!type) return 'bg-slate-500/20 text-slate-400';
    const lowerType = type.toLowerCase();
    if (lowerType.includes('solicitation') && !lowerType.includes('presolicitation')) {
      return 'bg-green-500/20 text-green-400';
    }
    if (lowerType.includes('combined')) {
      return 'bg-teal-500/20 text-teal-400';
    }
    if (lowerType.includes('sources sought') || lowerType.includes('request for information')) {
      return 'bg-purple-500/20 text-purple-400';
    }
    if (lowerType.includes('presolicitation')) {
      return 'bg-orange-500/20 text-orange-400';
    }
    if (lowerType.includes('rfq')) {
      return 'bg-blue-500/20 text-blue-400';
    }
    return 'bg-slate-500/20 text-slate-400';
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const matchesFilter = (alert: Alert, alertFilter: AlertFilter) => {
    if (alertFilter === 'all') return true;
    if (alertFilter === 'solicitation') return alert.noticeType?.toLowerCase().includes('solicitation');
    if (alertFilter === 'sources') {
      const noticeType = alert.noticeType?.toLowerCase() || '';
      return noticeType.includes('sources') || noticeType.includes('request for information');
    }
    if (alertFilter === 'setaside') return !!alert.setAside;
    if (alertFilter === 'urgent') return alert.isUrgent || alert.isClosingSoon;
    return true;
  };

  const filterCounts = useMemo<Record<AlertFilter, number>>(() => ({
    all: alerts.length,
    solicitation: alerts.filter(alert => matchesFilter(alert, 'solicitation')).length,
    sources: alerts.filter(alert => matchesFilter(alert, 'sources')).length,
    setaside: alerts.filter(alert => matchesFilter(alert, 'setaside')).length,
    urgent: alerts.filter(alert => matchesFilter(alert, 'urgent')).length,
  }), [alerts]);

  const filteredAlerts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return alerts
      .filter(alert => matchesFilter(alert, filter))
      .filter(alert => {
        if (!normalizedSearch) return true;
        return [
          alert.title,
          alert.department,
          alert.office,
          alert.noticeType,
          alert.naicsCode,
          alert.solicitationNumber,
          alert.popCity,
          alert.popState,
        ].some(value => value?.toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => {
        if (sortMode === 'agency') {
          return (a.department || '').localeCompare(b.department || '');
        }
        if (sortMode === 'posted') {
          return new Date(b.postedDate || 0).getTime() - new Date(a.postedDate || 0).getTime();
        }
        return new Date(a.responseDeadline || 8640000000000000).getTime() - new Date(b.responseDeadline || 8640000000000000).getTime();
      });
  }, [alerts, filter, searchQuery, sortMode]);

  const filterOptions: Array<{ key: AlertFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'solicitation', label: 'Solicitations' },
    { key: 'sources', label: 'Sources Sought' },
    { key: 'setaside', label: 'Set-Aside' },
    { key: 'urgent', label: 'Due Soon' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{isFreeTier ? 'Daily Alerts' : 'Source Feed'}</h1>
            {isFreeTier && (
              <span className="px-2 py-1 text-xs bg-slate-800 text-slate-300 rounded">
                Free
              </span>
            )}
          </div>
          <p className="text-slate-400 mt-1">
            {isFreeTier
              ? 'SAM.gov opportunities matching your profile'
              : 'Raw SAM.gov data layer behind Today\'s Intel'}
            {totalCount > 0 && <span className="text-emerald-400 ml-2">({totalCount} found)</span>}
          </p>
        </div>
        <button
          onClick={loadAlerts}
          disabled={isLoading}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      {isFreeTier ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Daily Alerts is the free feed.</h2>
            <p className="text-sm text-slate-400 mt-1">
              Upgrade for AI briefings, win prioritization, pursuit guidance, forecasts, recompetes, and contractor intelligence.
            </p>
          </div>
          <a
            href="/market-intelligence"
            className="shrink-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors text-center"
          >
            Compare MI Access
          </a>
        </div>
      ) : (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-emerald-200">Included raw feed for paid accounts</h2>
          <p className="text-sm text-emerald-100/80 mt-1">
            Use this when you want to search or validate every SAM.gov match. AI Briefings remains the prioritized daily view with summaries and recommendations.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {filterOptions.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              filter === key
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-transparent hover:bg-slate-700 hover:text-white'
            }`}
          >
            {label} <span className={filter === key ? 'text-emerald-200' : 'text-slate-500'}>({filterCounts[key]})</span>
          </button>
        ))}
      </div>

      {/* Search and Sort */}
      <div className="flex flex-col md:flex-row gap-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search title, agency, NAICS, solicitation..."
          className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        />
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
          className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        >
          <option value="deadline">Sort by response due</option>
          <option value="posted">Sort by newest posted</option>
          <option value="agency">Sort by agency</option>
        </select>
        {(filter !== 'all' || searchQuery) && (
          <button
            onClick={() => {
              setFilter('all');
              setSearchQuery('');
            }}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {!isLoading && alerts.length > 0 && (
        <div className="text-sm text-slate-500">
          Showing <span className="text-slate-300">{filteredAlerts.length}</span> of <span className="text-slate-300">{alerts.length}</span> opportunities
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-emerald-300 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-200 hover:text-white"
            aria-label="Dismiss notice"
          >
            X
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Alert List */}
      {!isLoading && filteredAlerts.length > 0 && (
        <div className="space-y-3">
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedAlert(alert)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedAlert(alert);
                }
              }}
              className={`block text-left bg-slate-900 border rounded-xl p-4 hover:border-emerald-500/50 transition-colors cursor-pointer ${
                alert.isUrgent ? 'border-red-500/50 bg-red-500/5' : 'border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {alert.noticeType && (
                      <span className={`px-2 py-0.5 text-xs rounded ${getNoticeTypeBadge(alert.noticeType)}`}>
                        {alert.noticeType}
                      </span>
                    )}
                    {alert.setAside && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                        {alert.setAside}
                      </span>
                    )}
                    {alert.isUrgent && (
                      <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded font-medium">
                        🔥 {alert.daysLeft} days left
                      </span>
                    )}
                    {alert.isClosingSoon && !alert.isUrgent && (
                      <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                        ⚡ {alert.daysLeft} days left
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="font-medium text-white mb-1 line-clamp-2">{alert.title}</h3>

                  {/* Agency */}
                  <p className="text-sm text-slate-400">
                    {alert.department || 'Unknown Agency'}
                    {alert.office && <span className="text-slate-500"> • {alert.office}</span>}
                  </p>

                  {/* Meta */}
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
                    {alert.naicsCode && (
                      <span>NAICS: {alert.naicsCode}</span>
                    )}
                    {alert.popState && (
                      <span>📍 {alert.popCity ? `${alert.popCity}, ` : ''}{alert.popState}</span>
                    )}
                    {alert.solicitationNumber && (
                      <span>#{alert.solicitationNumber}</span>
                    )}
                  </div>
                </div>

                {/* Dates */}
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-500">Response Due</div>
                  <div className={`text-sm font-medium ${
                    alert.isUrgent ? 'text-red-400' : alert.isClosingSoon ? 'text-amber-400' : 'text-white'
                  }`}>
                    {formatDate(alert.responseDeadline)}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Posted {formatDate(alert.postedDate)}
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveToPipeline(alert);
                      }}
                      disabled={savingAlertIds.has(alert.id) || savedAlertIds.has(alert.id)}
                      className="text-xs text-blue-300 hover:text-blue-200 disabled:text-slate-500 disabled:cursor-default mr-3"
                    >
                      {savedAlertIds.has(alert.id)
                        ? 'Saved'
                        : savingAlertIds.has(alert.id)
                          ? 'Saving...'
                          : canUsePipeline
                            ? 'Save'
                            : 'Upgrade to Save'}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedAlert(alert);
                      }}
                      className="text-xs text-slate-300 hover:text-white mr-3"
                    >
                      Details
                    </button>
                    <a
                      href={alert.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      SAM.gov →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredAlerts.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h3 className="text-lg font-medium text-white mb-2">No Opportunities Found</h3>
          <p className="text-slate-400 text-sm">
            {filter !== 'all'
              ? 'Try a different filter, clear your search, or check back later.'
              : 'Configure your NAICS codes to see matching opportunities.'}
          </p>
        </div>
      )}

      {/* Summary Stats */}
      {!isLoading && alerts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-800">
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-white">{alerts.length}</div>
            <div className="text-xs text-slate-500">Total</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-400">
              {alerts.filter(a => a.isUrgent).length}
            </div>
            <div className="text-xs text-slate-500">Urgent</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">
              {alerts.filter(a => a.setAside).length}
            </div>
            <div className="text-xs text-slate-500">Set-Asides</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">
              {alerts.filter(a => a.noticeType?.toLowerCase().includes('solicitation')).length}
            </div>
            <div className="text-xs text-slate-500">Solicitations</div>
          </div>
        </div>
      )}

      {/* Opportunity Detail Drawer */}
      {selectedAlert && (
        <>
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setSelectedAlert(null)}
          />
          <aside className="fixed right-0 top-0 h-full w-full max-w-lg bg-slate-950 border-l border-slate-800 z-50 overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-slate-800 p-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Basic Opportunity Record</p>
                <h2 className="text-lg font-semibold text-white mt-1 line-clamp-2">{selectedAlert.title}</h2>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                aria-label="Close details"
              >
                X
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="flex flex-wrap gap-2">
                {selectedAlert.noticeType && (
                  <span className={`px-2 py-1 text-xs rounded ${getNoticeTypeBadge(selectedAlert.noticeType)}`}>
                    {selectedAlert.noticeType}
                  </span>
                )}
                {selectedAlert.setAside && (
                  <span className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded">
                    {selectedAlert.setAside}
                  </span>
                )}
                {(selectedAlert.isUrgent || selectedAlert.isClosingSoon) && (
                  <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">
                    {selectedAlert.daysLeft} days left
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Response Due</div>
                  <div className="text-white font-medium mt-1">{formatDate(selectedAlert.responseDeadline)}</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Posted</div>
                  <div className="text-white font-medium mt-1">{formatDate(selectedAlert.postedDate)}</div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
                <div>
                  <div className="text-xs text-slate-500">Agency</div>
                  <div className="text-slate-200">{selectedAlert.department || 'Unknown Agency'}</div>
                </div>
                {selectedAlert.office && (
                  <div>
                    <div className="text-xs text-slate-500">Office</div>
                    <div className="text-slate-200">{selectedAlert.office}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">NAICS</div>
                    <div className="text-slate-200">{selectedAlert.naicsCode || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">PSC</div>
                    <div className="text-slate-200">{selectedAlert.pscCode || '-'}</div>
                  </div>
                </div>
                {selectedAlert.solicitationNumber && (
                  <div>
                    <div className="text-xs text-slate-500">Solicitation Number</div>
                    <div className="text-slate-200">{selectedAlert.solicitationNumber}</div>
                  </div>
                )}
                {(selectedAlert.popCity || selectedAlert.popState) && (
                  <div>
                    <div className="text-xs text-slate-500">Place of Performance</div>
                    <div className="text-slate-200">
                      {selectedAlert.popCity ? `${selectedAlert.popCity}, ` : ''}{selectedAlert.popState}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => saveToPipeline(selectedAlert)}
                  disabled={savingAlertIds.has(selectedAlert.id) || savedAlertIds.has(selectedAlert.id)}
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-center font-medium rounded-lg transition-colors"
                >
                  {savedAlertIds.has(selectedAlert.id)
                    ? 'Saved to Pipeline'
                    : savingAlertIds.has(selectedAlert.id)
                      ? 'Saving...'
                      : canUsePipeline
                        ? 'Save to Pipeline'
                        : 'Upgrade to Save'}
                </button>
                <a
                  href={selectedAlert.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-center font-medium rounded-lg transition-colors"
                >
                  Open on SAM.gov
                </a>
                <button
                  onClick={() => setSelectedAlert(null)}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
