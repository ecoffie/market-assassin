'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ProfileCompleteContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email');
  const [completeness, setCompleteness] = useState(0);
  const [profile, setProfile] = useState<{
    companyName?: string;
    naicsCodes?: string[];
    targetAgencies?: string[];
    certifications?: string[];
  } | null>(null);

  useEffect(() => {
    if (email) {
      loadProfile(email);
      markOnboardingComplete(email);
    }
  }, [email]);

  const loadProfile = async (userEmail: string) => {
    try {
      const res = await fetch(`/api/profile?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
        setCompleteness(data.completeness?.total || 0);
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  };

  const markOnboardingComplete = async (userEmail: string) => {
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          onboardingCompleted: true,
        }),
      });
    } catch (err) {
      console.error('Error marking onboarding complete:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a8a] to-[#7c3aed] flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Success card */}
        <div className="bg-white rounded-xl shadow-xl p-8 text-center">
          {/* Checkmark animation */}
          <div className="w-20 h-20 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center">
            <svg
              className="w-10 h-10 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Profile Setup Complete!
          </h1>
          <p className="text-gray-600 mb-6">
            Your profile is {completeness}% complete. You&apos;ll now receive personalized briefings based on your preferences.
          </p>

          {/* Profile summary */}
          {profile && (
            <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-semibold text-gray-700 mb-3">Profile Summary</h3>
              <div className="space-y-2 text-sm">
                {profile.companyName && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Company:</span>
                    <span className="font-medium">{profile.companyName}</span>
                  </div>
                )}
                {profile.naicsCodes && profile.naicsCodes.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">NAICS Codes:</span>
                    <span className="font-medium">{profile.naicsCodes.length} codes</span>
                  </div>
                )}
                {profile.targetAgencies && profile.targetAgencies.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Target Agencies:</span>
                    <span className="font-medium">{profile.targetAgencies.length} agencies</span>
                  </div>
                )}
                {profile.certifications && profile.certifications.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Certifications:</span>
                    <span className="font-medium">{profile.certifications.join(', ')}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Completeness bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">Profile Completeness</span>
              <span className="text-sm font-bold text-[#1e3a8a]">{completeness}%</span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  completeness >= 80 ? 'bg-green-500' : completeness >= 50 ? 'bg-yellow-500' : 'bg-[#1e3a8a]'
                }`}
                style={{ width: `${completeness}%` }}
              />
            </div>
            {completeness < 80 && (
              <p className="text-xs text-gray-500 mt-2">
                Tip: Complete more fields to get better personalized recommendations
              </p>
            )}
          </div>

          {/* What's next */}
          <div className="border-t pt-6">
            <h3 className="font-semibold text-gray-700 mb-4">What&apos;s Next?</h3>
            <div className="grid grid-cols-1 gap-3">
              <Link
                href="/briefings"
                className="block px-4 py-3 bg-gradient-to-r from-[#1e3a8a] to-[#7c3aed] text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                View Your Briefings
              </Link>
              <Link
                href="/opportunity-hunter"
                className="block px-4 py-3 bg-white border-2 border-[#1e3a8a] text-[#1e3a8a] rounded-lg font-medium hover:bg-[#1e3a8a]/5 transition-colors"
              >
                Find Opportunities
              </Link>
              <Link
                href={`/profile/setup?email=${encodeURIComponent(email || '')}`}
                className="block px-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
              >
                Edit Profile Settings
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-white/60 text-sm mt-6">
          Questions? Contact{' '}
          <a href="mailto:service@govcongiants.com" className="underline hover:text-white">
            service@govcongiants.com
          </a>
        </p>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a8a] to-[#7c3aed] flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        <div className="bg-white rounded-xl shadow-xl p-8 text-center">
          <div className="animate-pulse">
            <div className="w-20 h-20 mx-auto mb-6 bg-gray-200 rounded-full"></div>
            <div className="h-6 bg-gray-200 rounded w-3/4 mx-auto mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-full mb-6"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfileCompletePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ProfileCompleteContent />
    </Suspense>
  );
}
