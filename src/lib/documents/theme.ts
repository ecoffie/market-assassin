/**
 * The document engine's THEME LAYER (Eric, 2026-11-17: "we need to be flexible to change the styling
 * as needed"). One token object, read by BOTH renderers — the PDF (render-html.ts + charts.ts) and the
 * DOCX (render-docx.ts) — so a preset restyles both formats identically.
 *
 * Styling only. A theme never changes structure, wording, labels or grounding: the Planning
 * assumption / Recommendation / Unverified — no source wording is identical in every theme, and the
 * assumption chip stays amber everywhere so it can never be mistaken for a fact.
 *
 * Scope guard: presets are code. There is no theme editor and no user-uploaded theme. A DocModel picks
 * a preset by name (`model.theme`); an unknown or missing name falls back to the default and never
 * blocks a render.
 *
 * Hex values are bare ("0B2545"): DOCX wants them that way; `hex()` prefixes them for CSS/SVG.
 */

export interface CalloutColors { fill: string; border: string; text: string }

export interface Theme {
  name: ThemeName;
  colors: {
    ink: string;
    muted: string;
    /** Cover metadata / subtitle. */
    meta: string;
    /** Title, headings, citations, emphasis, italic quoted wording. */
    accent: string;
    /** Secondary accent: gradient end, cover rule, kicker. */
    accent2: string;
    title: string;
    white: string;
    tableHeaderBg: string;
    tableHeaderFg: string;
    rowFill: string;
    /** Thin rules: row separators, heading rules, card borders. */
    rule: string;
    na: string;
    /** PDF only: the page background behind the content. */
    pageBg: string;
    panelBg: string;
    caution: CalloutColors;
    keyMessage: CalloutColors;
    note: CalloutColors;
    recommendation: { fill: string; text: string; border: string };
    /** Same in every theme by design (distinct from facts). */
    assumption: { fill: string; text: string };
    unverified: { fill: string; text: string };
    chart: { primary: string; series: string[]; axis: string; grid: string };
  };
  fonts: { pdf: string; docx: string };
  /** 'band' = full-width colored bar, white uppercase text · 'numbered-rule' = "1. Summary" in accent + thin rule. */
  headingStyle: 'band' | 'numbered-rule';
  table: { headerRadiusPx: number; uppercaseHeader: boolean; boldFirstColumn: boolean };
  /** 'letterhead' = logo + contact lines over an accent rule, then title, byline and a key-value table · 'brand-band' = rounded brand header band + key-value card · 'rule' = title, gray metadata, accent rule. */
  cover: 'letterhead' | 'brand-band' | 'rule';
  /** The header band's gradient (PDF); DOCX uses a solid band in `accent`. */
  gradient?: [string, string];
  brand: { mark: string; name: string; tagline: string; contactLines: string[] };
}

export type ThemeName = 'mindy' | 'briefing';

/** Mindy's public brand lines (product site and support desk — never a personal address). */
const MINDY_BRAND = { mark: 'M', name: 'Mindy', tagline: 'FEDERAL MARKET INTELLIGENCE', contactLines: ['getmindy.ai', 'support@getmindy.ai'] };

const SHARED = {
  ink: '1F2937', muted: '6B7280', meta: '4B5563', white: 'FFFFFF', na: '9CA3AF',
  assumption: { fill: 'FEF3C7', text: '92400E' },
  unverified: { fill: 'FEE2E2', text: '991B1B' },
};

export const THEMES: Record<ThemeName, Theme> = {
  /** Default. Letterhead cover (logo, contact lines, purple rule), numbered navy headings, rounded navy table headers. */
  mindy: {
    name: 'mindy',
    colors: {
      ...SHARED,
      accent: '1E3A8A', accent2: '7C3AED', title: '1E3A8A',
      tableHeaderBg: '1E3A8A', tableHeaderFg: 'FFFFFF', rowFill: 'F5F6FB', rule: 'E2E5F0',
      // White, not a tint: Chromium never paints the @page margins, so a tinted page prints as a framed
      // gray panel; full-bleed would need zero page margins, which removes the header/footer (A5, v5).
      pageBg: 'FFFFFF', panelBg: 'FFFFFF',
      caution: { fill: 'FDECEC', border: 'B91C1C', text: '7F1D1D' },
      keyMessage: { fill: 'EEF0FB', border: '1E3A8A', text: '1F2937' },
      note: { fill: 'F8FAFC', border: '94A3B8', text: '1F2937' },
      recommendation: { fill: 'EDE9FE', text: '5B21B6', border: '7C3AED' },
      chart: { primary: '1E3A8A', series: ['1E3A8A', '7C3AED', '0F766E', 'B45309', 'BE123C', '4B5563'], axis: 'D1D5DB', grid: 'F1F5F9' },
    },
    fonts: { pdf: '"Helvetica Neue", Helvetica, Arial, sans-serif', docx: 'Calibri' },
    headingStyle: 'numbered-rule',
    table: { headerRadiusPx: 6, uppercaseHeader: false, boldFirstColumn: true },
    cover: 'letterhead',
    gradient: ['1E3A8A', '7C3AED'],
    brand: MINDY_BRAND,
  },
  /** Briefing: navy title + gold rule, full-width navy section bands, uppercase table headers. */
  briefing: {
    name: 'briefing',
    colors: {
      ...SHARED,
      accent: '0B2545', accent2: 'B8892A', title: '0B2545',
      tableHeaderBg: '0B2545', tableHeaderFg: 'FFFFFF', rowFill: 'EEF2F7', rule: 'D9DEE7',
      pageBg: 'FFFFFF', panelBg: 'F9FAFB',
      caution: { fill: 'FBE9E9', border: 'B91C1C', text: '7F1D1D' },
      keyMessage: { fill: 'EEF2F7', border: '0B2545', text: '1F2937' },
      note: { fill: 'F8FAFC', border: '94A3B8', text: '1F2937' },
      recommendation: { fill: 'FBF3E0', text: '8C6418', border: 'B8892A' },
      chart: { primary: '0B2545', series: ['0B2545', 'B8892A', '0F766E', 'B45309', 'BE123C', '4B5563'], axis: 'D1D5DB', grid: 'F1F5F9' },
    },
    fonts: { pdf: 'Helvetica, Arial, sans-serif', docx: 'Arial' },
    headingStyle: 'band',
    table: { headerRadiusPx: 0, uppercaseHeader: true, boldFirstColumn: false },
    cover: 'rule',
    brand: MINDY_BRAND,
  },
};

export const DEFAULT_THEME: ThemeName = 'mindy';
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(THEMES, v);
}

/** The preset for a model's `theme`. Unknown or missing → the default, never an error. */
export function resolveTheme(name: unknown): Theme {
  return THEMES[isThemeName(name) ? name : DEFAULT_THEME];
}

export const hex = (h: string) => `#${h.toLowerCase()}`;
