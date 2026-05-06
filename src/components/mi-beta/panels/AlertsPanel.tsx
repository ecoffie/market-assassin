'use client';

import { useState, useEffect } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface AlertsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface Alert {
  id: string;
  title: string;
  agency: string;
  postedDate: string;
  responseDate: string;
  noticeType: string;
  naics: string;
  setAside?: string;
}

export default function AlertsPanel({ email, tier }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAlerts();
  }, [email]);

  const loadAlerts = async () => {
    // TODO: Fetch real alerts from API
    await new Promise(resolve => setTimeout(resolve, 500));
    setAlerts([
      {
        id: '1',
        title: 'IT Support Services for Federal Agency',
        agency: 'Department of Defense',
        postedDate: '2026-05-04',
        responseDate: '2026-05-20',
        noticeType: 'Solicitation',
        naics: '541512',
        setAside: '8(a)',
      },
      {
        id: '2',
        title: 'Cybersecurity Assessment Services',
        agency: 'Department of Homeland Security',
        postedDate: '2026-05-03',
        responseDate: '2026-05-25',
        noticeType: 'Combined Synopsis',
        naics: '541512',
      },
      {
        id: '3',
        title: 'Management Consulting Services',
        agency: 'Department of Veterans Affairs',
        postedDate: '2026-05-02',
        responseDate: '2026-05-18',
        noticeType: 'RFQ',
        naics: '541611',
        setAside: 'SDVOSB',
      },
    ]);
    setIsLoading(false);
  };

  const getNoticeTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      'Solicitation': 'bg-green-500/20 text-green-400',
      'Combined Synopsis': 'bg-blue-500/20 text-blue-400',
      'RFQ': 'bg-purple-500/20 text-purple-400',
      'Sources Sought': 'bg-amber-500/20 text-amber-400',
    };
    return colors[type] || 'bg-slate-500/20 text-slate-400';
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Alerts</h1>
          <p className="text-slate-400 mt-1">Opportunities matching your profile</p>
        </div>
        <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
          Configure Alerts
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 text-sm rounded-lg">
          All ({alerts.length})
        </button>
        <button className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700">
          Solicitations
        </button>
        <button className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700">
          Sources Sought
        </button>
        <button className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700">
          Set-Aside
        </button>
      </div>

      {/* Alert List */}
      <div className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors cursor-pointer"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 text-xs rounded ${getNoticeTypeBadge(alert.noticeType)}`}>
                    {alert.noticeType}
                  </span>
                  {alert.setAside && (
                    <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                      {alert.setAside}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">NAICS: {alert.naics}</span>
                </div>
                <h3 className="font-medium text-white mb-1">{alert.title}</h3>
                <p className="text-sm text-slate-400">{alert.agency}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-slate-500">Response Due</div>
                <div className="text-sm font-medium text-amber-400">{alert.responseDate}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Load More */}
      <div className="text-center">
        <button className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
          Load More Alerts
        </button>
      </div>
    </div>
  );
}
