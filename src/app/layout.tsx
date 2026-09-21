import type { Metadata } from "next";
import Script from "next/script";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import AttributionTracker from "@/components/AttributionTracker";
import RefCapture from "@/components/RefCapture";
import ChunkReloadGuard from "@/components/ChunkReloadGuard";
import "./globals.css";

// GA4 measurement id for the "Mindy — Web" property (stream: getmindy.ai).
// Env-gated: unset → the tag block below renders nothing, so preview/local builds
// never pollute production analytics.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
// Google Ads base tag. ONE gtag.js load serves both GA4 and Ads — loading it
// twice would double-count pageviews. Whichever id exists drives the loader;
// each destination gets its own config line below.
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const GTAG_LOADER_ID = GA_ID || GOOGLE_ADS_ID;

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

// Brand copy is anchored to the Mindy landing page (src/app/mindy-landing/
// page.tsx) so link previews on getmindy.ai match what visitors see when
// they land. Per PRD-market-intelligence-one-thing.md, the wedge is
// "priorities AND everything else" — Mindy reads SAM for you and tells
// you which opps to bid on. The tagline is the GovCon-Giants positioning
// line ("you have Mindy") for emotional anchor. Same metadata serves both
// getmindy.ai and getmindy.ai via the host-rewrites in
// next.config.ts; the wording is brand-neutral enough to work on both.
export const metadata: Metadata = {
  // metadataBase + alternates.canonical tell Google that getmindy.ai is
  // the canonical hostname even when the page is served from the
  // getmindy.ai mirror. Without this, the two hostnames split
  // link equity and Google may pick the wrong one to rank.
  metadataBase: new URL("https://getmindy.ai"),
  alternates: {
    // ⚠️ APEX OWNERSHIP — read before the /today homepage flip.
    //
    // This is the ROOT layout, so `canonical: "/"` is the DEFAULT for any page that does not
    // set its own. Verified live 2026-08-23: real pages do override it (/pricing → /pricing,
    // /contractors → /contractors), so today only /mindy-landing — the current homepage —
    // resolves to the apex. That is correct while /mindy-landing IS the homepage.
    //
    // AT CUTOVER, when `/` serves Today's Intel: /mindy-landing must stop claiming the apex.
    // It becomes rollback/legacy, not a competing homepage — give it an explicit
    // `alternates: { canonical: "/mindy-landing" }` in its own metadata (or noindex it),
    // because otherwise TWO pages claim "https://getmindy.ai" and Google picks one.
    // /today already sources its canonical from MAPS_HOME_URL (src/lib/mindy/maps-home.ts),
    // which becomes the apex in the same edit.
    canonical: "/",
  },
  title: "Mindy — Your 24/7 Federal Market Intelligence Analyst",
  description: "Mindy scans 24,000+ federal opportunities daily, scores your fit, and tells you which to pursue. The big contractors have armies. You have Mindy.",
  openGraph: {
    title: "Meet Mindy.",
    description: "Your 24/7 Federal Market Intelligence Analyst. While you sleep, Mindy scans 24,000+ opportunities, scores your fit, and tells you what to bid on.",
    siteName: "Mindy",
    type: "website",
    // og:image is auto-wired from src/app/opengraph-image.tsx — the
    // programmatic 1200×630 card with the Mindy mark + brand gradient.
    // Don't redeclare images here; Next.js will merge the convention
    // file in, and overriding it would clobber the rendered card.
  },
  twitter: {
    // Upgraded to large card now that we have a proper 1200×630 image
    // (the summary variant only shows a small thumbnail).
    card: "summary_large_image",
    title: "Meet Mindy.",
    description: "Your 24/7 Federal Market Intelligence Analyst. The big contractors have armies. You have Mindy.",
    // Twitter image is auto-wired from src/app/twitter-image.tsx if
    // present, otherwise falls back to og-image. The opengraph-image
    // convention file covers both.
  },
  // Google Search Console ownership verification for getmindy.ai.
  // Renders as: <meta name="google-site-verification" content="..." />
  // in every page's <head>. Belt + suspenders with the DNS TXT record
  // (https://search.google.com/search-console will accept whichever
  // it sees first). Token issued 2026-05-22.
  verification: {
    google: "o8EjTTk2Io-QglKyr7PPSveCYG6HrWOt0U56jsXhXRA",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-slate-950 text-slate-100`}
      >
        {/* GA4 — getmindy.ai had NO analytics at all until 2026-07-28: no pageviews,
            no bounce rate, no funnel. Verified with a real browser load (0 tracking
            requests, window.gtag undefined). Every change to the front door was
            shipping unmeasured.
            Mirrors the proven govcon-funnels/src/app/layout.tsx pattern: one
            gtag.js load, afterInteractive so it never blocks paint, env-gated so a
            missing id is a no-op rather than a broken script.
            Property: "Mindy — Web", stream getmindy.ai (SEPARATE from the
            GovCon Giants property, which only streams govcongiants.com — keeps the
            product's numbers out of the marketing site's). */}
        {GTAG_LOADER_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GTAG_LOADER_ID}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                ${GA_ID ? `gtag('config', '${GA_ID}', { page_path: window.location.pathname });` : ''}
                ${GOOGLE_ADS_ID ? `gtag('config', '${GOOGLE_ADS_ID}');` : ''}
              `}
            </Script>
          </>
        )}
        <ChunkReloadGuard />
        <AttributionTracker />
        <RefCapture />
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
