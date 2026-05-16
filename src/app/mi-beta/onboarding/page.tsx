'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getPlannerSupabase } from '@/lib/supabase/planner-client';

// Common NAICS codes for federal contractors
const NAICS_OPTIONS = [
  { code: '541512', label: 'Computer Systems Design' },
  { code: '541511', label: 'Custom Computer Programming' },
  { code: '541519', label: 'Other Computer Related Services' },
  { code: '541611', label: 'Administrative Management Consulting' },
  { code: '541612', label: 'Human Resources Consulting' },
  { code: '541613', label: 'Marketing Consulting' },
  { code: '541614', label: 'Process Management Consulting' },
  { code: '541618', label: 'Other Management Consulting' },
  { code: '541330', label: 'Engineering Services' },
  { code: '541620', label: 'Environmental Consulting' },
  { code: '541690', label: 'Other Scientific/Technical Consulting' },
  { code: '541990', label: 'Other Professional Services' },
  { code: '561210', label: 'Facilities Support Services' },
  { code: '561320', label: 'Temporary Help Services' },
  { code: '561110', label: 'Office Administrative Services' },
  { code: '541310', label: 'Architectural Services' },
  { code: '541380', label: 'Testing Laboratories' },
  { code: '541715', label: 'R&D in Physical Sciences' },
  { code: '236220', label: 'Commercial Building Construction' },
  { code: '238210', label: 'Electrical Contractors' },
];

// Set-aside options
const SET_ASIDE_OPTIONS = [
  { value: 'SBA', label: 'Small Business (SBA)' },
  { value: '8(a)', label: '8(a) Program' },
  { value: 'WOSB', label: 'Women-Owned Small Business' },
  { value: 'SDVOSB', label: 'Service-Disabled Veteran-Owned' },
  { value: 'HUBZone', label: 'HUBZone' },
  { value: 'VOSB', label: 'Veteran-Owned Small Business' },
];

type Step = 'business' | 'naics' | 'setaside' | 'complete';

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>('business');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [businessDescription, setBusinessDescription] = useState('');
  const [selectedNaics, setSelectedNaics] = useState<string[]>([]);
  const [customNaics, setCustomNaics] = useState('');
  const [selectedSetAsides, setSelectedSetAsides] = useState<string[]>([]);

  // Check authentication
  useEffect(() => {
    async function checkAuth() {
      const supabase = getPlannerSupabase();
      if (!supabase) {
        router.push('/signup');
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        router.push('/signup');
        return;
      }

      setUserEmail(user.email);
      setLoading(false);
    }

    checkAuth();
  }, [router]);

  // Toggle NAICS selection
  function toggleNaics(code: string) {
    setSelectedNaics(prev =>
      prev.includes(code)
        ? prev.filter(c => c !== code)
        : [...prev, code]
    );
  }

  // Toggle set-aside selection
  function toggleSetAside(value: string) {
    setSelectedSetAsides(prev =>
      prev.includes(value)
        ? prev.filter(v => v !== value)
        : [...prev, value]
    );
  }

  // Add custom NAICS code
  function addCustomNaics() {
    const code = customNaics.trim();
    if (code && /^\d{6}$/.test(code) && !selectedNaics.includes(code)) {
      setSelectedNaics(prev => [...prev, code]);
      setCustomNaics('');
    }
  }

  // Save profile and complete onboarding
  async function saveProfile() {
    if (!userEmail) return;

    setSaving(true);

    try {
      const supabase = getPlannerSupabase();
      const { data: { session } } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };

      const res = await fetch('/api/mindy/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          email: userEmail,
          businessDescription,
          naicsCodes: selectedNaics.length > 0 ? selectedNaics : ['541512', '541611', '541330'],
          setAsides: selectedSetAsides,
          onboardingComplete: true,
        }),
      });

      if (res.ok) {
        setCurrentStep('complete');
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          router.push('/app');
        }, 2000);
      } else {
        console.error('Failed to save profile');
      }
    } catch (err) {
      console.error('Error saving profile:', err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-xl shadow-purple-500/30 mx-auto mb-4">
            <span className="text-white font-bold text-3xl">M</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Set up your profile</h1>
          <p className="text-slate-400 mt-2">Help Mindy find the right opportunities for you</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {['business', 'naics', 'setaside'].map((step, idx) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep === step || (currentStep === 'complete' && idx <= 2)
                    ? 'bg-purple-600 text-white'
                    : ['naics', 'setaside', 'complete'].indexOf(currentStep) > idx
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {['naics', 'setaside', 'complete'].indexOf(currentStep) > idx ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              {idx < 2 && (
                <div className={`w-12 h-0.5 mx-1 ${['naics', 'setaside', 'complete'].indexOf(currentStep) > idx ? 'bg-emerald-500' : 'bg-slate-800'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          {/* Step 1: Business Description */}
          {currentStep === 'business' && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Tell us about your business</h2>
              <p className="text-slate-400 text-sm mb-6">
                Describe what your company does so Mindy can find relevant opportunities.
              </p>

              <textarea
                value={businessDescription}
                onChange={(e) => setBusinessDescription(e.target.value)}
                placeholder="Example: We provide IT support and cybersecurity services for federal agencies. We specialize in cloud migration, network security, and help desk support."
                rows={4}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              />

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setCurrentStep('naics')}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2: NAICS Codes */}
          {currentStep === 'naics' && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Select your NAICS codes</h2>
              <p className="text-slate-400 text-sm mb-6">
                Choose the industry codes that match your business. You can select multiple.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto mb-4">
                {NAICS_OPTIONS.map(({ code, label }) => (
                  <button
                    key={code}
                    onClick={() => toggleNaics(code)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                      selectedNaics.includes(code)
                        ? 'bg-purple-600/20 border-purple-500 text-white'
                        : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded flex items-center justify-center text-xs ${
                      selectedNaics.includes(code) ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-500'
                    }`}>
                      {selectedNaics.includes(code) ? '✓' : ''}
                    </span>
                    <div>
                      <div className="text-xs text-slate-500">{code}</div>
                      <div className="text-sm">{label}</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Custom NAICS input */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={customNaics}
                  onChange={(e) => setCustomNaics(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Add custom NAICS (6 digits)"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  onClick={addCustomNaics}
                  disabled={!/^\d{6}$/.test(customNaics)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>

              {selectedNaics.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {selectedNaics.map(code => (
                    <span key={code} className="px-3 py-1 bg-purple-600/20 text-purple-400 rounded-full text-sm flex items-center gap-2">
                      {code}
                      <button onClick={() => toggleNaics(code)} className="hover:text-white">&times;</button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex justify-between mt-6">
                <button
                  onClick={() => setCurrentStep('business')}
                  className="px-6 py-3 text-slate-400 hover:text-white transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setCurrentStep('setaside')}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Set-Asides */}
          {currentStep === 'setaside' && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Select your set-asides</h2>
              <p className="text-slate-400 text-sm mb-6">
                What certifications or designations does your business have? (Optional)
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
                {SET_ASIDE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => toggleSetAside(value)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                      selectedSetAsides.includes(value)
                        ? 'bg-purple-600/20 border-purple-500 text-white'
                        : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded flex items-center justify-center text-xs ${
                      selectedSetAsides.includes(value) ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-500'
                    }`}>
                      {selectedSetAsides.includes(value) ? '✓' : ''}
                    </span>
                    <span className="text-sm">{label}</span>
                  </button>
                ))}
              </div>

              <div className="flex justify-between mt-6">
                <button
                  onClick={() => setCurrentStep('naics')}
                  className="px-6 py-3 text-slate-400 hover:text-white transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Complete Setup'}
                </button>
              </div>
            </div>
          )}

          {/* Complete */}
          {currentStep === 'complete' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">You&apos;re all set!</h2>
              <p className="text-slate-400 mb-6">
                Mindy is now personalized to your business. Redirecting to your dashboard...
              </p>
              <Link
                href="/app"
                className="text-purple-400 hover:text-purple-300 font-medium"
              >
                Go to dashboard now
              </Link>
            </div>
          )}
        </div>

        {/* Skip link */}
        {currentStep !== 'complete' && (
          <div className="text-center mt-6">
            <button
              onClick={() => {
                saveProfile();
              }}
              className="text-slate-500 hover:text-slate-400 text-sm"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
