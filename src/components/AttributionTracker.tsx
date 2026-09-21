"use client";

import { useEffect } from "react";

// Mirrors govcon-funnels/src/components/AttributionTracker.tsx so the gca_attr
// cookie written here is identical in shape and readable by the same
// /checkout hop + webhook attribution logic.

const ATTR_COOKIE = "gca_attr";
const ATTR_STORAGE_KEY = "gca_attribution";
const ATTR_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "msclkid",
] as const;

type Touch = {
  url: string;
  path: string;
  referrer: string;
  captured_at: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
};

type AttributionState = {
  first_touch: Touch;
  last_touch: Touch;
  visit_count: number;
};

function isExternalReferrer(referrer: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

function getCurrentTouch(): Touch {
  const params = new URLSearchParams(window.location.search);
  const touch: Touch = {
    url: window.location.href,
    path: `${window.location.pathname}${window.location.search}`,
    referrer: isExternalReferrer(document.referrer) ? document.referrer : "",
    captured_at: new Date().toISOString(),
  };

  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) touch[key] = value.slice(0, 250);
  }

  if (!touch.utm_source && touch.referrer) {
    try {
      touch.utm_source = new URL(touch.referrer).hostname.replace(/^www\./, "");
      touch.utm_medium = "referral";
    } catch {
      // Keep the raw referrer without classifying it.
    }
  }

  if (!touch.utm_source) {
    touch.utm_source = "direct";
    touch.utm_medium = "none";
  }

  return touch;
}

function readStoredAttribution(): AttributionState | null {
  try {
    const raw = window.localStorage.getItem(ATTR_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AttributionState) : null;
  } catch {
    return null;
  }
}

function writeCookie(value: AttributionState) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ATTR_COOKIE}=${encoded}; Path=/; Max-Age=${ATTR_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export default function AttributionTracker() {
  useEffect(() => {
    const currentTouch = getCurrentTouch();
    const stored = readStoredAttribution();
    const next: AttributionState = {
      first_touch: stored?.first_touch ?? currentTouch,
      last_touch: currentTouch,
      visit_count: (stored?.visit_count ?? 0) + 1,
    };

    try {
      window.localStorage.setItem(ATTR_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Cookie write below is the server-readable fallback.
    }
    writeCookie(next);
  }, []);

  return null;
}
