/**
 * Self-hosted fonts: the class names that set each font's CSS variable, and the files each layout
 * preloads. The @font-face rules live in src/app/self-hosted-fonts.css (imported by the root layout).
 *
 * Replaces next/font/google, whose build-time download from Google failed three production builds
 * on 2026-11-17. Same families, weights, display, unicode-ranges and metric-adjusted fallbacks, and
 * the identical font files; see the CSS file's header.
 */
import { preload } from 'react-dom';

export const FONT_BASE_PATH = '/fonts/app/v1';

/** Same variable names as before: --font-inter, --font-jetbrains-mono, --font-space-grotesk, --font-plex-mono. */
export const FONT_CLASS = {
  inter: 'mindy-font-inter',
  jetbrainsMono: 'mindy-font-jetbrains-mono',
  spaceGrotesk: 'mindy-font-space-grotesk',
  plexMono: 'mindy-font-plex-mono',
} as const;

/** The files next/font preloaded: each layout's latin subset files. */
export const ROOT_PRELOADS = [
  'inter-latin-wght-normal.woff2',
  'jetbrains-mono-latin-wght-normal.woff2',
] as const;
export const APP_PRELOADS = [
  'space-grotesk-latin-wght-normal.woff2',
  'ibm-plex-mono-latin-400-normal.woff2',
  'ibm-plex-mono-latin-500-normal.woff2',
  'ibm-plex-mono-latin-600-normal.woff2',
] as const;

/** Emit <link rel="preload" as="font"> for these files (React hoists it into <head>). */
export function preloadFonts(files: readonly string[]): void {
  for (const f of files) preload(`${FONT_BASE_PATH}/${f}`, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
}
