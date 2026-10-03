/**
 * The public site's font files, declared once for every public surface.
 *
 * Libre Baskerville and IBM Plex Mono are self-hosted static files at fixed,
 * versioned URLs (`/fonts/mp/v1/`, from the Fontsource 5.3.0 builds of the
 * Google Fonts releases). Raw-HTML route handlers and React pages both declare
 * these same URLs, so a visitor who moves between the two downloads each file
 * once and then reads it from cache.
 *
 * Inter is the one family with two sources. React pages already receive the
 * root layout's next/font Inter on every route, so the React shell reuses it
 * through `--font-inter` instead of adding a second copy to the page. Raw HTML
 * handlers cannot use next/font, so they declare the static Inter file below.
 * Sharing a single Inter file across both would mean changing the root layout's
 * font loading, which also serves the signed-in app.
 */

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

export const MP_FONT_BASE_PATH = '/fonts/mp/v1';

interface FontFile {
  family: 'Libre Baskerville' | 'IBM Plex Mono' | 'Inter';
  file: string;
  weight: string;
  style: 'normal' | 'italic';
  range: string;
}

function pair(family: FontFile['family'], stem: string, weight: string, style: FontFile['style'] = 'normal'): FontFile[] {
  return [
    { family, file: `${stem}-latin-ext-${weight}-${style}.woff2`, weight, style, range: LATIN_EXT },
    { family, file: `${stem}-latin-${weight}-${style}.woff2`, weight, style, range: LATIN },
  ];
}

const SERIF_FILES: FontFile[] = [
  ...pair('Libre Baskerville', 'libre-baskerville', '400'),
  ...pair('Libre Baskerville', 'libre-baskerville', '700'),
  ...pair('Libre Baskerville', 'libre-baskerville', '400', 'italic'),
];

const MONO_FILES: FontFile[] = [
  ...pair('IBM Plex Mono', 'ibm-plex-mono', '400'),
  ...pair('IBM Plex Mono', 'ibm-plex-mono', '500'),
  ...pair('IBM Plex Mono', 'ibm-plex-mono', '600'),
];

const INTER_FILES: FontFile[] = [
  { family: 'Inter', file: 'inter-latin-ext-wght-normal.woff2', weight: '100 900', style: 'normal', range: LATIN_EXT },
  { family: 'Inter', file: 'inter-latin-wght-normal.woff2', weight: '100 900', style: 'normal', range: LATIN },
];

export const MP_FONT_FILES = { serif: SERIF_FILES, mono: MONO_FILES, inter: INTER_FILES } as const;

function faceCss(f: FontFile): string {
  return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${MP_FONT_BASE_PATH}/${f.file}) format("woff2");unicode-range:${f.range}}`;
}

/** `@font-face` rules. `includeInter` is for raw HTML handlers only (see file header). */
export function mpFontFaceCss({ includeInter }: { includeInter: boolean }): string {
  const files = [...SERIF_FILES, ...MONO_FILES, ...(includeInter ? INTER_FILES : [])];
  return files.map(faceCss).join('');
}

/** The files a first paint needs: headline serif, standfirst serif and (raw HTML only) Inter. */
export function mpFontPreloadHrefs({ includeInter }: { includeInter: boolean }): string[] {
  const hrefs = [
    `${MP_FONT_BASE_PATH}/libre-baskerville-latin-700-normal.woff2`,
    `${MP_FONT_BASE_PATH}/libre-baskerville-latin-400-normal.woff2`,
  ];
  if (includeInter) hrefs.push(`${MP_FONT_BASE_PATH}/inter-latin-wght-normal.woff2`);
  return hrefs;
}

export function mpFontPreloadLinksHtml({ includeInter }: { includeInter: boolean }): string {
  return mpFontPreloadHrefs({ includeInter })
    .map((href) => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`)
    .join('');
}
