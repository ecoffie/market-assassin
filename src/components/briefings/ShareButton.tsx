'use client';

import { useState } from 'react';

interface Opportunity {
  id: string;
  title: string;
  agency?: string;
  department?: string;
  naics_code?: string;
  psc_code?: string;
  set_aside?: string;
  set_aside_description?: string;
  notice_type?: string;
  type?: string;
  response_deadline?: string;
  deadline?: string;
  posted_date?: string;
  description?: string;
  ui_link?: string;
  link?: string;
  value?: number | string;
  award_amount?: number | string;
}

interface ShareButtonProps {
  opportunity: Opportunity;
  email: string;
  companyName?: string;
  variant?: 'icon' | 'button' | 'small';
  className?: string;
}

export default function ShareButton({
  opportunity,
  email,
  companyName,
  variant = 'icon',
  className = '',
}: ShareButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleShare = async () => {
    if (shareUrl) {
      setShowModal(true);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/share/opportunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          companyName,
          opportunity,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setShareUrl(data.shareUrl);
        setShowModal(true);
      } else {
        setError(data.error || 'Failed to create share link');
      }
    } catch {
      setError('Failed to create share link');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: opportunity.title,
          text: `Check out this federal opportunity: ${opportunity.title}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled or share failed, fall back to copy
        copyToClipboard();
      }
    } else {
      copyToClipboard();
    }
  };

  const buttonContent = () => {
    if (loading) {
      return (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      );
    }

    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
      </svg>
    );
  };

  return (
    <>
      {/* Share Button */}
      {variant === 'icon' && (
        <button
          onClick={handleShare}
          disabled={loading}
          className={`p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-purple-400 disabled:opacity-50 ${className}`}
          title="Share opportunity"
        >
          {buttonContent()}
        </button>
      )}

      {variant === 'button' && (
        <button
          onClick={handleShare}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors disabled:opacity-50 ${className}`}
        >
          {buttonContent()}
          <span>Share</span>
        </button>
      )}

      {variant === 'small' && (
        <button
          onClick={handleShare}
          disabled={loading}
          className={`flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-purple-400 transition-colors disabled:opacity-50 ${className}`}
        >
          {buttonContent()}
          <span>Share</span>
        </button>
      )}

      {/* Share Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl max-w-md w-full overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Share Opportunity</h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {error ? (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm mb-4">
                  {error}
                </div>
              ) : (
                <>
                  <p className="text-gray-400 text-sm mb-4">
                    Share this opportunity with teaming partners or colleagues
                  </p>

                  {/* Opportunity preview */}
                  <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
                    <h4 className="text-white font-medium text-sm line-clamp-2">{opportunity.title}</h4>
                    <p className="text-gray-500 text-xs mt-1">
                      {opportunity.agency || opportunity.department}
                    </p>
                  </div>

                  {/* Share link */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={shareUrl}
                      readOnly
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                    <button
                      onClick={copyToClipboard}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        copied
                          ? 'bg-green-600 text-white'
                          : 'bg-purple-600 hover:bg-purple-500 text-white'
                      }`}
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>

                  {/* Native share button (mobile) */}
                  {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                    <button
                      onClick={handleNativeShare}
                      className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Share via...
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-800 bg-gray-800/50">
              <p className="text-xs text-gray-500 text-center">
                When shared, your company name may appear as the sharer
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
