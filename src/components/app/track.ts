/**
 * Shared client-side engagement tracker for the /app surface.
 *
 * Every panel and major action funnels through trackAppEvent() so we
 * get consistent eventType / eventSource / metadata shapes across the
 * codebase. Backed by /api/mindy/engagement (which thin-aliases
 * /api/app/engagement → logEngagement() → user_engagement table).
 *
 * Mirrors the EventTypes catalog in src/lib/engagement.ts. Keeping
 * the string literals in sync is intentional — the catalog is the
 * server-side allowlist, the union below is the client surface.
 *
 * Usage:
 *   const track = useAppTracker(email);
 *   track('page_view', 'source_feed', { panel: 'alerts' });
 *   track('tool_use', 'market_research', { action: 'lens_click', lens: 'map' });
 *
 * Transport: sendAppEngagement() — authenticated keepalive fetch, NEVER
 * sendBeacon (a beacon cannot carry the auth header; see below).
 *
 * Fire-and-forget: never awaits, never throws. Tracking failures
 * must not break the user's flow.
 *
 * UTM attribution:
 *   Every event automatically carries utm_source / utm_medium /
 *   utm_campaign / utm_content / referrer pulled from the current URL
 *   (last touch) and from localStorage (first touch, persisted ~30
 *   days). PRD §327 — "Which source/channel created the signal."
 *   See readAttribution() below for the merge rules.
 */
import { useCallback } from 'react';
import { getMIApiHeaders } from './authHeaders';

export type AppEventType =
  | 'page_view'
  | 'link_click'
  | 'tool_use'
  | 'report_generate'
  | 'profile_update'
  | 'onboarding_step'
  | 'export'
  | 'feedback';

export type AppEventSource =
  | 'source_feed'
  | 'daily_alerts'
  | 'todays_intel'
  | 'market_research'
  | 'market_intel_dashboard'
  | 'forecasts'
  | 'grants'
  | 'pipeline'
  | 'contacts'
  | 'settings'
  | 'onboarding'
  | 'sidebar'
  | 'app_root'
  | 'pricing_intel'; // Estimating section — added May 2026

// Keys we accept as attribution. utm_term is also standard but we don't
// publish links with it; including it costs nothing if it ever appears.
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
type UtmKey = (typeof UTM_KEYS)[number];

type Attribution = Partial<Record<UtmKey | 'referrer', string>> & {
  first_touch?: Partial<Record<UtmKey | 'landing_at', string>>;
};

const FIRST_TOUCH_KEY = 'mi_first_touch_attribution_v1';
const FIRST_TOUCH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Read attribution params from the current URL, persist first-touch
 * once per browser, return the merged attribution to attach to events.
 *
 * Behavior:
 *   - Last-touch UTMs (from current URL) attach to every event.
 *   - First-touch UTMs (from the very first visit that had any UTM)
 *     persist in localStorage and attach as `first_touch.*` so we can
 *     distinguish "they originally came from LinkedIn, this session
 *     came from a Resend email" — both attribution narratives.
 *   - referrer attaches when document.referrer is set and isn't our
 *     own host. Helps spot organic vs paid social etc.
 *   - First touch expires after 30 days so stale attribution doesn't
 *     poison long-tenure users.
 */
function readAttribution(): Attribution {
  if (typeof window === 'undefined') return {};
  const out: Attribution = {};

  // Last touch — current URL UTM params.
  try {
    const url = new URL(window.location.href);
    for (const key of UTM_KEYS) {
      const v = url.searchParams.get(key);
      if (v) out[key] = v;
    }
  } catch { /* malformed URL — skip */ }

  // Referrer (only when external, never our own host).
  try {
    if (document.referrer) {
      const ref = new URL(document.referrer);
      if (ref.hostname && ref.hostname !== window.location.hostname) {
        out.referrer = ref.hostname;
      }
    }
  } catch { /* invalid referrer — skip */ }

  // First touch — read existing localStorage entry if any.
  try {
    const stored = window.localStorage.getItem(FIRST_TOUCH_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { landing_at?: string } & Partial<Record<UtmKey, string>>;
      const landedMs = parsed.landing_at ? new Date(parsed.landing_at).getTime() : 0;
      if (landedMs && Date.now() - landedMs < FIRST_TOUCH_TTL_MS) {
        out.first_touch = parsed;
      } else {
        // Stale → wipe so the next visit can re-seed.
        window.localStorage.removeItem(FIRST_TOUCH_KEY);
      }
    }
  } catch { /* localStorage blocked or JSON corrupt — skip */ }

  // Seed first touch if (a) we don't have one yet AND (b) the current
  // URL or referrer carries any signal worth remembering.
  if (!out.first_touch) {
    const seed: Partial<Record<UtmKey | 'landing_at' | 'referrer', string>> = {};
    let anySignal = false;
    for (const key of UTM_KEYS) {
      if (out[key]) { seed[key] = out[key]; anySignal = true; }
    }
    if (out.referrer) { seed.referrer = out.referrer; anySignal = true; }
    if (anySignal) {
      seed.landing_at = new Date().toISOString();
      try {
        window.localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(seed));
        out.first_touch = seed;
      } catch { /* storage write blocked — non-fatal */ }
    }
  }

  return out;
}

/**
 * THE authenticated transport for signed-in engagement events. Every signed-in
 * producer on the /app surface must go through this — never `navigator.sendBeacon`.
 *
 * Why (measured 2026-09-26): since #1232 (2026-08-21) /api/app/engagement requires
 * STRONG auth for a real email — the MI session token in `x-mi-auth-token`. A beacon
 * cannot carry a header, and the token lives in localStorage (not a cookie), so every
 * signed-in beacon 401'd. `sendBeacon` returns `true` the moment the request is QUEUED,
 * so the fetch fallback never ran and nothing ever saw the 401. pipeline 157→0,
 * market_intel_dashboard 773→0, forecasts/settings/market_research/onboarding → 0 for
 * five weeks while the Map (fetch + token) kept recording.
 *
 * `fetch(..., { keepalive: true })` is the replacement: it survives pagehide / tab close
 * like a beacon does AND carries the auth header. Identity is established server-side
 * from the token; the body email is only the CLAIM the token must match.
 *
 * No token → the event is NOT sent. It would 401 anyway, and inventing identity (a
 * weaker auth path, trusting the body email) is worse than a missing event.
 * Fire-and-forget: never throws, never awaited by callers.
 */
export function sendAppEngagement(
  email: string | null | undefined,
  event: { eventType: string; eventSource: string; metadata?: Record<string, unknown> },
  url: string = '/api/mindy/engagement',
): void {
  if (!email || typeof window === 'undefined') return;
  try {
    const headers = getMIApiHeaders(email, { 'Content-Type': 'application/json' });
    if (!headers.has('x-mi-auth-token') && !headers.has('x-mi-2fa-token')) {
      telemetryDevWarn(`dropped ${event.eventSource}/${event.eventType}: no MI session token`);
      return;
    }
    const body = JSON.stringify({
      email,
      eventType: event.eventType,
      eventSource: event.eventSource,
      metadata: event.metadata || {},
    });
    void fetch(url, { method: 'POST', headers, body, keepalive: true })
      .then((res) => {
        if (!res.ok) telemetryDevWarn(`${event.eventSource}/${event.eventType} rejected: HTTP ${res.status}`);
      })
      .catch(() => {
        // Swallow — tracking errors must not surface to the user. (An unload can
        // cancel the promise; keepalive still delivers the request.)
      });
  } catch {
    // Belt-and-suspenders: tracking must never break the user's flow.
  }
}

/** Loud in development, silent in production — a rejected telemetry request is a
 *  defect, and this one hid for five weeks precisely because nothing said so. */
function telemetryDevWarn(msg: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[engagement telemetry] ${msg}`);
  }
}

export function useAppTracker(email: string | null | undefined) {
  return useCallback(
    (eventType: AppEventType, eventSource: AppEventSource, metadata?: Record<string, unknown>) => {
      if (!email) return;
      // Merge attribution INTO metadata so server-side filters /
      // queries can group by metadata->>utm_source without any schema
      // change. caller-supplied metadata wins over auto-detected
      // (lets a specific track() call override attribution if it
      // wants to attribute to a different surface).
      const attribution = readAttribution();
      const merged: Record<string, unknown> = {
        ...attribution,
        ...(metadata || {}),
      };
      sendAppEngagement(email, { eventType, eventSource, metadata: merged });
    },
    [email],
  );
}
