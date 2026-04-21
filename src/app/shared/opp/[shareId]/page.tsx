'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface OpportunityData {
  id: string;
  title: string;
  agency?: string;
  department?: string;
  naics_code?: string;
  psc_code?: string;
  set_aside?: string;
  notice_type?: string;
  response_deadline?: string;
  posted_date?: string;
  description?: string;
  ui_link?: string;
  value?: number | string;
}

interface ShareData {
  success: boolean;
  shareId: string;
  opportunity: OpportunityData;
  sharedBy: string;
  sharedAt: string;
  isExpired: boolean;
  viewCount: number;
}

export default function SharedOpportunityPage() {
  const params = useParams();
  const shareId = params.shareId as string;

  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchShare() {
      try {
        const res = await fetch(`/api/share/opportunity?shareId=${shareId}`);
        const json = await res.json();

        if (json.success) {
          setData(json);
        } else {
          setError(json.error || 'Failed to load opportunity');
        }
      } catch {
        setError('Failed to load opportunity');
      } finally {
        setLoading(false);
      }
    }

    if (shareId) {
      fetchShare();
    }
  }, [shareId]);

  // Format date
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Not specified';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Format currency
  const formatValue = (value?: number | string) => {
    if (!value) return null;
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(num);
  };

  // Calculate days remaining
  const getDaysRemaining = (deadline?: string) => {
    if (!deadline) return null;
    const end = new Date(deadline);
    const now = new Date();
    const days = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-gray-900 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Opportunity Not Found</h1>
          <p className="text-gray-400 mb-6">This share link may have expired or doesn't exist.</p>
          <Link
            href="/briefings"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
          >
            Get Your Own Briefings
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>
    );
  }

  const opp = data.opportunity;
  const daysRemaining = getDaysRemaining(opp.response_deadline);

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="bg-gray-900/80 backdrop-blur-md border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/briefings" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GC</span>
            </div>
            <span className="text-white font-semibold">GovCon Giants</span>
          </Link>
          <Link
            href={`/briefings?ref=${shareId}`}
            className="text-sm px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
          >
            Get Free Briefings
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Shared by banner */}
        <div className="mb-6 flex items-center gap-2 text-sm text-purple-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span>Shared by <strong className="text-purple-300">{data.sharedBy}</strong></span>
        </div>

        {/* Expired warning */}
        {data.isExpired && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-yellow-400 font-medium">This opportunity has closed</p>
              <p className="text-yellow-500/70 text-sm mt-1">The response deadline has passed, but you can still find similar opportunities.</p>
            </div>
          </div>
        )}

        {/* Main opportunity card */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          {/* Title section */}
          <div className="p-6 border-b border-gray-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                {opp.notice_type && (
                  <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-400 rounded mb-3">
                    {opp.notice_type}
                  </span>
                )}
                <h1 className="text-2xl font-bold text-white">{opp.title}</h1>
              </div>
              {!data.isExpired && daysRemaining !== null && (
                <div className={`shrink-0 px-3 py-2 rounded-lg text-center ${
                  daysRemaining <= 3
                    ? 'bg-red-500/20 text-red-400'
                    : daysRemaining <= 7
                      ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-green-500/20 text-green-400'
                }`}>
                  <div className="text-2xl font-bold">{daysRemaining}</div>
                  <div className="text-xs">days left</div>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {opp.naics_code && (
                <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-sm rounded">
                  NAICS: {opp.naics_code}
                </span>
              )}
              {opp.psc_code && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-sm rounded">
                  PSC: {opp.psc_code}
                </span>
              )}
              {opp.set_aside && (
                <span className="px-2 py-1 bg-green-500/20 text-green-400 text-sm rounded">
                  {opp.set_aside}
                </span>
              )}
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 border-b border-gray-800">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider">Agency</label>
              <p className="text-white mt-1">{opp.agency || opp.department || 'Not specified'}</p>
            </div>
            {opp.response_deadline && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider">Response Deadline</label>
                <p className="text-white mt-1">{formatDate(opp.response_deadline)}</p>
              </div>
            )}
            {opp.posted_date && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider">Posted Date</label>
                <p className="text-white mt-1">{formatDate(opp.posted_date)}</p>
              </div>
            )}
            {formatValue(opp.value) && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider">Estimated Value</label>
                <p className="text-white mt-1 font-semibold">{formatValue(opp.value)}</p>
              </div>
            )}
          </div>

          {/* Description */}
          {opp.description && (
            <div className="p-6 border-b border-gray-800">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Description</label>
              <p className="text-gray-300 mt-2 whitespace-pre-wrap leading-relaxed">
                {opp.description.length > 2000
                  ? opp.description.substring(0, 2000) + '...'
                  : opp.description
                }
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="p-6 flex flex-col sm:flex-row gap-4">
            {opp.ui_link && (
              <a
                href={opp.ui_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View on SAM.gov
              </a>
            )}
            <Link
              href={`/briefings?ref=${shareId}`}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Get Opportunities Like This
            </Link>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-8 bg-gradient-to-br from-purple-600/20 to-blue-600/20 rounded-2xl border border-purple-500/20 p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            Never Miss Another Opportunity
          </h2>
          <p className="text-gray-300 mb-6 max-w-md mx-auto">
            Get opportunities like this delivered straight to your inbox every morning.
            Set up your profile in 2 minutes.
          </p>
          <Link
            href={`/briefings?ref=${shareId}`}
            className="inline-flex items-center gap-2 px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors text-lg"
          >
            Start Free Daily Briefings
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
          <p className="text-xs text-gray-500 mt-4">
            Free during beta. No credit card required.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-16">
        <div className="max-w-4xl mx-auto px-4 py-8 text-center">
          <p className="text-gray-500 text-sm">
            Powered by <a href="https://govcongiants.org" className="text-purple-400 hover:text-purple-300">GovCon Giants</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
