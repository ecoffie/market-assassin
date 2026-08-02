/**
 * /api/mcp/catalog — PUBLIC (no auth) pricing/plan data for the logged-out /mcp page.
 *
 * GET → { tools[] (name+description+credits), subscriptionPlans[], signupCredits,
 *         proMonthlyCredits, tierCredits { free, pro, teams } }.
 *
 * `tierCredits` is the one place to read an app-tier allowance from — pricing copy should
 * never hardcode these numbers (see the comment on the field itself for why).
 *
 * This is the marketing counterpart to /api/mcp/account (which is auth-gated and adds the
 * user's balance + call history). Everything here is non-PII, server-trusted config so a
 * prospect can see "what agents can do + what it costs" BEFORE signing in — data behind
 * glass, not a blank wall. No user data ever passes through this route.
 */
import { NextResponse } from 'next/server';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS, SUBSCRIPTION_PLANS } from '@/lib/mcp/packages';
import { SIGNUP_CREDITS } from '@/lib/mcp/credits';
import { mcpFlags } from '@/lib/mcp/flags';

export const runtime = 'nodejs';
// Static config — safe to cache at the edge for an hour (revalidates on deploy anyway).
export const revalidate = 3600;

export function GET() {
  const tools = listMcpTools().map((t) => {
    const fn = t.function as { name: string; description?: string };
    return {
      name: fn.name,
      description: fn.description ?? '',
      credits: (t._credits as number) ?? 0,
      tier: (t._tier as string) ?? 'metered', // 'metered' | 'pro' — drives the pricing page's live/gated split
    };
  });

  return NextResponse.json({
    success: true,
    tools,
    // Monthly & annual credit subscriptions — the acquisition plans the /mcp/pricing page sells.
    // (One-time credit packs retired 2026-07-14 — Plus/Scale are subscriptions now.)
    subscriptionPlans: SUBSCRIPTION_PLANS,
    signupCredits: SIGNUP_CREDITS,
    proMonthlyCredits: PRO_MONTHLY_CREDITS,
    /**
     * EVERY app-tier credit allowance in ONE place, so a pricing page never has to
     * hardcode one — read these, don't retype them.
     *
     * Why this exists: this route previously exposed only signupCredits and
     * proMonthlyCredits. TEAM_MONTHLY_CREDITS lived in packages.ts and was reachable
     * NOWHERE from the API, so building the /pricing feature matrix on 2026-08-02 it
     * looked like Teams simply had no allowance defined — and a number nearly got
     * invented for a public page when a real one (750, set by Eric on 2026-07-20) had
     * existed all along. Exposing all three makes that class of mistake impossible.
     *
     * `recurring` is the distinction copy MUST preserve: Free's grant is ONE-TIME on
     * first connect, not a monthly refill. Rendering a bare "100" beside two monthly
     * numbers reads as recurring and would be a false promise.
     *
     * Values are the live server-side constants (each env-overridable), so this is
     * also the honest way to confirm what production actually grants.
     */
    tierCredits: {
      free: { credits: SIGNUP_CREDITS, recurring: false, note: 'one-time on first agent connection' },
      pro: { credits: PRO_MONTHLY_CREDITS, recurring: true, note: 'per month' },
      teams: { credits: TEAM_MONTHLY_CREDITS, recurring: true, note: 'per month, shared across seats' },
    },
    // Whether Pro-tier tools (tier === 'pro') are actually ENFORCED right now, i.e.
    // the deployed runtime reads MCP_ENFORCE_TIERS as true. Lets the /mcp page show
    // "Pro enforced" honestly and gives a public, no-auth way to confirm the flag
    // bound (catches the MCP_ENFORCE_TIERS=1-vs-true silent no-op class of bug).
    enforceTiers: mcpFlags.enforceTiers,
  });
}
