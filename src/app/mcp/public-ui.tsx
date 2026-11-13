/**
 * Public /mcp chrome on the Mindy public system: the MCP section nav and the app-icon cluster.
 *
 * Same links, labels, order and signed-in behaviour as McpNav / AppCluster in catalog-ui.tsx,
 * restyled onto the `--mp-*` roles. catalog-ui.tsx keeps the dark originals because the
 * signed-in console (/mcp/account) still uses them; public pages import from here.
 */
import React from 'react';

// The MCP section sub-bar (Mindy MCP · Overview · Connect · Pricing) was REMOVED 2026-11-13
// (owner: "i dont want another nav bar under the main nav bar"). Its links live in the site top
// bar's "Mindy in your AI" menu (MP_AI_MENU); the signed-in Account link lives in the account
// menu. Kept as a no-op so existing call sites compile; delete the call sites when convenient.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility
export function McpPublicNav(_props: { active: 'about' | 'connect' | 'pricing' | 'account'; signedIn?: boolean; balance?: number | null }) {
  return null;
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
