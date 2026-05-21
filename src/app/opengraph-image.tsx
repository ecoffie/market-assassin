/**
 * Programmatic Open Graph card for getmindy.ai / mi.govcongiants.com.
 *
 * Next.js App Router convention: a default-exported component in
 * src/app/opengraph-image.tsx is rendered at build time into a 1200×630
 * PNG and automatically wired to <meta property="og:image"> on every
 * page that doesn't define its own.
 *
 * Branding anchored to src/app/mindy-landing/page.tsx:
 *   headline: "Meet Mindy."
 *   subhead:  "Your 24/7 Federal Market Intelligence Analyst."
 *   tagline:  "The big contractors have armies. You have Mindy."
 *
 * Logo strategy: read the PNG off the filesystem at build time and
 * inline it as a base64 data URI. This is the canonical brand asset
 * the rest of the app uses (src/components/mindy/MindyLogo.tsx points
 * at the same file). Building the data URI at module-load means the
 * OG endpoint stays static (rendered at build time, not request) and
 * we never depend on edge fetch.
 */
import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Next.js metadata-route hooks for the convention file.
export const alt = 'Mindy — Your 24/7 Federal Market Intelligence Analyst';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Load the canonical Mindy logo PNG at module-load time (build time).
// process.cwd() points at the project root when Next is generating
// static pages, so /public/brand/mindy-logo-icon.png is reachable.
// If the file ever goes missing, fall back to an empty data URI so
// the build doesn't break — the card renders without the logo
// (regrettable, but loud failure here would block deploys).
let logoDataUri = '';
try {
  const buffer = readFileSync(join(process.cwd(), 'public', 'brand', 'mindy-logo-icon.png'));
  logoDataUri = `data:image/png;base64,${buffer.toString('base64')}`;
} catch (err) {
  console.warn('[opengraph-image] Could not load Mindy logo:', err);
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
        {/* Top row: mark + wordmark. Logo is the same PNG asset
            MindyLogo.tsx uses in the app, so the OG card matches what
            visitors see when they land. Source PNG is 3104×2480
            (1.25:1); render at 200×160 to match. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          {logoDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUri} alt="" width={200} height={160} style={{ display: 'block' }} />
          ) : null}
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
