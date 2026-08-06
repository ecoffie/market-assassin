/**
 * Mindy MCP tier gating (Phase 2 · Phase A).
 *
 * The packaging rule: METER everything by default; GATE only for the four reasons
 * (differentiation, build-cost, capability depth, security). This module owns the
 * per-tool tier metadata + the "is this caller Pro?" resolver. Enforcement lives at
 * the billing seam (runMeteredTool) and is flag-gated (mcpFlags.enforceTiers), so
 * this ships with zero behavior change until flipped on.
 *
 * See tasks/PRD-mindy-mcp-phase2-gating-rollout.md.
 */
import { resolveAccess } from '@/lib/access/resolve-access';

export type ToolTier = 'metered' | 'pro';

/**
 * Per-tool tier. DEFAULT is `metered` (not listed here) — commodity data + curated
 * intelligence stay open to any credit balance. Only the gated set is enumerated.
 *
 * The one LIVE moat tool is `get_winning_playbook` (the proprietary teaching corpus —
 * differentiation). Phase C adds the rest (teaching/podcast search, curated contacts,
 * agency angles) here as they're wrapped; Phase D adds Proposal Assist 2.0.
 *
 * HISTORY (read before changing this): the playbook was REMOVED from MCP on 2026-07-29
 * because an external tester hit its Pro gate and reported it as unreachable. Two of the
 * three "unreachable" tools in that report were never gated by us at all — that was
 * Claude Desktop's client-side approval prompt. The gate was working as designed; it just
 * looked like a bug. Restored 2026-08-06 WITH the entitlement check corrected (see
 * `isProForMcp` below) so a paying user is never told to upgrade to something they own.
 * Do not "fix" a gate complaint by deleting the gated tool — check the entitlement path.
 */
export const TOOL_TIER: Readonly<Record<string, ToolTier>> = {
  get_winning_playbook: 'pro',
};

/** The tier required to call a tool (defaults to `metered`). */
export function tierFor(name: string): ToolTier {
  return TOOL_TIER[name] ?? 'metered';
}

/** Does this tool require a Pro subscription? */
export function isProTool(name: string): boolean {
  return tierFor(name) === 'pro';
}

/**
 * Is this caller a Pro subscriber, for MCP entitlement purposes?
 *
 * Delegates to `resolveAccess()` — the single source of truth for "what access does
 * this email have" (paid entitlement → Team superset → active trial → free).
 *
 * WHY NOT the old check (2026-08-06): this used to query
 * `user_notification_settings` for `is_active = true AND briefings_enabled = true`.
 * That is an EMAIL-DELIVERY PREFERENCE, not a purchase — `briefings_enabled` is the
 * flag that decides whether the daily briefing SENDS, and a paying user who turned
 * briefings off (or whose row was never back-filled) read as NOT Pro. On 2026-08-05
 * that exact class was measured: 14 paying accounts held the entitlement but had
 * `briefings_enabled = false`, $7,202 of purchases affected. Gating a paid tool on
 * that flag would have handed `requires_pro` to people who had already paid — the
 * same failure that got `get_winning_playbook` pulled from MCP on 2026-07-29.
 * Entitlement decides access; a delivery preference never does.
 *
 * Fails OPEN (returns true) on error: this is a soft monetization gate, and blocking
 * a paying user on a transient blip is far worse than letting one non-Pro through.
 * `resolveAccess` already fails open internally at every step; the try/catch here is
 * the outer belt-and-braces so a throw can never deny a paying caller.
 */
export async function isProForMcp(email: string): Promise<boolean> {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return false;
  try {
    const access = await resolveAccess(normalized);
    return access.level === 'pro';
  } catch (err) {
    console.error('[mcp:entitlements] isProForMcp threw (failing open):', err);
    return true; // fail open — never block a paying user on a DB blip
  }
}
