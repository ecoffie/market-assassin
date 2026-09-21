/**
 * Example Usage: Pipeline Board Integration
 *
 * This file shows how to integrate the PipelineBoard component into a page.
 * Copy this code to your actual page file (e.g., app/bd-assist/page.tsx)
 */

'use client';

import { useState, useEffect } from 'react';
import { PipelineBoard } from '@/components/bd-assist';

export default function PipelinePage() {
  const [userEmail, setUserEmail] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Replace with your actual authentication method
    // Options:
    // 1. From localStorage
    const cachedEmail = localStorage.getItem('user_email');

    // 2. From cookies
    // const email = document.cookie
    //   .split('; ')
    //   .find(row => row.startsWith('user_email='))
    //   ?.split('=')[1];

    // 3. From your auth context/provider
    // const { user } = useAuth();
    // const email = user?.email;

    if (cachedEmail) {
      setUserEmail(cachedEmail);
    }

    setIsLoading(false);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!userEmail) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Authentication Required</h2>
          <p className="text-gray-600 mb-6">
            Please log in to access your pipeline.
          </p>
          <a
            href="/activate"
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  // Main Pipeline View
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">BD Pipeline Tracker</h1>
              <p className="text-sm text-gray-600 mt-1">
                Manage your opportunities from tracking to win
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{userEmail}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto p-6">
        {/* Optional: Stats Summary (you can fetch from API) */}
        {/* <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">Total Pipeline</div>
            <div className="text-2xl font-bold text-gray-900">$25.5M</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">Active Opportunities</div>
            <div className="text-2xl font-bold text-blue-600">12</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">Win Rate</div>
            <div className="text-2xl font-bold text-green-600">67%</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">Upcoming Deadlines</div>
            <div className="text-2xl font-bold text-orange-600">3</div>
          </div>
        </div> */}

        {/* Pipeline Board */}
        <PipelineBoard email={userEmail} />
      </main>
    </div>
  );
}

/**
 * ALTERNATIVE: Simpler Version (Just the Board)
 */

/*
export default function SimplePipelinePage() {
  return (
    <div className="container mx-auto p-6">
      <PipelineBoard email="user@example.com" />
    </div>
  );
}
*/

/**
 * ALTERNATIVE: With Access Control
 */

/*
import { AccessGate } from '@/components/AccessGate';

export default function GatedPipelinePage() {
  const [email, setEmail] = useState('');

  useEffect(() => {
    setEmail(localStorage.getItem('user_email') || '');
  }, []);

  return (
    <AccessGate
      accessType="access_assassin_standard"
      productName="BD Pipeline Tracker"
      purchaseUrl="/market-assassin"
    >
      <div className="container mx-auto p-6">
        <PipelineBoard email={email} />
      </div>
    </AccessGate>
  );
}
*/
