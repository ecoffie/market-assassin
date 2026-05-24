import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
// mi.govcongiants.com and getmindy.ai via the host-rewrites in
// next.config.ts; the wording is brand-neutral enough to work on both.
export const metadata: Metadata = {
  // metadataBase + alternates.canonical tell Google that getmindy.ai is
  // the canonical hostname even when the page is served from the
  // mi.govcongiants.com mirror. Without this, the two hostnames split
  // link equity and Google may pick the wrong one to rank.
  metadataBase: new URL("https://getmindy.ai"),
  alternates: {
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
        {children}
      </body>
    </html>
  );
}
