'use client';

import { useState } from 'react';
import { completeOnboarding } from '@/lib/supabase/gamification';
import { BADGE_DEFINITIONS } from '@/lib/supabase/gamification';

interface OnboardingFlowProps {
  userId: string;
  onComplete: () => void;
}

const phases = [
  { icon: '🏗️', name: 'Setup', tasks: 12, description: 'Register, certify, and build your foundation' },
  { icon: '📝', name: 'Bidding', tasks: 6, description: 'Find and respond to contract opportunities' },
  { icon: '🚀', name: 'Business Dev', tasks: 7, description: 'Build relationships with buyers and primes' },
  { icon: '⭐', name: 'Enhancement', tasks: 7, description: 'Certifications, mentors, and positioning' },
  { icon: '📋', name: 'Contract Mgmt', tasks: 4, description: 'Manage and grow active contracts' },
];

const features = [
  { icon: '✅', text: 'Check off tasks as you complete them' },
  { icon: '🔥', text: 'Build daily streaks to stay consistent' },
  { icon: '🏆', text: 'Earn 8 badges as you hit milestones' },
  { icon: '➕', text: 'Add your own custom tasks' },
  { icon: '📄', text: 'Export your progress as a PDF' },
];

export default function OnboardingFlow({ userId, onComplete }: OnboardingFlowProps) {
  const [screen, setScreen] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);

  const handleGetStarted = async () => {
    setIsCompleting(true);
    try {
      await completeOnboarding(userId);
      onComplete();
    } catch (error) {
      console.error('Error completing onboarding:', error);
      onComplete();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === screen ? 'w-8 bg-[#1e40af]' : 'w-2 bg-gray-300'
              }`}
            />
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          {/* Screen 1: Welcome */}
          {screen === 0 && (
            <div>
              <div className="bg-gradient-to-r from-[#1e40af] to-blue-600 px-8 py-10 text-center">
                <h1 className="text-2xl font-bold text-white mb-2">
                  Welcome to your GovCon Action Plan!
                </h1>
                <p className="text-blue-100 text-sm">
                  Your step-by-step system for winning government contracts
                </p>
              </div>
              <div className="px-8 py-8">
                <p className="text-gray-600 leading-relaxed mb-8">
                  This planner transforms the GovCon Giants 2026 Action Plan into a step-by-step system you can
                  track, customize, and complete at your own pace.
                </p>
                <button
                  onClick={() => setScreen(1)}
                  className="w-full bg-[#1e40af] text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Screen 2: Your 5 Phases */}
          {screen === 1 && (
            <div>
              <div className="bg-gradient-to-r from-[#1e40af] to-blue-600 px-8 py-6 text-center">
                <h2 className="text-xl font-bold text-white">Your 5 Phases</h2>
              </div>
              <div className="px-8 py-6">
                <div className="space-y-4 mb-8">
                  {phases.map((phase, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <span className="text-2xl flex-shrink-0 mt-0.5">{phase.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">Phase {i + 1}: {phase.name}</span>
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {phase.tasks} tasks
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">{phase.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setScreen(0)}
                    className="flex-1 border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setScreen(2)}
                    className="flex-1 bg-[#1e40af] text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Screen 3: Track Your Progress */}
          {screen === 2 && (
            <div>
              <div className="bg-gradient-to-r from-[#1e40af] to-blue-600 px-8 py-6 text-center">
                <h2 className="text-xl font-bold text-white">Track Your Progress</h2>
              </div>
              <div className="px-8 py-6">
                <div className="space-y-3 mb-6">
                  {features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <span className="text-xl flex-shrink-0">{feature.icon}</span>
                      <span className="text-gray-700">{feature.text}</span>
                    </div>
                  ))}
                </div>

                {/* Badge preview */}
                <div className="bg-gray-50 rounded-lg p-4 mb-8">
                  <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Badges to earn</p>
                  <div className="flex flex-wrap gap-2">
                    {BADGE_DEFINITIONS.map((badge) => (
                      <div
                        key={badge.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400"
                        title={badge.description}
                      >
                        <span className="grayscale opacity-50">{badge.icon}</span>
                        <span className="font-medium">{badge.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setScreen(1)}
                    className="flex-1 border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGetStarted}
                    disabled={isCompleting}
                    className="flex-1 bg-[#1e40af] text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCompleting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Loading...
                      </span>
                    ) : (
                      'Get Started'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
