import { NextRequest, NextResponse } from "next/server";
import {
  ATTR_COOKIE,
  CHECKOUT_PRODUCTS,
  buildStripeRedirectUrl,
  createCheckoutStart,
  parseAttributionCookie,
  type AttributionState,
} from "@/lib/purchase-attribution";
import { getPartnerReferralByCode } from "@/lib/mindy/partner-referrals";

const PARTNER_REF_COOKIE = "mindy_partner_ref";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ product: string }>;
};

function mergeAttributionFromQuery(request: NextRequest, cookieValue: string | undefined) {
  const attribution = parseAttributionCookie(cookieValue);
  const queryTouch: Record<string, string> = {};

  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "msclkid",
  ]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) queryTouch[key] = value.slice(0, 250);
  }

  if (!Object.keys(queryTouch).length) return attribution;

  const now = new Date().toISOString();
  return {
    ...attribution,
    first_touch: attribution.first_touch ?? {
      ...queryTouch,
      path: `${request.nextUrl.pathname}${request.nextUrl.search}`,
      url: request.url,
      referrer: request.headers.get("referer") ?? "",
      captured_at: now,
    },
    last_touch: {
      ...(attribution.last_touch ?? {}),
      ...queryTouch,
      path: `${request.nextUrl.pathname}${request.nextUrl.search}`,
      url: request.url,
      referrer: request.headers.get("referer") ?? attribution.last_touch?.referrer ?? "",
      captured_at: now,
    },
  };
}

function mergePartnerReferral(
  request: NextRequest,
  attribution: AttributionState,
): AttributionState {
  const ref = (
    request.nextUrl.searchParams.get("ref")
    || request.nextUrl.searchParams.get("code")
    || request.cookies.get(PARTNER_REF_COOKIE)?.value
    || attribution.partner_code
    || ""
  ).trim();

  const partner = getPartnerReferralByCode(ref);
  if (!partner) return attribution;

  return {
    ...attribution,
    partner_code: partner.code,
    partner_slug: partner.slug,
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { product: productId } = await params;
  const product = CHECKOUT_PRODUCTS[productId];

  if (!product) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const attribution = mergePartnerReferral(
    request,
    mergeAttributionFromQuery(
      request,
      request.cookies.get(ATTR_COOKIE)?.value,
    ),
  );

  const checkoutStart = await createCheckoutStart({
    product,
    sourceUrl: request.headers.get("referer") || request.url,
    attribution,
  }).catch((err) => {
    console.error("Checkout attribution start failed:", err);
    return null;
  });

  const redirectUrl =
    product.type === "stripe_payment_link"
      ? checkoutStart
        ? buildStripeRedirectUrl(product, checkoutStart.id)
        : product.checkoutUrl
      : (() => {
          const url = new URL(product.checkoutUrl, request.url);
          if (checkoutStart) url.searchParams.set("gcaid", checkoutStart.id);
          return url.toString();
        })();

  return NextResponse.redirect(redirectUrl);
}
