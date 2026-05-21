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
  | 'pipeline'
  | 'contacts'
  | 'settings'
  | 'onboarding'
  | 'sidebar'
  | 'app_root';

export function useAppTracker(email: string | null | undefined) {
  return useCallback(
    (eventType: AppEventType, eventSource: AppEventSource, metadata?: Record<string, unknown>) => {
      if (!email) return;
      const payload = JSON.stringify({
        email,
        eventType,
        eventSource,
        metadata: metadata || {},
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
