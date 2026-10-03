'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import MeetMindyStrip from '@/components/MeetMindyStrip';

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

export default function SharedOpportunityClient() {
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
      <div className="min-h-screen bg-(--mp-paper) flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-(--mp-navy)"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-(--mp-paper) flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-(--mp-surface) rounded-none p-8 text-center">
          <div className="w-16 h-16 bg-(--mp-warn-bg) rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-(--mp-crit)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-(--mp-ink) mb-2 font-(family-name:--mp-font-serif)">Opportunity Not Found</h1>
          <p className="text-(--mp-muted) mb-6">This share link may have expired or doesn't exist.</p>
          <Link
            href="/briefings"
            className="inline-flex items-center gap-2 px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-medium rounded-none transition-colors"
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
    <div className="min-h-screen bg-(--mp-paper)">
      {/* New-here strip — first-timers landing from a shared link learn what
          Mindy is + can sign up (newcomer-clarity PRD). */}
      <MeetMindyStrip appearance="public" variant="banner" />
      {/* Header — Mindy-branded (this is a getmindy.ai funnel entry, not GCG). */}
      <header className="bg-(--mp-surface) border-b border-(--mp-line)">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="https://getmindy.ai" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-none flex items-center justify-center bg-(--mp-navy)">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-(--mp-ink) font-semibold">Mindy</span>
          </Link>
          <Link
            href={`https://getmindy.ai/?ref=${shareId}`}
            className="text-sm px-4 py-2 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white rounded-none transition-colors"
          >
            Try Mindy free
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Shared by banner */}
        <div className="mb-6 flex items-center gap-2 text-sm text-(--mp-navy)">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span>Shared by <strong className="text-(--mp-navy)">{data.sharedBy}</strong></span>
        </div>

        {/* Expired warning */}
        {data.isExpired && (
          <div className="mb-6 p-4 bg-(--mp-warn-bg) border border-(--mp-warn-line) rounded-none flex items-start gap-3">
            <svg className="w-5 h-5 text-(--mp-warn) mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-(--mp-warn) font-medium">This opportunity has closed</p>
              <p className="text-(--mp-warn) text-sm mt-1">The response deadline has passed, but you can still find similar opportunities.</p>
            </div>
          </div>
        )}

        {/* Main opportunity card */}
        <div className="bg-(--mp-surface) rounded-none border border-(--mp-line) overflow-hidden">
          {/* Title section */}
          <div className="p-6 border-b border-(--mp-line)">
            <div className="flex items-start justify-between gap-4">
              <div>
                {opp.notice_type && (
                  <span className="inline-block px-2 py-1 text-xs font-medium bg-(--mp-navy-wash) text-(--mp-navy) rounded-[6px] mb-3">
                    {opp.notice_type}
                  </span>
                )}
                <h1 className="text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">{opp.title}</h1>
              </div>
              {!data.isExpired && daysRemaining !== null && (
                <div className={`shrink-0 px-3 py-2 rounded-none text-center ${
                  daysRemaining <= 3
                    ? 'bg-(--mp-warn-bg) text-(--mp-crit)'
                    : daysRemaining <= 7
                      ? 'bg-(--mp-warn-bg) text-(--mp-warn)'
                      : 'bg-(--mp-ok-bg) text-(--mp-ok)'
                }`}>
                  <div className="text-2xl font-semibold font-(family-name:--mp-font-mono) tabular-nums">{daysRemaining}</div>
                  <div className="text-xs">days left</div>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {opp.naics_code && (
                <span className="px-2 py-1 bg-(--mp-navy-wash) text-(--mp-navy) text-sm rounded-[6px]">
                  NAICS: {opp.naics_code}
                </span>
              )}
              {opp.psc_code && (
                <span className="px-2 py-1 bg-(--mp-navy-wash) text-(--mp-navy) text-sm rounded-[6px]">
                  PSC: {opp.psc_code}
                </span>
              )}
              {opp.set_aside && (
                <span className="px-2 py-1 bg-(--mp-ok-bg) text-(--mp-ok) text-sm rounded-[6px]">
                  {opp.set_aside}
                </span>
              )}
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 border-b border-(--mp-line)">
            <div>
              <label className="text-xs text-(--mp-muted) uppercase tracking-wider">Agency</label>
              <p className="text-(--mp-ink) mt-1">{opp.agency || opp.department || 'Not specified'}</p>
            </div>
            {opp.response_deadline && (
              <div>
                <label className="text-xs text-(--mp-muted) uppercase tracking-wider">Response Deadline</label>
                <p className="text-(--mp-ink) mt-1">{formatDate(opp.response_deadline)}</p>
              </div>
            )}
            {opp.posted_date && (
              <div>
                <label className="text-xs text-(--mp-muted) uppercase tracking-wider">Posted Date</label>
                <p className="text-(--mp-ink) mt-1">{formatDate(opp.posted_date)}</p>
              </div>
            )}
            {formatValue(opp.value) && (
              <div>
                <label className="text-xs text-(--mp-muted) uppercase tracking-wider">Estimated Value</label>
                <p className="text-(--mp-ink) mt-1 font-semibold">{formatValue(opp.value)}</p>
              </div>
            )}
          </div>

          {/* Description */}
          {opp.description && (
            <div className="p-6 border-b border-(--mp-line)">
              <label className="text-xs text-(--mp-muted) uppercase tracking-wider">Description</label>
              <p className="text-(--mp-body) mt-2 whitespace-pre-wrap leading-relaxed">
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
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-(--mp-surface) border border-(--mp-line) hover:bg-(--mp-wash) text-(--mp-ink) font-medium rounded-none transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View on SAM.gov
              </a>
            )}
            <Link
              href={`https://getmindy.ai/?ref=${shareId}`}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-medium rounded-none transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Get Opportunities Like This
            </Link>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-8 rounded-none border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-2xl font-bold text-(--mp-ink) mb-2 font-(family-name:--mp-font-serif)">
            Never Miss Another Opportunity
          </h2>
          <p className="text-(--mp-body) mb-6 max-w-md mx-auto">
            Get opportunities like this delivered straight to your inbox every morning.
            Set up your profile in 2 minutes.
          </p>
          <Link
            href={`https://getmindy.ai/?ref=${shareId}`}
            className="inline-flex items-center gap-2 px-8 py-4 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-none transition-colors text-lg"
          >
            Start Free Daily Briefings
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
          <p className="text-xs text-(--mp-muted) mt-4">
            Free during beta. No credit card required.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-(--mp-line) mt-16">
        <div className="max-w-4xl mx-auto px-4 py-8 text-center">
          <p className="text-(--mp-muted) text-sm">
            Powered by <a href="https://govcongiants.com" className="text-(--mp-navy) hover:text-(--mp-navy-hover)">GovCon Giants</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
