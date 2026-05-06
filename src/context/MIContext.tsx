'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { MIPanel, MITier } from '@/components/UnifiedSidebar';

// User profile data (loaded once, shared everywhere)
export interface MIUserProfile {
  naicsCodes: string[];
  pscCodes: string[];
  keywords: string[];
  targetAgencies: string[];
  states: string[];
  setAsides: string[];
  businessDescription: string;
}

// Cache keys for data invalidation
export type CacheKey =
  | 'opportunities'
  | 'forecasts'
  | 'contractors'
  | 'recompetes'
  | 'userProfile';

// Main context interface
export interface MIContextValue {
  // User info
  email: string | null;
  setEmail: (email: string | null) => void;
  tier: MITier;
  setTier: (tier: MITier) => void;

  // User profile (NAICS, agencies, etc.)
  profile: MIUserProfile | null;
  setProfile: (profile: MIUserProfile | null) => void;
  updateProfile: (partial: Partial<MIUserProfile>) => void;

  // Panel navigation
  activePanel: MIPanel;
  setActivePanel: (panel: MIPanel) => void;

  // UI state
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Cache control
  invalidateCache: (key: CacheKey) => void;
  cacheVersion: Record<CacheKey, number>;
}

// Default profile with common defaults
const DEFAULT_PROFILE: MIUserProfile = {
  naicsCodes: ['541512', '541611', '541330', '541990', '561210'],
  pscCodes: [],
  keywords: [],
  targetAgencies: [],
  states: [],
  setAsides: [],
  businessDescription: '',
};

const MIContext = createContext<MIContextValue | null>(null);

interface MIProviderProps {
  children: ReactNode;
  initialEmail?: string | null;
  initialTier?: MITier;
  initialPanel?: MIPanel;
}

export function MIProvider({
  children,
  initialEmail = null,
  initialTier = 'free',
  initialPanel = 'dashboard'
}: MIProviderProps) {
  // User state
  const [email, setEmail] = useState<string | null>(initialEmail);
  const [tier, setTier] = useState<MITier>(initialTier);
  const [profile, setProfile] = useState<MIUserProfile | null>(null);

  // Navigation state
  const [activePanel, setActivePanel] = useState<MIPanel>(initialPanel);

  // UI state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Cache versioning for React Query invalidation
  const [cacheVersion, setCacheVersion] = useState<Record<CacheKey, number>>({
    opportunities: 0,
    forecasts: 0,
    contractors: 0,
    recompetes: 0,
    userProfile: 0,
  });

  // Update profile partially
  const updateProfile = useCallback((partial: Partial<MIUserProfile>) => {
    setProfile(prev => {
      if (!prev) return { ...DEFAULT_PROFILE, ...partial };
      return { ...prev, ...partial };
    });
  }, []);

  // Invalidate cache by incrementing version
  const invalidateCache = useCallback((key: CacheKey) => {
    setCacheVersion(prev => ({
      ...prev,
      [key]: prev[key] + 1,
    }));
  }, []);

  const value: MIContextValue = {
    email,
    setEmail,
    tier,
    setTier,
    profile,
    setProfile,
    updateProfile,
    activePanel,
    setActivePanel,
    isSettingsOpen,
    setIsSettingsOpen,
    showOnboarding,
    setShowOnboarding,
    isLoading,
    setIsLoading,
    invalidateCache,
    cacheVersion,
  };

  return (
    <MIContext.Provider value={value}>
      {children}
    </MIContext.Provider>
  );
}

// Hook to use MI context
export function useMI() {
  const context = useContext(MIContext);
  if (!context) {
    throw new Error('useMI must be used within an MIProvider');
  }
  return context;
}

// Hook for just the user email (common use case)
export function useMIEmail() {
  const { email } = useMI();
  return email;
}

// Hook for tier checking
export function useMITier() {
  const { tier } = useMI();
  return tier;
}

// Hook for profile
export function useMIProfile() {
  const { profile, updateProfile } = useMI();
  return { profile, updateProfile };
}

// Check if user has pro access
export function useHasProAccess() {
  const { tier } = useMI();
  return tier === 'pro' || tier === 'team' || tier === 'enterprise';
}

export default MIContext;
