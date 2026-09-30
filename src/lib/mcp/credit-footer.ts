/**
 * The one-line credit status appended to every PRICED MCP tool result (balance in the
 * chat). Two contexts, because they have different remedies:
 *
 *   · PERSONAL — the caller's own balance. Low → top up at getmindy.ai/mcp.
 *   · POOL     — the caller's call was paid from their TEAM's shared pool. A personal
 *     top-up can never fund the pool, so a pooled caller is NEVER sent to buy credits.
 *     There is no pool top-up purchase today (a pool refills monthly), so the owner is
 *     not offered a purchase link either — only the true remedies.
 *
 * Found by the internal billing canary (2026-09-30): pooled calls said
 * "running low. Top up → getmindy.ai/mcp", selling members credits their pooled calls
 * could never use — the same defect class as the empty-pool paywall fixed in #1761.
 */
export const LOW_BALANCE_THRESHOLD = 20;

export interface PoolFooterContext {
  orgName: string | null;
  /** The caller owns the team (null = could not establish; treated as a member). */
  isOwner: boolean | null;
}

export function creditFooter(charged: number, balance: number | null, pool?: PoolFooterContext): string | null {
  if (balance === null) return null; // free tool — nothing to meter
  const used = charged > 0 ? ` · this call used ${charged} credit${charged === 1 ? '' : 's'}` : '';

  if (pool) {
    const team = pool.orgName ? ` (${pool.orgName})` : '';
    const remedy = pool.isOwner
      ? 'The pool refills at the start of next month. To raise your team\'s allowance, contact support@getmindy.ai.'
      : 'Ask your team owner about adding credits. The pool refills at the start of next month.';
    if (balance <= 0) return `⚠️ Team credits${team}: 0 left${used}. ${remedy}`;
    if (balance <= LOW_BALANCE_THRESHOLD) return `⚠️ Team pool is low${team}: ${balance} left${used}. ${remedy}`;
    return `Team credits${team}: ${balance} remaining${used}.`;
  }

  if (balance <= 0) {
    return `⚠️ Mindy credits: 0 left${used}. Top up to keep going → getmindy.ai/mcp`;
  }
  if (balance <= LOW_BALANCE_THRESHOLD) {
    return `⚠️ Mindy credits: ${balance} left${used} — running low. Top up → getmindy.ai/mcp`;
  }
  return `Mindy credits: ${balance} remaining${used}.`;
}
