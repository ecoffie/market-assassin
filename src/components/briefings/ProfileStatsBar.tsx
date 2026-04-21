'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ProfileStatsBarProps {
  email: string;
  onTabChange?: (tab: string) => void;
}

interface ProfileStats {
  totalActiveMatching: number;
  matchesToday: number;
  matchesThisWeek: number;
  weeklyChange: number;
  trend: 'up' | 'down' | 'neutral';
  forecastsMatching: number;
  briefingsThisWeek: number;
}

interface ProfileStatsResponse {
  success: boolean;
  hasProfile: boolean;
  message: string;
  stats: ProfileStats | null;
  profileSummary?: {
    naicsCount: number;
    keywordsCount: number;
  };
}

export default function ProfileStatsBar({ email, onTabChange }: ProfileStatsBarProps) {
  const [stats, setStats] = useState<ProfileStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`/api/briefings/profile-stats?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        setStats(data);
      } catch {
        console.error('Failed to fetch profile stats');
      } finally {
        setLoading(false);
      }
    }

    if (email) {
      fetchStats();
    }
  }, [email]);

  if (loading) {
    return (
      <div className="bg-gradient-to-r from-purple-900/30 to-purple-800/20 border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="animate-pulse flex items-center gap-4">
            <div className="h-4 w-48 bg-purple-700/30 rounded"></div>
            <div className="h-4 w-24 bg-purple-700/30 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!stats || !stats.success || !stats.hasProfile || !stats.stats) {
    return null; // Don't show if no profile
  }

  const { stats: profileStats } = stats;

  const getTrendIcon = () => {
    if (profileStats.trend === 'up') {
      return (
        <span className="inline-flex items-center text-green-400 text-xs font-medium">
          <svg className="w-3 h-3 mr-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {profileStats.weeklyChange}%
        </span>
      );
    }
    if (profileStats.trend === 'down') {
      return (
        <span className="inline-flex items-center text-red-400 text-xs font-medium">
          <svg className="w-3 h-3 mr-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {Math.abs(profileStats.weeklyChange)}%
        </span>
      );
    }
    return null;
  };

  return (
    <div className="bg-gradient-to-r from-purple-900/30 via-purple-800/20 to-purple-900/30 border-b border-purple-500/20">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Main headline stat - clickable to dashboard with profile filter */}
          <Link
            href={`/briefings/dashboard?email=${encodeURIComponent(email)}`}
            className="flex items-center gap-2 hover:bg-purple-500/10 rounded-lg px-2 py-1 -mx-2 transition-colors group"
          >
            <span className="text-lg">🎯</span>
            <span className="text-white font-semibold group-hover:text-purple-300">
              {profileStats.totalActiveMatching.toLocaleString()}
            </span>
            <span className="text-gray-300 text-sm group-hover:text-purple-200">opportunities match your profile</span>
            {getTrendIcon()}
            <span className="text-gray-500 group-hover:text-purple-400 text-xs">→</span>
          </Link>

          {/* Divider */}
          <div className="hidden sm:block w-px h-4 bg-gray-700"></div>

          {/* Secondary stats */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {profileStats.matchesToday > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-green-400 font-medium">{profileStats.matchesToday} new today</span>
              </div>
            )}

            <Link
              href={`/briefings/dashboard?email=${encodeURIComponent(email)}`}
              className="flex items-center gap-1.5 text-gray-400 hover:text-purple-300 transition-colors"
            >
              <span>📅</span>
              <span>{profileStats.matchesThisWeek} this week</span>
            </Link>

            {profileStats.forecastsMatching > 0 && (
              <button
                onClick={() => onTabChange?.('forecasts')}
                className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
              >
                <span>🔮</span>
                <span>{profileStats.forecastsMatching} forecasts</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
