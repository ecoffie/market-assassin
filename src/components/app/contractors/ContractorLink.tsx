'use client';

/**
 * ContractorLink — wraps a contractor / prime / incumbent name as a
 * clickable element that opens the existing
 * ContractorSalesHistoryDrawer with that contractor selected.
 *
 * Why this exists: every place in Mindy that surfaces a contractor
 * name (Top 5 Primes, Source Feed cards, Today's Intel, Recompete
 * incumbents, My Pursuits winners, teaming suggestions) should let
 * the user one-click into the YoY award-history chart we already
 * built. Pre-wrapper, those names were dead text. Now they're
 * the primary discovery path for a key Pro feature.
 *
 * Mounting strategy: each ContractorLink instance owns its own
 * drawer state. That keeps the surface call sites trivial — drop
 * <ContractorLink>{name}</ContractorLink> in place of a span. The
 * drawer renders as a fixed-position overlay so multiple links on
 * the same page don't conflict (only one drawer is ever open at a
 * time because mounting overlay + portal-less z-50 short-circuits
 * subsequent opens).
 *
 * Accessibility: rendered as <button type="button"> with the
 * contractor name as the accessible label. Underline + hover
 * indicates clickability without screaming "this is a link" (it's
 * not navigation; it opens an inline drawer).
 */

import { useState } from 'react';
import ContractorSalesHistoryDrawer from './ContractorSalesHistoryDrawer';

interface ContractorLinkProps {
  /** Display name of the contractor / prime / incumbent. */
  name: string;
  /** User email — needed by the drawer to authenticate the API call. */
  email: string | null;
  /**
   * Optional pre-fetched summary fields. When the calling surface
   * already has these in its data shape (e.g. Contractors panel),
   * pass them through so the drawer doesn't re-fetch. When we only
   * have the name (e.g. an incumbent string from a SAM opp), the
   * drawer falls back to empty defaults and fetches what it needs.
   */
  contractValueNum?: number;
  contractCount?: string;
  agencies?: string;
  naics?: string;
  /**
   * Visual variant. 'inline' = looks like a link in body text
   * ('underlined emerald on hover'). 'plain' = no underline, just
   * cursor-pointer + slight color shift, for use inside chips /
   * cards where an underline would feel noisy.
   */
  variant?: 'inline' | 'plain';
  /** Extra Tailwind classes to merge. */
  className?: string;
  /** Children override the auto-rendered name (e.g. truncated text). */
  children?: React.ReactNode;
}

export default function ContractorLink({
  name,
  email,
  contractValueNum,
  contractCount,
  agencies,
  naics,
  variant = 'inline',
  className = '',
  children,
}: ContractorLinkProps) {
  const [open, setOpen] = useState(false);

  // Don't render as a link if there's no name to look up — degrades
  // gracefully when an upstream surface passes an empty string.
  if (!name || !name.trim()) {
    return <>{children || name}</>;
  }

  const styleClass = variant === 'inline'
    ? 'text-emerald-300 hover:text-emerald-200 hover:underline underline-offset-2 decoration-emerald-500/40'
    : 'text-slate-200 hover:text-emerald-300';

  // The drawer wants a ContractorSummary shape. We pass what the
  // call site gave us; fall back to safe defaults so it can render
  // even when we only know the name.
  const contractor = {
    company: name,
    contract_value_num: contractValueNum ?? 0,
    contract_count: contractCount ?? '0',
    agencies: agencies ?? '',
    naics: naics ?? '',
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop propagation so the link click doesn't trigger an
          // outer row click (e.g. Source Feed card click → expand).
          e.stopPropagation();
          setOpen(true);
        }}
        title={`See ${name}'s federal award history`}
        aria-label={`Open award history for ${name}`}
        className={`text-left cursor-pointer transition-colors ${styleClass} ${className}`}
      >
        {children || name}
      </button>

      {open && (
        <ContractorSalesHistoryDrawer
          contractor={contractor}
          email={email}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
