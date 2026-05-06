'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import UnifiedSidebarBeta, { type MIBetaPanel, type MIBetaTier } from '@/components/mi-beta/UnifiedSidebarBeta';
import PanelContainer from '@/components/mi-beta/panels';
import SettingsPanel from '@/components/briefings/SettingsPanel';

// Loading fallback
function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Loading Market Intelligence Beta...</p>
      </div>
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function MIBetaPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <MIBetaDashboard />
    </Suspense>
  );
}

interface UserProfile {
  naicsCodes: string[];
  targetAgencies: string[];
  keywords: string[];
  states: string[];
}

function MIBetaDashboard() {
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<MIBetaTier>('free');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activePanel, setActivePanel] = useState<MIBetaPanel>('dashboard');
  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const searchParams = useSearchParams();

  // Load user profile on mount
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      loadUserProfile(emailParam);
    } else {
      // Check localStorage
      const storedEmail = typeof window !== 'undefined'
        ? localStorage.getItem('mi_beta_email')
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
      let userTier: MIBetaTier = 'free';
      if (accessData?.access) {
        const access = accessData.access;
        if (access.briefings || access.mi_pro || access.team) {
          userTier = access.team ? 'team' : 'pro';
        } else if (access.enterprise) {
          userTier = 'enterprise';
        }
      }

      setEmail(userEmail);
      setTier(userTier);
      setProfile({
        naicsCodes: profileData?.profile?.naics_codes || [],
        targetAgencies: profileData?.profile?.target_agencies || [],
        keywords: profileData?.profile?.keywords || [],
        states: profileData?.profile?.target_states || [],
      });

      // Store email in localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('mi_beta_email', userEmail);
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Loading state
  if (isLoading) {
    return <DashboardLoading />;
  }

  // Not logged in state
  if (!email) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-16">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 bg-amber-500/20 border border-amber-500/30 rounded-full text-amber-400 text-sm font-medium mb-4">
              BETA - Testing Environment
            </div>
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mx-auto mb-6">
              <span className="text-white font-bold text-2xl">MI</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Unified Market Intelligence
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              All your GovCon tools in one place. AI briefings, market research,
              forecasts, pipeline tracking, and more.
            </p>
          </div>

          {/* Email Entry */}
          <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-8 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-white mb-4 text-center">
              Enter your email to test
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
                Access Beta Dashboard
              </button>
            </form>
            <div className="mt-6 pt-6 border-t border-gray-800">
              <p className="text-center text-gray-500 text-sm mb-3">
                Testing different tiers:
              </p>
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => {
                    setEmail('test-free@test.com');
                    setTier('free');
                    setProfile({ naicsCodes: ['541512'], targetAgencies: [], keywords: [], states: [] });
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg transition-colors"
                >
                  Free Tier
                </button>
                <button
                  onClick={() => {
                    setEmail('test-pro@test.com');
                    setTier('pro');
                    setProfile({ naicsCodes: ['541512'], targetAgencies: [], keywords: [], states: [] });
                  }}
                  className="px-3 py-1.5 text-xs bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg transition-colors"
                >
                  Pro Tier
                </button>
              </div>
            </div>
            <p className="text-center text-gray-500 text-sm mt-4">
              Production version:{' '}
              <a href="/briefings" className="text-emerald-400 hover:text-emerald-300">
                /briefings →
              </a>
            </p>
          </div>

          {/* Feature Preview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-16">
            {[
              { icon: '📊', title: 'AI Briefings', desc: 'Daily/Weekly/Pursuit' },
              { icon: '🎯', title: 'Market Research', desc: '10 reports' },
              { icon: '🔮', title: 'Forecasts', desc: '7,700+ opps' },
              { icon: '📈', title: 'Pipeline', desc: 'Track pursuits' },
            ].map((feature) => (
              <div
                key={feature.title}
                className="bg-gray-900/30 rounded-xl border border-gray-800 p-4 text-center"
              >
                <span className="text-2xl mb-2 block">{feature.icon}</span>
                <h3 className="text-white font-medium text-sm mb-0.5">{feature.title}</h3>
                <p className="text-gray-500 text-xs">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Logged in - show dashboard
  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar */}
      <UnifiedSidebarBeta
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        userTier={tier}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Settings Panel */}
      {email && (
        <SettingsPanel
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          email={email}
          onSaved={() => {
            loadUserProfile(email);
            setIsSettingsOpen(false);
          }}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 min-h-screen overflow-y-auto">
        {/* Top Bar */}
        <header className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="px-2 py-1 text-xs bg-amber-500/20 text-amber-400 rounded">
                BETA
              </span>
              <span className="text-sm text-slate-400">
                Logged in as <span className="text-white">{email}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`
                px-2 py-1 text-xs rounded
                ${tier === 'free' ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500/20 text-emerald-400'}
              `}>
                {tier === 'free' ? 'Free' : 'Pro'} Plan
              </span>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                title="Settings & Preferences"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('mi_beta_email');
                  setEmail(null);
                  setProfile(null);
                }}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Switch Account
              </button>
            </div>
          </div>
        </header>

        {/* Panel Content */}
        <PanelContainer
          activePanel={activePanel}
          email={email}
          tier={tier}
        />
      </main>
    </div>
  );
}
