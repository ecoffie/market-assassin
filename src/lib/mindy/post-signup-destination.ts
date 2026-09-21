/**
 * POST-SIGNUP DESTINATION — the ONE place that decides where a new account lands.
 *
 * ── THE FAILURE THIS CLOSES (reported 2026-08-25) ──────────────────────────────────────
 * Someone clicked a referral link, signed up, and was dropped into `/app/onboarding` — the
 * legacy profile builder we are retiring. Not an edge case: it is the DOCUMENTED FALLBACK.
 *
 *     src/app/app/auth/callback/route.ts:9
 *     const requestedNext = searchParams.get('next') || '/app/onboarding';
 *
 * A generic referral carries no intent, so it hits that default every time. The same shape
 * appeared at FIVE independent sites (auth callback ×2, app/page.tsx:340,
 * AlertsPanel.tsx:206, setup-password's base URL). Five defaults, drifting apart, each
 * individually reasonable.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────────────────
 *     valid Maps `next`      -> preserve the exact destination
 *     explicit MCP intent    -> /mcp/setup
 *     explicit purchase      -> the preserved checkout destination
 *     no / invalid intent    -> /welcome   (the intent ROUTER, not onboarding)
 *     /app, /app/onboarding, /briefings and friends are NEVER a valid fallback
 *
 * ⚠️ Fixing the five call sites separately is how they drifted in the first place. Every
 * one of them must call this, so the next entry path added inherits the rule instead of
 * inventing a sixth default.
 *
 * ⚠️ This deliberately does NOT decide what `/welcome` shows. It is an intent ROUTER, and
 * company personalization must never be mandatory just to browse the Map or connect MCP.
 */
import { safeNext, isSafeNext } from './safe-next';

/** The intent router. NOT an onboarding surface. */
export const WELCOME_PATH = '/welcome';
/** Where an MCP-origin signup belongs. */
export const MCP_SETUP_PATH = '/mcp/setup';

/**
 * Surfaces a newly created account may never be sent to, even if something upstream asks.
 * `safeNext()` already rejects `/app`; this widens it to the rest of the legacy estate so a
 * stale link or a hand-written `?next=/briefings` cannot reintroduce the old experience.
 */
const LEGACY_DESTINATION = /^\/+(app|briefings)(\/|\?|#|$)/i;

export type SignupIntent = 'maps' | 'mcp' | 'purchase' | 'unknown';

export interface DestinationInput {
  /** The `next` that arrived in the URL — untrusted, user-editable. */
  next?: string | null;
  /** Explicit origin marker, e.g. `?intent=mcp` on a referral link. */
  intent?: string | null;
  /** A checkout/purchase destination preserved through the flow. */
  purchaseNext?: string | null;
}

export interface ResolvedDestination {
  path: string;
  intent: SignupIntent;
  /** Why this path was chosen — for logging, and so a caller can explain itself. */
  reason: string;
}

/** True when a path points at a surface we are retiring. */
export function isLegacyDestination(raw: string | null | undefined): boolean {
  const v = (raw || '').trim();
  return !!v && LEGACY_DESTINATION.test(v);
}

/**
 * Decide where a newly authenticated account goes. Pure and total: it always returns a
 * safe internal path, and never `/app` or `/briefings`.
 */
export function resolvePostSignupDestination(input: DestinationInput = {}): ResolvedDestination {
  const rawIntent = String(input.intent || '').trim().toLowerCase();

  // 1. EXPLICIT MCP INTENT wins over a generic next — someone who came to connect Mindy to
  //    their AI should land in setup, not be asked what they want.
  if (rawIntent === 'mcp') {
    return { path: MCP_SETUP_PATH, intent: 'mcp', reason: 'explicit MCP intent' };
  }

  // 2. EXPLICIT PURCHASE INTENT — finish what they were buying, then a Maps destination.
  if (rawIntent === 'purchase' || rawIntent === 'checkout') {
    if (isSafeNext(input.purchaseNext) && !isLegacyDestination(input.purchaseNext)) {
      return { path: safeNext(input.purchaseNext, WELCOME_PATH), intent: 'purchase', reason: 'preserved checkout destination' };
    }
    return { path: WELCOME_PATH, intent: 'purchase', reason: 'purchase intent with no usable destination' };
  }

  // 3. A VALID MAPS `next` — the model path that already works end to end. Rejected if it
  //    points at a legacy surface, because a stale link must not reintroduce the old flow.
  if (isSafeNext(input.next) && !isLegacyDestination(input.next)) {
    return { path: safeNext(input.next, WELCOME_PATH), intent: 'maps', reason: 'preserved safe next' };
  }

  // 4. UNKNOWN INTENT -> the router. THIS is the line that used to read '/app/onboarding'.
  return {
    path: WELCOME_PATH,
    intent: 'unknown',
    reason: isLegacyDestination(input.next) ? 'requested destination is a legacy surface' : 'no usable intent',
  };
}

/** Convenience for call sites that only need the path. */
export function postSignupPath(input: DestinationInput = {}): string {
  return resolvePostSignupDestination(input).path;
}
