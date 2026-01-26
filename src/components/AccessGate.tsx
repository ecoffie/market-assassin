'use client';

import { useEffect, useState, ReactNode } from 'react';
import Link from 'next/link';
import { ProductAccessType, hasAccessCookie, checkMarketAssassinAccess, checkContentGeneratorAccess } from '@/lib/access-check';

interface AccessGateProps {
  /**
   * The product access type to check
   */
  accessType: ProductAccessType;

  /**
   * Optional: require a specific tier (for MA or Content Generator)
   * - 'premium' for Market Assassin Premium
   * - 'full_fix' for Content Generator Full Fix
   */
  requiredTier?: 'standard' | 'premium' | 'full_fix';

  /**
   * Content to show when user has access
   */
  children: ReactNode;

  /**
   * Custom locked content (optional)
   * If not provided, shows default locked message
   */
  lockedContent?: ReactNode;

  /**
   * Product name for display in locked message
   */
  productName?: string;

  /**
   * Purchase URL for the upgrade button
   */
  purchaseUrl?: string;

  /**
   * If true, shows a loading state while checking
   */
  showLoading?: boolean;
}

/**
 * AccessGate Component
 *
 * Wraps content that should only be visible to users with access.
 * Shows a locked message or custom content if access is denied.
 *
 * Usage:
 * ```tsx
 * <AccessGate accessType="access_assassin_standard" productName="Federal Market Assassin">
 *   <MyProtectedContent />
 * </AccessGate>
 * ```
 */
export function AccessGate({
  accessType,
  requiredTier,
  children,
  lockedContent,
  productName = 'this feature',
  purchaseUrl = '/',
  showLoading = false,
}: AccessGateProps) {
  const [hasAccess, setHasAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTier, setCurrentTier] = useState<string | null>(null);

  useEffect(() => {
    // Check access from cookies
    const checkAccess = () => {
      let accessGranted = hasAccessCookie(accessType);
      let tier: string | null = null;

      // Check tier for Market Assassin
      if (accessType === 'access_assassin_standard' || accessType === 'access_assassin_premium') {
        const maAccess = checkMarketAssassinAccess();
        accessGranted = maAccess.hasAccess;
        tier = maAccess.tier;

        // If premium is required, check tier
        if (requiredTier === 'premium' && tier !== 'premium') {
          accessGranted = false;
        }
      }
      // Check tier for Content Generator
      else if (accessType === 'access_content_standard' || accessType === 'access_content_full_fix') {
        const cgAccess = checkContentGeneratorAccess();
        accessGranted = cgAccess.hasAccess;
        tier = cgAccess.tier;

        // If full_fix is required, check tier
        if (requiredTier === 'full_fix' && tier !== 'full_fix') {
          accessGranted = false;
        }
      }

      setHasAccess(accessGranted);
      setCurrentTier(tier);
      setIsLoading(false);
    };

    // Small delay to ensure cookies are available
    const timer = setTimeout(checkAccess, 50);
    return () => clearTimeout(timer);
  }, [accessType, requiredTier]);

  // Loading state
  if (isLoading && showLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // User has access
  if (hasAccess) {
    return <>{children}</>;
  }

  // User doesn't have access - show locked content
  if (lockedContent) {
    return <>{lockedContent}</>;
  }

  // Default locked message
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg
          className="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Access Required
      </h3>

      <p className="text-gray-600 mb-6">
        {requiredTier && currentTier ? (
          <>
            You have {currentTier} access, but {requiredTier} access is required for {productName}.
          </>
        ) : (
          <>
            You need access to {productName} to view this content.
          </>
        )}
      </p>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/activate"
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          Activate License
        </Link>

        {purchaseUrl && purchaseUrl !== '/' && (
          <Link
            href={purchaseUrl}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
          >
            {requiredTier ? 'Upgrade' : 'Purchase'}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Simple hook for checking access in components
 */
export function useProductAccess(accessType: ProductAccessType, requiredTier?: string): {
  hasAccess: boolean;
  tier: string | null;
  isLoading: boolean;
} {
  const [hasAccess, setHasAccess] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const check = () => {
      let access = hasAccessCookie(accessType);
      let currentTier: string | null = null;

      if (accessType === 'access_assassin_standard' || accessType === 'access_assassin_premium') {
        const maAccess = checkMarketAssassinAccess();
        access = maAccess.hasAccess;
        currentTier = maAccess.tier;
        if (requiredTier === 'premium' && currentTier !== 'premium') {
          access = false;
        }
      } else if (accessType === 'access_content_standard' || accessType === 'access_content_full_fix') {
        const cgAccess = checkContentGeneratorAccess();
        access = cgAccess.hasAccess;
        currentTier = cgAccess.tier;
        if (requiredTier === 'full_fix' && currentTier !== 'full_fix') {
          access = false;
        }
      }

      setHasAccess(access);
      setTier(currentTier);
      setIsLoading(false);
    };

    const timer = setTimeout(check, 50);
    return () => clearTimeout(timer);
  }, [accessType, requiredTier]);

  return { hasAccess, tier, isLoading };
}

export default AccessGate;
