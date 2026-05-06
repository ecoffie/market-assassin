'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

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

export default function AlertsPanel({ email, tier }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [totalCount, setTotalCount] = useState(0);

  const loadAlerts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (email) params.set('email', email);
      params.set('limit', '50');

      const res = await fetch(`/api/mi-beta/opportunities?${params.toString()}`);
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
  }, [email]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

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

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    if (filter === 'solicitation') return alert.noticeType?.toLowerCase().includes('solicitation');
    if (filter === 'sources') return alert.noticeType?.toLowerCase().includes('sources');
    if (filter === 'setaside') return !!alert.setAside;
    if (filter === 'urgent') return alert.isUrgent || alert.isClosingSoon;
    return true;
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Alerts</h1>
          <p className="text-slate-400 mt-1">
            Opportunities matching your profile
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all', label: `All (${alerts.length})` },
          { key: 'solicitation', label: 'Solicitations' },
          { key: 'sources', label: 'Sources Sought' },
          { key: 'setaside', label: 'Set-Aside' },
          { key: 'urgent', label: '🔥 Urgent' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === key
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
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
            <a
              key={alert.id}
              href={alert.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`block bg-slate-900 border rounded-xl p-4 hover:border-emerald-500/50 transition-colors ${
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
                    <span className="text-xs text-emerald-400 hover:text-emerald-300">
                      View on SAM.gov →
                    </span>
                  </div>
                </div>
              </div>
            </a>
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
              ? 'Try adjusting your filter or check back later.'
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
    </div>
  );
}
