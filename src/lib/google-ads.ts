/**
 * Google Ads conversion tracking.
 *
 * PORTED from govcon-funnels 2026-07-28, unchanged in behaviour. That repo has
 * had Ads conversion tracking since June; Mindy had none, so a campaign pointed
 * at getmindy.ai would have had NO conversion signal to optimise against.
 *
 * The base tag (AW-...) is loaded in src/app/layout.tsx alongside GA4 — both
 * destinations share a single gtag.js load. This module fires conversion
 * *events* for specific actions (leads, purchases).
 *
 * Conversion labels come from Google Ads when you create a conversion action
 * (the `send_to` value looks like `AW-10876444620/AbC-D_efG`). Store the part
 * after the slash in the matching env var below so labels aren't hardcoded.
 *
 * Env (all NEXT_PUBLIC_ so they inline into the client bundle):
 *   NEXT_PUBLIC_GOOGLE_ADS_ID    e.g. AW-10876444620
 *   NEXT_PUBLIC_GADS_LEAD_LABEL  conversion label for lead-form submissions
 *   NEXT_PUBLIC_GADS_PURCHASE_LABEL  conversion label for purchases
 */

export const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const LEAD_LABEL = process.env.NEXT_PUBLIC_GADS_LEAD_LABEL;
const PURCHASE_LABEL = process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL;

type Gtag = (command: string, action: string, params?: Record<string, unknown>) => void;

function getGtag(): Gtag | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { gtag?: Gtag }).gtag;
}

interface ConversionOptions {
  /** Conversion label from Google Ads (the part after the slash in send_to). */
  label?: string;
  value?: number;
  currency?: string;
  /** Stripe/order id — dedupes repeat conversions for the same purchase. */
  transactionId?: string;
  /**
   * Runs after the conversion hit is sent (or immediately if tracking is
   * unconfigured). Use this to defer navigation so the hit isn't dropped when
   * the page unloads.
   */
  onSent?: () => void;
}

/**
 * Fire a Google Ads conversion. Safe to call when tracking is unconfigured —
 * it just invokes `onSent` so callers never block their own flow.
 */
export function trackAdsConversion({
  label,
  value,
  currency = "USD",
  transactionId,
  onSent,
}: ConversionOptions): void {
  const gtag = getGtag();
  const sendTo = GOOGLE_ADS_ID && label ? `${GOOGLE_ADS_ID}/${label}` : undefined;

  // Nothing to fire (SSR, gtag missing, or label/id unset) — don't block caller.
  if (!gtag || !sendTo) {
    onSent?.();
    return;
  }

  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    onSent?.();
  };

  gtag("event", "conversion", {
    send_to: sendTo,
    ...(value != null ? { value } : {}),
    currency,
    ...(transactionId ? { transaction_id: transactionId } : {}),
    ...(onSent ? { event_callback: fire } : {}),
  });

  // Fallback: navigate even if gtag never calls back (blocked/slow network).
  if (onSent) setTimeout(fire, 1200);
}

/** Fire the lead-form conversion. `onSent` defers redirect until the hit sends. */
export function trackLeadConversion(onSent?: () => void): void {
  trackAdsConversion({ label: LEAD_LABEL, onSent });
}

/** Fire the purchase conversion (use on an on-site post-purchase page). */
export function trackPurchaseConversion(opts: {
  value?: number;
  currency?: string;
  transactionId?: string;
  onSent?: () => void;
} = {}): void {
  trackAdsConversion({ label: PURCHASE_LABEL, ...opts });
}
