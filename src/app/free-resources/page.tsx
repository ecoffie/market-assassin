'use client';

import { useState } from 'react';
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
    id: 'sblo-list',
    name: 'SBLO Contact List',
    description: 'Directory of Small Business Liaison Officers across federal agencies. Direct contacts for small business outreach.',
    icon: '📋',
    file: '/resources/sblo-contact-list.pdf',
    price: '$47',
  },
  {
    id: 'december-spend',
    name: 'December Spend Forecast',
    description: 'Year-end government spending predictions and Q4 opportunity analysis. Know where the money is going.',
    icon: '💰',
    file: '/resources/december-spend-forecast.pdf',
    price: '$97',
  },
  {
    id: 'capability-template',
    name: 'Capability Statement Template',
    description: 'Professional one-page capability statement template ready to customize for your business.',
    icon: '📄',
    file: '/templates/capability-statement-template.pdf',
    price: '$29',
  },
  {
    id: 'email-scripts',
    name: 'SBLO Email Scripts',
    description: 'Ready-to-use email templates for reaching out to Small Business Liaison Officers and contracting officers.',
    icon: '✉️',
    file: '/templates/email-scripts-sblo.pdf',
    price: '$37',
  },
  {
    id: 'proposal-checklist',
    name: 'Proposal Response Checklist',
    description: 'Comprehensive checklist to ensure your proposal responses are complete and compliant.',
    icon: '✅',
    file: '/templates/proposal-checklist.pdf',
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

  const handleResourceClick = (resource: Resource) => {
    // Check if user already has access (stored in localStorage)
    const accessedResources = JSON.parse(localStorage.getItem('accessed_resources') || '[]');
    if (accessedResources.includes(resource.id)) {
      // Already has access, allow download
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
        // Store access in localStorage
        const accessedResources = JSON.parse(localStorage.getItem('accessed_resources') || '[]');
        if (!accessedResources.includes(selectedResource.id)) {
          accessedResources.push(selectedResource.id);
          localStorage.setItem('accessed_resources', JSON.stringify(accessedResources));
        }
        localStorage.setItem('lead_email', email.trim().toLowerCase());

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

  const closeModal = () => {
    setSelectedResource(null);
    setDownloadUrl(null);
    setShowSuccess(false);
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-700">GovCon</span>
              <span className="text-xl font-bold text-amber-500">Giants</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-2xl p-8 text-white mb-12">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">🎁</span>
            <h1 className="text-3xl font-bold">Free GovCon Resources</h1>
          </div>
          <p className="text-lg opacity-95">
            Download free templates, checklists, and guides to accelerate your government contracting journey.
            Just enter your email to access.
          </p>
        </div>

        {/* Resources Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FREE_RESOURCES.map((resource) => {
            const accessedResources = typeof window !== 'undefined'
              ? JSON.parse(localStorage.getItem('accessed_resources') || '[]')
              : [];
            const hasAccess = accessedResources.includes(resource.id);

            return (
              <div
                key={resource.id}
                className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-200 hover:border-green-400 hover:shadow-xl transition-all cursor-pointer"
                onClick={() => handleResourceClick(resource)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{resource.icon}</span>
                    <h3 className="text-lg font-bold text-gray-900">{resource.name}</h3>
                  </div>
                  <div className="text-right">
                    <span className="text-sm text-gray-400 line-through">{resource.price}</span>
                    <span className="block text-green-600 font-bold">FREE</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-4">{resource.description}</p>
                <button
                  className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${
                    hasAccess
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-green-500 text-white hover:bg-green-600'
                  }`}
                >
                  {hasAccess ? '✓ Download Again' : 'Get Free Access'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Upgrade CTA */}
        <div className="mt-12 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-xl p-8 text-white">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">Want More?</h2>
              <p className="opacity-90">
                Upgrade to our premium tools for advanced market intelligence, contractor databases, and AI-powered content generation.
              </p>
            </div>
            <Link
              href="/"
              className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg transition-colors whitespace-nowrap"
            >
              View Premium Tools
            </Link>
          </div>
        </div>
      </main>

      {/* Email Capture Modal */}
      {selectedResource && !showSuccess && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedResource.icon}</span>
                <h3 className="text-lg font-bold text-gray-900">{selectedResource.name}</h3>
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-gray-600 mb-6">
              Enter your email to get instant access to this resource.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Get Free Access'}
              </button>

              <p className="text-xs text-gray-500 text-center">
                By submitting, you agree to receive occasional emails from GovCon Giants.
                Unsubscribe anytime.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Download Success Modal */}
      {selectedResource && showSuccess && downloadUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Access Granted!</h3>
            <p className="text-gray-600 mb-6">
              Your download for <strong>{selectedResource.name}</strong> is ready.
            </p>

            <a
              href={downloadUrl}
              download
              className="block w-full px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg transition-colors mb-4"
            >
              Download Now
            </a>

            <button
              onClick={closeModal}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 py-8 text-center text-gray-600">
        <p className="text-sm">
          &copy; {new Date().getFullYear()} GovCon Giants. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
