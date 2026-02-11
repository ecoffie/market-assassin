'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getUserProgress, getPhases, type ProgressSummary } from '@/lib/supabase/planner';
import { useAuth } from '@/lib/supabase/AuthContext';
import { signOut } from '@/lib/supabase/auth';
import { getGamificationData, getOnboardingStatus, BADGE_DEFINITIONS, type GamificationData } from '@/lib/supabase/gamification';
import OnboardingFlow from '@/components/planner/OnboardingFlow';

// Phase icons mapping
const phaseIcons: Record<number, string> = {
  1: '🏗️',
  2: '📝',
  3: '🚀',
  4: '⭐',
  5: '📋',
};

// Circular Progress Component
function CircularProgress({ percentage, size = 200 }: { percentage: number; size?: number }) {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        className="transform -rotate-90"
        width={size}
        height={size}
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e5e7eb"
          strokeWidth="12"
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={percentage === 100 ? '#10b981' : '#1e40af'}
          strokeWidth="12"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className={`text-4xl font-bold ${percentage === 100 ? 'text-green-600' : 'text-[#1e40af]'}`}>{percentage}%</div>
        </div>
      </div>
    </div>
  );
}

// User Avatar Dropdown Component
function UserDropdown({ email }: { email?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.push('/planner/login');
  };

  // Get initials from email
  const initials = email ? email.charAt(0).toUpperCase() : 'U';

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-full bg-gray-100 hover:bg-gray-200 p-2 transition-colors"
      >
        <div className="h-8 w-8 rounded-full bg-[#1e40af] flex items-center justify-center text-white font-semibold">
          {initials}
        </div>
        <svg
          className={`h-4 w-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-56 rounded-lg bg-white shadow-lg border border-gray-200 z-20">
            <div className="p-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900 truncate">{email || 'User'}</p>
            </div>
            <div className="p-2">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Phase type for display
interface PhaseDisplay {
  id: number;
  name: string;
  progress: number;
  completed: number;
  total: number;
  icon: string;
}

// Phase Card Component
function PhaseCard({ phase }: { phase: PhaseDisplay }) {
  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow relative">
      {/* Phase complete badge */}
      {phase.progress === 100 && (
        <div className="absolute -top-2 -right-2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-md">
          <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{phase.icon}</span>
          <div>
            <h3 className="font-semibold text-lg text-gray-900">
              Phase {phase.id}: {phase.name}
            </h3>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">{phase.progress}% Complete</span>
          <span className="text-sm font-medium text-gray-700">
            {phase.completed}/{phase.total} tasks
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all duration-500 ${phase.progress === 100 ? 'bg-green-500' : 'bg-[#1e40af]'}`}
            style={{ width: `${phase.progress}%` }}
          />
        </div>
      </div>

      <Link
        href={`/planner/phase/${phase.id}`}
        className="block w-full text-center px-4 py-2 bg-[#1e40af] text-white rounded-md hover:bg-blue-700 transition-colors font-medium text-sm"
      >
        View Phase
      </Link>
    </div>
  );
}

// Gamification Card Component
function GamificationCard({ data }: { data: GamificationData }) {
  const earnedBadgeIds = new Set(data.badges.map(b => b.id));

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-8">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Your Progress</h2>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Streak */}
        <div className="flex items-center gap-3">
          <div className="text-3xl">🔥</div>
          <div>
            <div className="text-2xl font-bold text-[#1e40af]">{data.currentStreak}</div>
            <div className="text-sm text-gray-500">day streak</div>
          </div>
        </div>

        {/* Best streak */}
        <div className="flex items-center gap-3">
          <div className="text-3xl">⭐</div>
          <div>
            <div className="text-2xl font-bold text-[#1e40af]">{data.longestStreak}</div>
            <div className="text-sm text-gray-500">best streak</div>
          </div>
        </div>

        {/* Badge count */}
        <div className="flex items-center gap-3">
          <div className="text-3xl">🏆</div>
          <div>
            <div className="text-2xl font-bold text-[#1e40af]">{data.badges.length}</div>
            <div className="text-sm text-gray-500">badges earned</div>
          </div>
        </div>
      </div>

      {/* Badges Row */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex flex-wrap gap-2">
          {BADGE_DEFINITIONS.map((badge) => {
            const earned = earnedBadgeIds.has(badge.id);
            return (
              <div
                key={badge.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${
                  earned
                    ? 'bg-[#1e40af] text-white'
                    : 'bg-gray-100 text-gray-400'
                }`}
                title={earned ? `${badge.name}: ${badge.description}` : `Locked: ${badge.description}`}
              >
                <span className={earned ? '' : 'grayscale opacity-50'}>{badge.icon}</span>
                <span className="font-medium">{badge.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Sidebar Component
function Sidebar({ isOpen, onClose, phases }: { isOpen: boolean; onClose: () => void; phases: PhaseDisplay[] }) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen lg:h-auto bg-white border-r border-gray-200 z-40 w-64 transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Phases</h2>
            <button
              onClick={onClose}
              className="lg:hidden text-gray-500 hover:text-gray-700"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="space-y-2">
            {phases.map((phase) => (
              <Link
                key={phase.id}
                href={`/planner/phase/${phase.id}`}
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors group"
                onClick={onClose}
              >
                <span className="text-2xl">{phase.icon}</span>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 group-hover:text-[#1e40af] transition-colors">
                    {phase.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {phase.completed}/{phase.total} tasks
                  </div>
                </div>
                {phase.progress === 100 ? (
                  <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className="w-2 h-2 rounded-full bg-[#1e40af] opacity-60" />
                )}
              </Link>
            ))}

            {/* Resources Link */}
            <div className="pt-4 mt-4 border-t border-gray-200">
              <Link
                href="/planner/resources"
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors group"
                onClick={onClose}
              >
                <span className="text-2xl">📚</span>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 group-hover:text-[#1e40af] transition-colors">
                    Resources
                  </div>
                  <div className="text-xs text-gray-500">
                    Videos, templates & tips
                  </div>
                </div>
                <svg className="h-4 w-4 text-gray-400 group-hover:text-[#1e40af] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </nav>
        </div>
      </aside>
    </>
  );
}

// Motivational quotes
const quotes = [
  { text: "Consistency wins contracts", author: "Eric Coffie" },
  { text: "Your network is your net worth in government contracting", author: "Eric Coffie" },
  { text: "Every 'no' gets you closer to a 'yes'", author: "Eric Coffie" },
  { text: "Preparation meets opportunity in government contracting", author: "Eric Coffie" },
];

export default function PlannerPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [phases, setPhases] = useState<PhaseDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentQuote] = useState(() => Math.floor(Math.random() * quotes.length));
  const [gamification, setGamification] = useState<GamificationData | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/planner/login');
    }
  }, [authLoading, isAuthenticated, router]);

  // Fetch progress from Supabase
  useEffect(() => {
    async function fetchProgress() {
      if (!user?.id) return;

      try {
        setIsLoading(true);
        setError(null);

        // Fetch progress, gamification, and onboarding status in parallel
        const [progressData, gamificationData, onboardingStatus] = await Promise.all([
          getUserProgress(user.id),
          getGamificationData(user.id),
          getOnboardingStatus(user.id),
        ]);

        setProgress(progressData);
        setGamification(gamificationData);
        setOnboardingCompleted(onboardingStatus);

        // Map phases with icons
        const phasesWithIcons: PhaseDisplay[] = progressData.phases.map((p) => ({
          id: p.phaseId,
          name: p.phaseName,
          progress: p.progress,
          completed: p.completed,
          total: p.total,
          icon: phaseIcons[p.phaseId] || '📋',
        }));
        setPhases(phasesWithIcons);
      } catch (err) {
        console.error('Error fetching progress:', err);
        setError('Failed to load progress. Please try again.');

        // Fallback to default phases if Supabase fails
        const defaultPhases = getPhases();
        setPhases(defaultPhases.map(p => ({
          id: p.id,
          name: p.name,
          progress: 0,
          completed: 0,
          total: 0,
          icon: p.icon,
        })));
      } finally {
        setIsLoading(false);
      }
    }

    if (isAuthenticated && user) {
      fetchProgress();
    }
  }, [user, isAuthenticated]);

  // Loading state (auth or data)
  if (authLoading || (isAuthenticated && isLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e40af] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your action plan...</p>
        </div>
      </div>
    );
  }

  // Don't render anything while redirecting to login
  if (!isAuthenticated) {
    return null;
  }

  // Show onboarding for first-time users
  if (onboardingCompleted === false && user) {
    return (
      <OnboardingFlow
        userId={user.id}
        onComplete={() => setOnboardingCompleted(true)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navbar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-gray-600 hover:text-gray-900"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <Link href="/planner" className="flex items-center gap-2">
                <span className="text-xl font-bold text-[#1e40af]">GovCon Giants</span>
                <span className="text-xl font-bold text-gray-700">Planner</span>
              </Link>
            </div>
            <UserDropdown email={user?.email} />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Banner */}
        {error && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-6">
            <p className="text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-8">
          {/* Sidebar */}
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} phases={phases} />

          {/* Main Content Area */}
          <div className="flex-1">
            {/* Hero Section */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 mb-8">
              <div className="flex flex-col md:flex-row items-center gap-8">
                {/* Circular Progress */}
                <div className="flex-shrink-0">
                  <CircularProgress percentage={progress?.overall || 0} size={200} />
                </div>

                {/* Hero Text */}
                <div className="flex-1 text-center md:text-left">
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">
                    You&apos;re {progress?.overall || 0}% through your 2026 GovCon Action Plan
                  </h1>
                  <p className="text-lg text-gray-600 mb-6">
                    {progress?.completedTasks || 0} of {progress?.totalTasks || 36} tasks completed
                  </p>

                  {/* Motivational Quote Card */}
                  <div className="bg-gradient-to-r from-[#1e40af] to-blue-600 rounded-lg p-4 text-white shadow-md">
                    <p className="text-lg font-semibold italic mb-1">
                      &quot;{quotes[currentQuote].text}&quot;
                    </p>
                    <p className="text-sm opacity-90">— {quotes[currentQuote].author}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Gamification Card */}
            {gamification && <GamificationCard data={gamification} />}

            {/* Phase Summary Cards Grid */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Your Action Plan Phases</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {phases.map((phase) => (
                  <PhaseCard key={phase.id} phase={phase} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
