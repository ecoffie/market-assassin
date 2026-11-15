/**
 * POST /api/welcome/choice — record which of the three /welcome options a new user picks.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────
 * The plan is to FREEZE onboarding and observe. Freezing without instrumentation would
 * mean waiting blind: we would learn nothing except from users who complain.
 *
 * These three choices are the first thing a new account does, and we currently cannot say
 * whether anyone opens the Map, connects MCP, personalizes, or leaves. That is exactly the
 * "no evidence" state that made the referral bug invisible for so long.
 *
 * ⚠️ Reuses the EXISTING `user_engagement` sink — no new table, no second analytics system.
 * ⚠️ Records the CHOICE and the intent that produced it. No company data, no description
 *    text: what we need is which door people walk through, not what they typed.
 * ⚠️ Best-effort. A telemetry failure must NEVER block a user from proceeding — the whole
 *    point of /welcome is that nothing there is a gate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logEngagement, EventTypes, EventSources } from '@/lib/engagement';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';

/** The three doors, plus leaving without choosing. Anything else is rejected. */
const CHOICES = ['explore_map', 'connect_mcp', 'personalize_company', 'left_without_choosing'] as const;
type Choice = (typeof CHOICES)[number];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const choice = String(body.choice || '') as Choice;
    if (!CHOICES.includes(choice)) {
      return NextResponse.json({ success: false, error: 'unknown choice' }, { status: 400 });
    }

    // IDENTITY FROM THE VERIFIED SESSION ONLY (2026-11-14). This used to take `email` from the
    // request body with no auth, so anyone could write onboarding activity onto any account and
    // skew activation metrics. A body email is now ignored; without a valid session token the
    // choice is not recorded (the response is still 200 — nothing on /welcome is a gate).
    const email = await resolveMcpEmail(request);
    if (!email) {
      // 'anonymous' = no session at all (a legitimate state on /welcome); 'unverified' = a claimed
      // identity (body email or an invalid token) that could not be verified. Neither is recorded.
      const claimed = typeof body.email === 'string' && body.email.trim() !== ''
        || !!(request.headers.get('x-mi-auth-token') || request.headers.get('x-mi-2fa-token') || request.headers.get('authorization'));
      return NextResponse.json({ success: true, recorded: false, reason: claimed ? 'unverified' : 'anonymous' });
    }

    const res = await logEngagement({
      userEmail: email,
      // Reuse the EXISTING closed EventType union rather than widening it — the union is
      // what stops a typo'd event name from becoming a silently-empty metric.
      eventType: EventTypes.ONBOARDING_STEP,
      eventSource: EventSources.ONBOARDING,
      metadata: {
        step: 'welcome_choice',
        choice,
        // The intent the user ARRIVED with, so we can tell "chose the map" from
        // "was already headed to the map and the router just passed them through".
        arrived_with_intent: typeof body.intent === 'string' ? body.intent : null,
        arrived_with_next: typeof body.next === 'string' && body.next.startsWith('/'),
      },
    });

    // logEngagement RESOLVES with {success:false} rather than throwing — a .catch() here
    // would be dead code and the failure would be invisible.
    if (!res.success) console.error('[welcome/choice] not recorded:', res.error);
    return NextResponse.json({ success: true, recorded: res.success });
  } catch (err) {
    console.error('[welcome/choice] failed:', err);
    // Still 200: telemetry must not surface as an error to a user who did nothing wrong.
    return NextResponse.json({ success: true, recorded: false });
  }
}
