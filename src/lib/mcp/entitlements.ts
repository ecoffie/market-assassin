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
import { getReadClient } from '@/lib/supabase/server-clients';

export type ToolTier = 'metered' | 'pro';

/**
 * Per-tool tier. DEFAULT is `metered` (not listed here) — commodity data + curated
 * intelligence stay open to any credit balance. Only the gated set is enumerated.
 *
 * Today the one LIVE moat tool is `get_winning_playbook` (the proprietary teaching
 * corpus — differentiation). Phase C adds the rest (teaching/podcast search, curated
 * contacts, agency angles) here as they're wrapped; Phase D adds Proposal Assist 2.0.
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
 * Reuses the SAME definition as the monthly-credit grant cron
 * (grant-mcp-pro-credits): the briefings/MI-Pro cohort in `user_notification_settings`
 * (`is_active = true AND briefings_enabled = true`). One source of truth — do not
 * invent a second "Pro."
 *
 * Fails OPEN (returns true) on a DB error: this is a soft monetization gate, and
 * blocking a paying Pro user because of a transient query blip is far worse than the
 * negligible leak of letting one non-Pro through. The error is logged for visibility.
 */
export async function isProForMcp(email: string): Promise<boolean> {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return false;
  try {
    const db = getReadClient();
    const { data, error } = await db
      .from('user_notification_settings')
      .select('user_email')
      .ilike('user_email', normalized) // case-insensitive exact match (no wildcards)
      .eq('is_active', true)
      .eq('briefings_enabled', true)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[mcp:entitlements] isProForMcp query failed (failing open):', error.message);
      return true; // fail open — never block a paying user on a DB blip
    }
    return !!data;
  } catch (err) {
    console.error('[mcp:entitlements] isProForMcp threw (failing open):', err);
    return true; // fail open
  }
}
