/**
 * Shared client-side engagement tracker for the /app surface.
 *
 * Every panel and major action funnels through trackAppEvent() so we
 * get consistent eventType / eventSource / metadata shapes across the
 * codebase. Backed by /api/mindy/engagement (which thin-aliases
 * /api/app/engagement → logEngagement() → app_events table).
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
      const payload = JSON.stringify({
        email,
        eventType,
        eventSource,
        metadata: merged,
      });
      try {
        // Beacon preferred — survives navigation / panel-close. Falls
        // back to fetch if Beacon isn't available (older browsers,
        // SSR). Both fire-and-forget.
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([payload], { type: 'application/json' });
          const sent = navigator.sendBeacon('/api/mindy/engagement', blob);
          if (sent) return;
        }
        void fetch('/api/mindy/engagement', {
          method: 'POST',
          headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
          body: payload,
          keepalive: true,
        }).catch(() => {
          // Swallow — tracking errors must not surface to the user.
        });
      } catch {
        // Belt-and-suspenders. If Beacon throws (rare) we don't care.
      }
    },
    [email],
  );
}
