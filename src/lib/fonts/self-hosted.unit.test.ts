/**
 * Self-hosted fonts guard (2026-11-17: three production builds failed downloading next/font/google).
 *
 *  - nothing in src/ imports next/font/google (the ESLint rule says the same; this test runs in the gate);
 *  - every font url in src/app/self-hosted-fonts.css is a committed file, and every committed file is used;
 *  - every preloaded file exists;
 *  - the four families keep their CSS variables, weights, font-display and metric-adjusted fallbacks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FONT_BASE_PATH, FONT_CLASS, ROOT_PRELOADS, APP_PRELOADS } from './self-hosted';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'src/app/self-hosted-fonts.css'), 'utf8');
const FONT_DIR = join(ROOT, 'public', FONT_BASE_PATH);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && !name.startsWith('.')) sourceFiles(p, out); }
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe('no next/font/google', () => {
  it('no source file imports it (it downloads from Google at build time)', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter((f) => /from\s+['"]next\/font\/google['"]|require\(\s*['"]next\/font\/google['"]\s*\)|import\(\s*['"]next\/font\/google['"]\s*\)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});

describe('self-hosted font files', () => {
  const urls = [...CSS.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  it('every @font-face url is a committed file under the versioned path', () => {
    expect(urls.length).toBe(40);
    for (const u of urls) {
      expect(u.startsWith(`${FONT_BASE_PATH}/`), u).toBe(true);
      expect(existsSync(join(ROOT, 'public', u)), u).toBe(true);
    }
  });
  it('every committed font file is used (no orphans)', () => {
    const used = new Set(urls.map((u) => u.slice(FONT_BASE_PATH.length + 1)));
    const files = readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2'));
    expect(files.filter((f) => !used.has(f))).toEqual([]);
    expect(files).toHaveLength(used.size);
  });
  it('every preloaded file exists and is a latin subset', () => {
    for (const f of [...ROOT_PRELOADS, ...APP_PRELOADS]) {
      expect(existsSync(join(FONT_DIR, f)), f).toBe(true);
      expect(f).toMatch(/-latin-/);
    }
  });
  it('the OFL license ships with each family', () => {
    for (const fam of ['inter', 'jetbrains-mono', 'space-grotesk', 'ibm-plex-mono']) {
      expect(readFileSync(join(FONT_DIR, 'LICENSES', `${fam}-OFL.txt`), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
    }
  });
});

describe('same families, weights, display and fallbacks as next/font/google generated', () => {
  const faces = (fam: string) => [...CSS.matchAll(new RegExp(`@font-face\\{font-family:'${fam}';[^}]*\\}`, 'g'))].map((m) => m[0]);
  it.each([
    ['Inter', 7, ['100 900']],
    ['JetBrains Mono', 6, ['100 800']],
    ['Space Grotesk', 9, ['500', '600', '700']],
    ['IBM Plex Mono', 18, ['400', '500', '600']],
  ] as const)('%s: %i faces, weights %j, font-display swap, each with a unicode-range', (fam, count, weights) => {
    const f = faces(fam);
    expect(f).toHaveLength(count);
    expect(new Set(f.map((x) => x.match(/font-weight:([^;]+);/)![1]))).toEqual(new Set(weights));
    for (const x of f) { expect(x).toContain('font-display:swap'); expect(x).toMatch(/unicode-range:U\+/); }
  });
  it.each([
    ['Inter', 'ascent-override:90.44%;descent-override:22.52%;line-gap-override:0.0%;size-adjust:107.12%'],
    ['JetBrains Mono', 'ascent-override:75.79%;descent-override:22.29%;line-gap-override:0.0%;size-adjust:134.59%'],
    ['Space Grotesk', 'ascent-override:89.71%;descent-override:26.62%;line-gap-override:0.0%;size-adjust:109.69%'],
    ['IBM Plex Mono', 'ascent-override:76.16%;descent-override:20.43%;line-gap-override:0.0%;size-adjust:134.59%'],
  ])('%s Fallback keeps the exact metric overrides on Arial', (fam, metrics) => {
    expect(CSS).toContain(`@font-face{font-family:'${fam} Fallback';src:local(Arial);${metrics}}`);
  });
  it.each([
    [FONT_CLASS.inter, '--font-inter:"Inter", "Inter Fallback"'],
    [FONT_CLASS.jetbrainsMono, '--font-jetbrains-mono:"JetBrains Mono", "JetBrains Mono Fallback"'],
    [FONT_CLASS.spaceGrotesk, '--font-space-grotesk:"Space Grotesk", "Space Grotesk Fallback"'],
    [FONT_CLASS.plexMono, '--font-plex-mono:"IBM Plex Mono", "IBM Plex Mono Fallback"'],
  ])('.%s sets the same CSS variable as before', (cls, decl) => {
    expect(CSS).toContain(`.${cls}{${decl}}`);
  });
});
