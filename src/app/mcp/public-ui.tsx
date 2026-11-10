/**
 * Public /mcp chrome on the Mindy public system: the MCP section nav and the app-icon cluster.
 *
 * Same links, labels, order and signed-in behaviour as McpNav / AppCluster in catalog-ui.tsx,
 * restyled onto the `--mp-*` roles. catalog-ui.tsx keeps the dark originals because the
 * signed-in console (/mcp/account) still uses them; public pages import from here.
 */
import React from 'react';
import Link from 'next/link';
import { Chip } from '@/components/public-site/ui';

export function McpPublicNav({ active, signedIn, balance }: { active: 'about' | 'connect' | 'pricing' | 'account'; signedIn?: boolean; balance?: number | null }) {
  const link = 'rounded-full px-4 py-2 font-medium transition-colors';
  const on = 'bg-(--mp-navy-wash) text-(--mp-navy) font-semibold';
  const off = 'text-(--mp-body) hover:text-(--mp-navy)';
  // Section tabs only: Sign in / Sign up live in the site top bar above, so they are not repeated here.
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/mcp" className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- brand mark, same file as the site header */}
        <img src="/brand/mindy-logo-icon.png" alt="" className="h-7 w-7" />
        <span className="text-[17px] font-semibold text-(--mp-ink)">Mindy MCP</span>
      </Link>
      <nav className="flex items-center gap-1 overflow-x-auto text-[15px]" aria-label="Mindy MCP">
        <Link href="/mcp/about" className={`${link} ${active === 'about' ? on : off}`}>Overview</Link>
        <Link href="/mcp" className={`${link} ${active === 'connect' ? on : off}`}>Connect</Link>
        <Link href="/mcp/pricing" className={`${link} ${active === 'pricing' ? on : off}`}>Pricing</Link>
        {signedIn && (
          <Link href="/app?panel=settings&section=credits" className={`flex items-center gap-2 ${link} ${active === 'account' ? on : off}`}>
            {typeof balance === 'number' && (
              <Chip className="tabular-nums">{balance.toLocaleString()} credits</Chip>
            )}
            Account
          </Link>
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
