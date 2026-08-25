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
  href, choice, className, children, email, intent, next,
}: {
  href: string;
  choice: WelcomeChoice;
  className?: string;
  children: ReactNode;
  email?: string | null;
  intent?: string | null;
  next?: string | null;
}) {
  const record = () => {
    try {
      const payload = JSON.stringify({ choice, email: email || readEmail(), intent, next });
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

/** The signed-in identity, when the browser has one. Anonymous is a legitimate state on
 *  /welcome and is recorded as such rather than dropped. */
function readEmail(): string | null {
  try {
    return localStorage.getItem('mi_beta_email');
  } catch {
    return null;
  }
}
