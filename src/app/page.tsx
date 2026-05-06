'use client';

import { useEffect, useCallback, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import UnifiedSidebar, { type MIPanel, type MITier } from '@/components/UnifiedSidebar';
import PanelContainer from '@/components/panels/PanelContainer';
import { useMI } from '@/context/MIContext';
import MarketIntelligenceHeader from '@/components/briefings/MarketIntelligenceHeader';
import OnboardingWizard from '@/components/briefings/OnboardingWizard';
import SettingsPanel from '@/components/briefings/SettingsPanel';

// Default NAICS codes for new users
const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);

// Loading fallback for Suspense boundary
function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Loading Market Intelligence...</p>
      </div>
    </div>
  );
}

// Wrap the dashboard in Suspense for useSearchParams
export default function MIDashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <MIDashboard />
    </Suspense>
  );
}

function MIDashboard() {
  const {
    email,
    tier,
    profile,
    activePanel,
    setActivePanel,
    isSettingsOpen,
    setIsSettingsOpen,
    showOnboarding,
    setShowOnboarding,
    isLoading,
    setEmail,
    setTier,
    setProfile,
    setIsLoading,
  } = useMI();

  const searchParams = useSearchParams();

  // Load user profile on mount
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      loadUserProfile(emailParam);
    } else {
      // Check for stored email in localStorage
      const storedEmail = typeof window !== 'undefined'
        ? localStorage.getItem('mi_email')
        : null;
      if (storedEmail) {
        loadUserProfile(storedEmail);
      } else {
        setIsLoading(false);
      }
    }
  }, [searchParams]);

  const loadUserProfile = useCallback(async (userEmail: string) => {
    setIsLoading(true);
    try {
      // Fetch user profile and access level
      const [profileRes, accessRes] = await Promise.all([
        fetch(`/api/alerts/preferences?email=${encodeURIComponent(userEmail)}`),
        fetch(`/api/access/check?email=${encodeURIComponent(userEmail)}`),
      ]);

      const profileData = profileRes.ok ? await profileRes.json() : null;
      const accessData = accessRes.ok ? await accessRes.json() : null;

      // Determine tier based on access data
      let userTier: MITier = 'free';
      if (accessData?.access) {
        const access = accessData.access;
        // Check for various paid access types
        if (access.briefings || access.mi_pro || access.team) {
          userTier = access.team ? 'team' : 'pro';
        } else if (access.enterprise) {
          userTier = 'enterprise';
        }
      }

      // Check if user needs onboarding
      const naicsCodes = profileData?.profile?.naics_codes || [];
      const hasCustomNaics = naicsCodes.length > 0 &&
        !naicsCodes.every((code: string) => DEFAULT_NAICS_SET.has(code));

      setEmail(userEmail);
      setTier(userTier);
      setProfile({
        naicsCodes: naicsCodes,
        targetAgencies: profileData?.profile?.target_agencies || [],
        keywords: profileData?.profile?.keywords || [],
        pscCodes: profileData?.profile?.psc_codes || [],
        states: profileData?.profile?.target_states || [],
        setAsides: profileData?.profile?.set_aside_types || [],
        businessDescription: profileData?.profile?.business_description || '',
      });

      // Show onboarding if no custom NAICS configured
      setShowOnboarding(!hasCustomNaics);

      // Store email in localStorage for session persistence
      if (typeof window !== 'undefined') {
        localStorage.setItem('mi_email', userEmail);
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
    } finally {
      setIsLoading(false);
    }
  }, [setEmail, setTier, setProfile, setShowOnboarding, setIsLoading]);

  const handlePanelChange = (panel: MIPanel) => {
    setActivePanel(panel);
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  const handleEmailChange = (newEmail: string) => {
    loadUserProfile(newEmail);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading Market Intelligence...</p>
        </div>
      </div>
    );
  }

  // Not logged in state
  if (!email) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-16">
          {/* Hero */}
          <div className="text-center mb-12">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mx-auto mb-6">
              <span className="text-white font-bold text-2xl">MI</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Market Intelligence
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              AI-powered intelligence for federal contractors. Daily briefings, opportunity alerts,
              market research, and pipeline tracking — all in one place.
            </p>
          </div>

          {/* Email Entry */}
          <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-8 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-white mb-4 text-center">
              Enter your email to continue
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const emailValue = formData.get('email') as string;
                if (emailValue) {
                  loadUserProfile(emailValue);
                }
              }}
              className="space-y-4"
            >
              <input
                type="email"
                name="email"
                placeholder="your@email.com"
                required
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              />
              <button
                type="submit"
                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
              >
                Access Dashboard
              </button>
            </form>
            <p className="text-center text-gray-500 text-sm mt-4">
              New here?{' '}
              <a href="/market-intelligence" className="text-emerald-400 hover:text-emerald-300">
                View pricing →
              </a>
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {[
              { icon: '📊', title: 'AI Briefings', desc: 'Daily + Weekly + Pursuit intelligence' },
              { icon: '🔍', title: 'Market Research', desc: '10 strategic reports' },
              { icon: '🎯', title: 'Pipeline Tracker', desc: 'Manage your pursuits' },
              { icon: '🔮', title: 'Forecasts', desc: '7,700+ upcoming procurements' },
              { icon: '⏰', title: 'Recompetes', desc: '12,000+ expiring contracts' },
              { icon: '🏢', title: 'Contractors', desc: '3,500+ with SBLO contacts' },
            ].map((feature) => (
              <div
                key={feature.title}
                className="bg-gray-900/30 rounded-xl border border-gray-800 p-6 text-center"
              >
                <span className="text-3xl mb-3 block">{feature.icon}</span>
                <h3 className="text-white font-medium mb-1">{feature.title}</h3>
                <p className="text-gray-500 text-sm">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar Navigation */}
      <UnifiedSidebar
        activePanel={activePanel}
        onPanelChange={handlePanelChange}
        userTier={tier}
      />

      {/* Main Content Area */}
      <main className="flex-1 min-h-screen overflow-y-auto">
        {/* Header */}
        <MarketIntelligenceHeader
          email={email}
          onSettingsClick={() => setIsSettingsOpen(true)}
          onSwitchAccount={() => {
            localStorage.removeItem('mi_email');
            setEmail(null);
            setProfile(null);
          }}
        />

        {/* Panel Content */}
        <div className="p-6">
          <PanelContainer />
        </div>
      </main>

      {/* Settings Slide-out Panel */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={handleSettingsClose}
        email={email}
        onSaved={() => {
          // Refresh profile after save
          loadUserProfile(email);
        }}
      />

      {/* Onboarding Wizard */}
      {showOnboarding && (
        <OnboardingWizard
          email={email}
          onComplete={handleOnboardingComplete}
          isFreeUser={tier === 'free'}
        />
      )}
    </div>
  );
}
