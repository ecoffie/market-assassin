import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT_MENU_CSS } from '@/app/opportunity-map/account-menu';
import { MP_COLORS, MP_FONT_WEIGHTS, MP_MAX_FONT_WEIGHT } from './tokens';
import { MP_ACCOUNT_OVERRIDES_CSS, MP_ROOT_PAINT_CSS, MP_SITE_CSS, mpTokenDeclarations } from './css';
import { MP_FONT_BASE_PATH, MP_FONT_FILES, mpFontFaceCss, mpFontPreloadHrefs } from './fonts';

function braceDepth(css: string): number {
  let depth = 0;
  for (const ch of css.replace(/"(?:[^"\\]|\\.)*"/g, '""')) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

describe('public-site tokens', () => {
  it('declares every colour as an --mp-* property', () => {
    const decl = mpTokenDeclarations();
    for (const value of Object.values(MP_COLORS)) expect(decl).toContain(value);
    expect(decl).toContain('--mp-navy-hover:#12294D');
  });

  it('keeps every approved weight at or below the cap', () => {
    for (const weights of Object.values(MP_FONT_WEIGHTS)) {
      for (const w of weights) expect(w).toBeLessThanOrEqual(MP_MAX_FONT_WEIGHT);
    }
  });

  it('meets AA for secondary text on paper and white', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    for (const fg of [MP_COLORS.muted, MP_COLORS.subtle, MP_COLORS.warn, MP_COLORS.navy, MP_COLORS.accent]) {
      expect(ratio(fg, MP_COLORS.paper)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(fg, MP_COLORS.surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(MP_COLORS.muted, MP_COLORS.wash)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('public-site fonts', () => {
  it('ships every declared font file', () => {
    const all = [...MP_FONT_FILES.serif, ...MP_FONT_FILES.mono, ...MP_FONT_FILES.inter];
    for (const f of all) expect(existsSync(join(process.cwd(), 'public', MP_FONT_BASE_PATH, f.file)), f.file).toBe(true);
    for (const href of mpFontPreloadHrefs({ includeInter: true })) {
      expect(existsSync(join(process.cwd(), 'public', href))).toBe(true);
    }
  });

  it('declares Inter only for raw-HTML pages', () => {
    expect(mpFontFaceCss({ includeInter: false })).not.toContain('"Inter"');
    expect(mpFontFaceCss({ includeInter: true })).toContain('"Inter"');
    expect(MP_SITE_CSS).not.toContain('font-family:"Inter"');
  });

  it('loads nothing from a font CDN', () => {
    expect(mpFontFaceCss({ includeInter: true })).not.toMatch(/googleapis|gstatic/);
    expect(MP_SITE_CSS).not.toMatch(/googleapis|gstatic/);
  });
});

describe('public-site css', () => {
  it('is structurally balanced', () => {
    expect(braceDepth(MP_SITE_CSS)).toBe(0);
    expect(braceDepth(MP_ROOT_PAINT_CSS)).toBe(0);
  });

  it('paints the canvas on html and body', () => {
    expect(MP_ROOT_PAINT_CSS).toContain(`html{background-color:${MP_COLORS.paper};color-scheme:light}`);
    expect(MP_ROOT_PAINT_CSS).toContain(`html body{background-color:${MP_COLORS.paper}`);
  });

  it('overrides the account gradient with solid navy, after the shared account CSS', () => {
    expect(MP_ACCOUNT_OVERRIDES_CSS).not.toMatch(/gradient/);
    expect(MP_ACCOUNT_OVERRIDES_CSS).toContain(`.mindy-acct-btn.mindy-acct-signin{background:${MP_COLORS.navy}`);
    expect(MP_SITE_CSS.indexOf(MP_ACCOUNT_OVERRIDES_CSS)).toBeGreaterThan(MP_SITE_CSS.indexOf(ACCOUNT_MENU_CSS));
  });
});
