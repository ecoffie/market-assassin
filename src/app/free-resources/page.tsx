'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Resource {
  id: string;
  name: string;
  description: string;
  icon: string;
  file: string;
  price: string;
}

const FREE_RESOURCES: Resource[] = [
  {
    id: 'first-contract-guide',
    name: 'The No-B.S. Guide to Winning Your First Federal Contract',
    description: 'The honest 8-step path to your first federal contract — free, no jargon. Register, find one opportunity, price it, and actually submit the bid.',
    icon: '🎯',
    file: '/resources/first-contract-guide.html',
    price: 'Free',
  },
  {
    id: 'sblo-list',
    name: 'SBLO Contact List',
    description: 'Directory of Small Business Liaison Officers across federal agencies. Direct contacts for small business outreach.',
    icon: '📋',
    file: '/resources/sblo-contact-list.html',
    price: '$47',
  },
  {
    id: 'tier2-list',
    name: 'Tier-2 Supplier List',
    description: 'Access Tier-2 supplier contacts and vendor registration portals at major prime contractors.',
    icon: '🏢',
    file: '/resources/tier2-supplier-list.html',
    price: '$697',
  },
  {
    id: 'december-spend',
    name: 'December Spend Forecast',
    description: 'Year-end government spending predictions and Q4 opportunity analysis. Know where the money is going.',
    icon: '💰',
    file: '/resources/december-spend-forecast.html',
    price: '$97',
  },
  {
    id: 'ai-prompts',
    name: '75+ AI Prompts for GovCon',
    description: 'Ready-to-use AI prompts for proposals, BD, marketing, and operations. Works with ChatGPT, Claude & more.',
    icon: '🤖',
    file: '/resources/ai-prompts-govcon.html',
    price: '$797',
  },
  {
    id: 'action-plan',
    name: '2026 GovCon Action Plan',
    description: 'Your step-by-step roadmap to winning federal contracts in 2026. Month-by-month milestones and task checklists.',
    icon: '📅',
    file: '/resources/action-plan-2026.html',
    price: '$497',
  },
  {
    id: 'guides-templates',
    name: 'GovCon Guides & Templates',
    description: 'Comprehensive guides and ready-to-use templates including capability statements, email scripts, and proposal checklists.',
    icon: '📝',
    file: '/resources/govcon-guides-templates.html',
    price: '$97',
  },
  {
    id: 'expiring-contracts-csv',
    name: 'Expiring Contracts CSV',
    description: 'Sample of expiring federal contracts data. Import into Excel, Google Sheets, or your CRM.',
    icon: '📊',
    file: '/resources/expiring-contracts-sample.csv',
    price: '$697',
  },
  {
    id: 'tribal-list',
    name: 'Tribal Contractor List',
    description: '500+ Native American-owned federal contractors for teaming and subcontracting opportunities.',
    icon: '🏛️',
    file: '/resources/tribal-contractor-list.csv',
    price: '$297',
  },
  {
    id: 'capability-template',
    name: 'Capability Statement Template',
    description: 'Professional one-page capability statement template ready to customize for your business.',
    icon: '📄',
    file: '/templates/capability-statement-template.html',
    price: '$29',
  },
  {
    id: 'email-scripts',
    name: 'SBLO Email Scripts',
    description: 'Ready-to-use email templates for reaching out to Small Business Liaison Officers and contracting officers.',
    icon: '✉️',
    file: '/templates/email-scripts-sblo.html',
    price: '$37',
  },
  {
    id: 'proposal-checklist',
    name: 'Proposal Response Checklist',
    description: 'Comprehensive checklist to ensure your proposal responses are complete and compliant.',
    icon: '✅',
    file: '/templates/proposal-checklist.html',
    price: '$19',
  },
];

export default function FreeResourcesPage() {
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [accessedResources, setAccessedResources] = useState<string[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);

  // Check for existing access on mount
  useEffect(() => {
    const checkExistingAccess = async () => {
      // First check localStorage for cached email
      const cachedEmail = localStorage.getItem('lead_email');

      if (cachedEmail) {
        setUserEmail(cachedEmail);
        setEmail(cachedEmail);

        // Verify access from database
        try {
          const response = await fetch(`/api/capture-lead?email=${encodeURIComponent(cachedEmail)}`);
          const data = await response.json();

          if (data.hasAccess && data.accessedResources) {
            setAccessedResources(data.accessedResources);
          }
        } catch (err) {
          console.error('Error checking access:', err);
        }
      }

      setIsCheckingAccess(false);
    };

    checkExistingAccess();
  }, []);

  // Deep-link: /free-resources?resource=<id> pre-opens that resource's capture modal
  // (used by the YouTube CTA → getmindy.ai/youtube/first-contract-guide).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('resource');
    if (!requested) return;
    const match = FREE_RESOURCES.find((r) => r.id === requested);
    if (match) setSelectedResource(match);
  }, []);

  const handleResourceClick = async (resource: Resource) => {
    // If user has email and has accessed this resource, allow direct download
    if (userEmail && accessedResources.includes(resource.id)) {
      setDownloadUrl(resource.file);
      setSelectedResource(resource);
      setShowSuccess(true);
    } else {
      // Show email capture form
      setSelectedResource(resource);
      setDownloadUrl(null);
      setShowSuccess(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!selectedResource) return;

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/capture-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim() || undefined,
          resourceId: selectedResource.id,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update state with new access
        const newEmail = email.trim().toLowerCase();
        setUserEmail(newEmail);

        // Update accessed resources list
        if (!accessedResources.includes(selectedResource.id)) {
          setAccessedResources([...accessedResources, selectedResource.id]);
        }

        // Cache email in localStorage for convenience (but access is verified from DB)
        localStorage.setItem('lead_email', newEmail);

        setDownloadUrl(data.resource.file);
        setShowSuccess(true);
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Failed to process request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('lead_email');
    setUserEmail(null);
    setEmail('');
    setAccessedResources([]);
  };

  const closeModal = () => {
    setSelectedResource(null);
    setDownloadUrl(null);
    setShowSuccess(false);
    setError('');
  };

  return (
    <div className="min-h-screen bg-(--mp-wash)">
      {/* Header */}
      <nav className="bg-(--mp-surface) border-b border-(--mp-hair)">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-(--mp-navy)">GovCon</span>
              <span className="text-xl font-bold text-(--mp-accent)">Giants</span>
            </Link>
            {userEmail && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-(--mp-muted) hidden sm:inline">{userEmail}</span>
                <button
                  onClick={handleSignOut}
                  className="text-sm text-(--mp-muted) hover:text-(--mp-body)"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <div className="rounded-none p-8 text-(--mp-ink) mb-12 bg-(--mp-surface) border border-(--mp-line)">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">🎁</span>
            <h1 className="text-3xl font-bold font-(family-name:--mp-font-serif)">Free GovCon Resources</h1>
          </div>
          <p className="text-lg text-(--mp-body)">
            Download free templates, checklists, and guides to accelerate your government contracting journey.
            Just enter your email to access.
          </p>
          {userEmail && (
            <div className="mt-4 flex items-center gap-2 bg-(--mp-wash) border border-(--mp-line) rounded-[6px] px-4 py-2 w-fit">
              <span className="text-(--mp-muted)">Signed in as:</span>
              <span className="font-medium">{userEmail}</span>
            </div>
          )}
        </div>

        {/* Loading State */}
        {isCheckingAccess ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-(--mp-muted)">Loading resources...</div>
          </div>
        ) : (
          /* Resources Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FREE_RESOURCES.map((resource) => {
              const hasAccess = accessedResources.includes(resource.id);

              return (
                <div
                  key={resource.id}
                  className="bg-(--mp-surface) rounded-none p-6 border border-(--mp-line) hover:border-(--mp-ink) transition-colors cursor-pointer"
                  onClick={() => handleResourceClick(resource)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{resource.icon}</span>
                      <h3 className="font-(family-name:--mp-font-serif) text-lg font-bold text-(--mp-ink)">{resource.name}</h3>
                    </div>
                    <div className="text-right">
                      <span className="text-sm text-(--mp-muted) line-through">{resource.price}</span>
                      <span className="block text-(--mp-accent) font-bold">FREE</span>
                    </div>
                  </div>
                  <p className="text-sm text-(--mp-muted) mb-4">{resource.description}</p>
                  <button
                    className={`w-full px-4 py-2 rounded-none font-medium transition-colors ${
                      hasAccess
                        ? 'bg-(--mp-ok-bg) text-(--mp-ok) border border-(--mp-ok-line)'
                        : 'bg-(--mp-navy) text-white hover:bg-(--mp-navy-hover)'
                    }`}
                  >
                    {hasAccess ? '✓ Download Again' : 'Get Free Access'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Upgrade CTA */}
        <div className="mt-12 rounded-none p-8 text-(--mp-ink) bg-(--mp-wash)">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2 font-(family-name:--mp-font-serif)">Want More?</h2>
              <p className="opacity-90">
                Upgrade to our premium tools for advanced market intelligence, contractor databases, and AI-powered content generation.
              </p>
            </div>
            <Link
              href="/store"
              className="px-8 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-bold rounded-none transition-colors whitespace-nowrap"
            >
              View Premium Tools
            </Link>
          </div>
        </div>
      </main>

      {/* Email Capture Modal */}
      {selectedResource && !showSuccess && (
        <div className="fixed inset-0 bg-(--mp-ink)/50 flex items-center justify-center z-50 p-4">
          <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedResource.icon}</span>
                <h3 className="font-(family-name:--mp-font-serif) text-lg font-bold text-(--mp-ink)">{selectedResource.name}</h3>
              </div>
              <button
                onClick={closeModal}
                className="text-(--mp-muted) hover:text-(--mp-muted)"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-(--mp-muted) mb-6">
              Enter your email to get instant access to this resource.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-(--mp-body) mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-2 border border-(--mp-line) rounded-[8px] focus:border-(--mp-navy) text-(--mp-ink)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-(--mp-body) mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2 border border-(--mp-line) rounded-[8px] focus:border-(--mp-navy) text-(--mp-ink)"
                />
              </div>

              {error && (
                <div className="bg-(--mp-warn-bg) border border-(--mp-warn-line) text-(--mp-crit) px-4 py-2 rounded-[6px] text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-bold rounded-none transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Get Free Access'}
              </button>

              <p className="text-xs text-(--mp-muted) text-center">
                By submitting, you agree to receive occasional emails from GovCon Giants.
                Unsubscribe anytime.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Download Success Modal */}
      {selectedResource && showSuccess && downloadUrl && (
        <div className="fixed inset-0 bg-(--mp-ink)/50 flex items-center justify-center z-50 p-4">
          <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none max-w-md w-full p-6 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h3 className="text-xl font-bold text-(--mp-ink) mb-2 font-(family-name:--mp-font-serif)">Access Granted!</h3>
            <p className="text-(--mp-muted) mb-6">
              Your download for <strong>{selectedResource.name}</strong> is ready.
            </p>

            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              {...(downloadUrl.endsWith('.csv') ? { download: true } : {})}
              className="block w-full px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-bold rounded-none transition-colors mb-4"
            >
              {downloadUrl.endsWith('.csv') ? 'Download Now' : 'Open Resource'}
            </a>

            <button
              onClick={closeModal}
              className="text-(--mp-muted) hover:text-(--mp-body) text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 py-8 text-center text-(--mp-muted)">
        <p className="text-sm">
          &copy; {new Date().getFullYear()} GovCon Giants. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
