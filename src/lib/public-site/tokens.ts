/**
 * Mindy public-site design tokens — the ONLY visual system for public, indexable pages.
 *
 * Derived from the homepage (/today, src/app/today/route.ts) — its computed styles, measured
 * on prod 2026-10-03. Every public surface (React pages through <PublicShell>, raw-HTML route
 * handlers through css.ts) reads these values; nothing else may define a palette.
 *
 * Two deliberate departures from the homepage's literal values, both for WCAG AA:
 *   - secondary text: #7A7266 measured 4.17:1 on the wash → `muted` is #6B6459 (5.1:1 on wash).
 *   - tertiary text: the homepage set small meta text in #9A9384 (2.92:1) → `subtle` #7A7266
 *     (4.55:1 on paper). #9A9384 survives as `faint`, for non-text decoration only.
 *
 * The authenticated product (/app, the map, the dark `globals.css` theme) does NOT use these
 * tokens and must not be changed by them. The purple Mindy logo mark is a protected brand
 * asset (an image), not a UI colour — purple/violet/indigo never appears as a token here.
 */

export const MP_COLORS = {
  paper: '#FBFAF7',
  surface: '#FFFFFF',
  wash: '#F3F0E9',

  ink: '#12100E',
  body: '#3A352E',
  muted: '#6B6459',
  subtle: '#7A7266',
  faint: '#9A9384',

  line: '#DCD8CF',
  hair: '#EDEAE3',

  navy: '#1B3A6B',
  navyHover: '#12294D',
  navyWash: '#EFF5FF',

  /** Editorial emphasis only: kickers, the LIVE mark. Never a status colour. */
  accent: '#8C2F1E',

  /** Status only: closing soon, warnings. Never editorial emphasis. */
  warn: '#B54708',
  warnBg: '#FFFAEB',
  warnLine: '#FEDF89',

  ok: '#027A48',
  okBg: '#ECFDF3',
  okLine: '#ABEFC6',
  up: '#15803D',
  crit: '#B91C1C',
} as const;

export type MpColor = keyof typeof MP_COLORS;

export const MP_FONT_FAMILIES = {
  serif: 'Libre Baskerville',
  sans: 'Inter',
  mono: 'IBM Plex Mono',
} as const;

/** Approved weights per family. Nothing on a public page may exceed 700. */
export const MP_FONT_WEIGHTS = {
  serif: [400, 700],
  sans: [400, 500, 600, 700],
  mono: [400, 500, 600],
} as const;

export const MP_MAX_FONT_WEIGHT = 700;

/**
 * Font stacks, valid on both React pages and raw-HTML handlers. On React pages `--font-inter`
 * is the root layout's next/font Inter; on raw-HTML pages it is unset and "Inter" resolves to
 * the static file declared in fonts.ts.
 */
export const MP_FONT_STACKS = {
  serif: `"${MP_FONT_FAMILIES.serif}", Georgia, serif`,
  sans: `var(--font-inter, "${MP_FONT_FAMILIES.sans}"), system-ui, -apple-system, sans-serif`,
  mono: `"${MP_FONT_FAMILIES.mono}", ui-monospace, monospace`,
} as const;

export const MP_LAYOUT = {
  contentMax: '1080px',
  wideMax: '1180px',
  proseMax: '720px',
  gutter: '24px',
  headerHeight: '52px',
  sectionGap: '60px',
  chapterGap: '72px',
} as const;

/**
 * The homepage is square-cornered: buttons, cards and panels are radius 0. Rounding is
 * reserved for small chips and form controls.
 */
export const MP_RADIUS = {
  none: '0',
  chip: '6px',
  control: '8px',
} as const;
