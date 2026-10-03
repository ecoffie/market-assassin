/**
 * Public /mcp chrome on the Mindy public system: the MCP section nav and the app-icon cluster.
 *
 * Same links, labels, order and signed-in behaviour as McpNav / AppCluster in catalog-ui.tsx,
 * restyled onto the `--mp-*` roles. catalog-ui.tsx keeps the dark originals because the
 * signed-in console (/mcp/account) still uses them; public pages import from here.
 */
import React from 'react';
import Link from 'next/link';
import { ButtonLink } from '@/components/public-site/ui';

export function McpPublicNav({ active, signedIn, balance }: { active: 'about' | 'connect' | 'pricing' | 'account'; signedIn?: boolean; balance?: number | null }) {
  const link = 'px-3 py-1.5 font-medium transition-colors';
  const on = 'bg-(--mp-wash) text-(--mp-navy) font-semibold';
  const off = 'text-(--mp-body) hover:text-(--mp-navy)';
  return (
    <header className="flex items-center justify-between gap-4">
      <Link href="/mcp" className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center bg-(--mp-navy) text-sm font-bold text-white">M</div>
        <div className="hidden sm:block">
          <div className="text-[15px] font-semibold leading-tight text-(--mp-ink)">Mindy MCP</div>
          <div className="text-xs text-(--mp-muted)">Federal contracting intel for any AI agent</div>
        </div>
      </Link>
      <nav className="flex items-center gap-1 text-[13px]">
        <Link href="/mcp/about" className={`${link} ${active === 'about' ? on : off}`}>Overview</Link>
        <Link href="/mcp" className={`${link} ${active === 'connect' ? on : off}`}>Connect</Link>
        <Link href="/mcp/pricing" className={`${link} ${active === 'pricing' ? on : off}`}>Pricing</Link>
        {signedIn ? (
          <Link href="/mcp/account" className={`ml-1 flex items-center gap-2 px-3 py-1.5 font-medium ${active === 'account' ? on : off}`}>
            {typeof balance === 'number' && (
              <span className="rounded-[6px] border border-(--mp-line) bg-(--mp-wash) px-2 py-0.5 text-[11px] font-semibold tabular-nums text-(--mp-ink)">{balance.toLocaleString()} cr</span>
            )}
            Account
          </Link>
        ) : (
          <ButtonLink href="/app" size="sm" className="ml-1">Sign in</ButtonLink>
        )}
      </nav>
    </header>
  );
}

// Glyph tiles, not real logos (CSP blocks external images and the marks are trademarked).
// The "Plug into…" caption under the hero names the clients plainly.
export function PublicAppCluster() {
  const flank = (glyphs: string[], side: 'l' | 'r') =>
    glyphs.map((t, i) => (
      <div
        key={side + i}
        className="grid h-12 w-12 place-items-center border border-(--mp-line) bg-(--mp-surface) text-lg font-semibold text-(--mp-ink) ring-4 ring-(--mp-paper)"
      >
        {t}
      </div>
    ));
  return (
    <div className="flex items-center justify-center -space-x-3">
      {flank(['◍', '✦', '❖'], 'l')}
      <div className="z-10 grid h-16 w-16 place-items-center bg-(--mp-navy) text-2xl font-bold text-white ring-4 ring-(--mp-paper)">M</div>
      {flank(['✳', '⌘', '≋'], 'r')}
    </div>
  );
}
