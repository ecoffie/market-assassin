/**
 * A /welcome choice that records WHICH DOOR the user walked through.
 *
 * ⚠️ NAVIGATION MUST NOT WAIT ON TELEMETRY. The whole premise of /welcome is that nothing
 * there is a gate; making a link await a fetch would quietly make it one. `sendBeacon`
 * hands the event to the browser and returns immediately, surviving the page unload — the
 * one API designed for exactly this.
 *
 * ⚠️ Falls back to a keepalive fetch when sendBeacon is unavailable, and swallows every
 * failure: a telemetry problem must never cost a user their click.
 */
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export type WelcomeChoice = 'explore_map' | 'connect_mcp' | 'personalize_company';

export function ChoiceLink({
  href, choice, className, children, intent, next,
}: {
  href: string;
  choice: WelcomeChoice;
  className?: string;
  children: ReactNode;
  intent?: string | null;
  next?: string | null;
}) {
  const record = () => {
    try {
      const payload = JSON.stringify({ choice, intent, next });
      // The server records a choice only for a VERIFIED session, so a signed-in visitor's token must
      // travel as a header — which a beacon cannot carry. Signed in: keepalive fetch with the token.
      const token = readToken();
      if (token) {
        void fetch('/api/welcome/choice', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': token },
          body: payload, keepalive: true,
        }).catch(() => {});
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/welcome/choice', new Blob([payload], { type: 'application/json' }));
        return;
      }
      void fetch('/api/welcome/choice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: payload, keepalive: true,
      }).catch(() => {});
    } catch {
      /* telemetry is never worth a broken link */
    }
  };

  return <Link href={href} onClick={record} className={className}>{children}</Link>;
}

/** The signed MI session token, when the browser has one. The server derives the email from it. */
function readToken(): string | null {
  try {
    return localStorage.getItem('mi_beta_auth_token');
  } catch {
    return null;
  }
}
