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
  title: "Mindy — Your 24/7 Federal Market Intelligence Analyst",
  description: "Mindy scans 24,000+ federal opportunities daily, scores your fit, and tells you which to pursue. The big contractors have armies. You have Mindy.",
  openGraph: {
    title: "Meet Mindy.",
    description: "Your 24/7 Federal Market Intelligence Analyst. While you sleep, Mindy scans 24,000+ opportunities, scores your fit, and tells you what to bid on.",
    siteName: "Mindy",
    type: "website",
    images: [
      {
        // Reuses the existing brand asset for now. A purpose-built 1200×630
        // OG card would render better — todo when design has cycles.
        url: "/brand/mindy-logo-icon.png",
        width: 1200,
        height: 1200,
        alt: "Mindy",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Meet Mindy.",
    description: "Your 24/7 Federal Market Intelligence Analyst. The big contractors have armies. You have Mindy.",
    images: ["/brand/mindy-logo-icon.png"],
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
