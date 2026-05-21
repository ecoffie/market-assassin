/**
 * Programmatic Open Graph card for getmindy.ai / mi.govcongiants.com.
 *
 * Next.js App Router convention: a default-exported component in
 * src/app/opengraph-image.tsx is rendered at build time into a 1200×630
 * PNG and automatically wired to <meta property="og:image"> on every
 * page that doesn't define its own. Replaces the square logo we were
 * using as a stopgap in layout.tsx metadata.
 *
 * Branding anchored to src/app/mindy-landing/page.tsx:
 *   headline: "Meet Mindy."
 *   subhead:  "Your 24/7 Federal Market Intelligence Analyst."
 *   tagline:  "The big contractors have armies. You have Mindy."
 *
 * The Mindy logo is inlined as SVG so the OG card has zero runtime
 * font/image dependencies — Vercel's edge OG renderer doesn't have
 * filesystem access at request time.
 */
import { ImageResponse } from 'next/og';

// Next.js metadata-route hooks for the convention file.
export const alt = 'Mindy — Your 24/7 Federal Market Intelligence Analyst';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Inline SVG mark so we don't have to fetch the brand asset at render
// time (Vercel's OG renderer runs at the edge and can't read /public).
function MindyMark() {
  return (
    <svg
      width="200"
      height="160"
      viewBox="0 0 1024 820"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#253f91"
        d="M0 820V206C0 91 91 0 206 0c46 0 91 14 130 40l321 209c20 13 46 13 66 0l321-209c39-26 84-40 130-40 115 0 206 91 206 206v614H0Z"
        transform="scale(.742)"
      />
      <path
        fill="#fff"
        d="M257 234c0-34 28-62 62-62 17 0 32 7 44 18l78 78c89 88 209 138 335 138 126 0 247-50 336-139l104-104c12-12 28-18 45-18 35 0 63 28 63 63v406c0 42-34 76-76 76H518L257 820V234Z"
        transform="translate(35 0) scale(.72)"
      />
      <circle cx="334" cy="487" r="62" fill="#8b5cf6" />
      <circle cx="512" cy="487" r="62" fill="#a78bfa" />
      <circle cx="690" cy="487" r="62" fill="#c4b5fd" />
    </svg>
  );
}

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          // Brand gradient — navy at top-left fading to purple at bottom-
          // right. Matches the mindy-landing hero.
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #4c1d95 100%)',
          padding: '80px 96px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Top row: mark + small wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <MindyMark />
          <div
            style={{
              fontSize: '40px',
              color: '#cbd5e1',
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            Mindy
          </div>
        </div>

        {/* Mid-card spacer that lets the headline anchor toward the
            bottom-third sweet spot. Open Graph crops are unpredictable
            across platforms; weight content low so it survives clipping. */}
        <div style={{ display: 'flex', flex: '1' }} />

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            fontSize: '88px',
            color: '#ffffff',
            fontWeight: 800,
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            marginBottom: '24px',
          }}
        >
          Meet Mindy.
        </div>

        {/* Subhead */}
        <div
          style={{
            display: 'flex',
            fontSize: '40px',
            color: '#c4b5fd',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
            marginBottom: '36px',
          }}
        >
          Your 24/7 Federal Market Intelligence Analyst
        </div>

        {/* Tagline strip — small, sits at the floor of the card */}
        <div
          style={{
            display: 'flex',
            fontSize: '26px',
            color: '#94a3b8',
            fontWeight: 400,
            lineHeight: 1.3,
            fontStyle: 'italic',
          }}
        >
          The big contractors have armies. You have Mindy.
        </div>
      </div>
    ),
    { ...size }
  );
}
