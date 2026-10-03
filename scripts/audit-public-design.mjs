#!/usr/bin/env node
/**
 * audit-public-design — the public site may use exactly one visual system.
 *
 * Every file listed in src/lib/public-site/opt-in.json (directories are walked) must:
 *   - use no purple, violet, indigo or fuchsia: no Tailwind utilities in those families, and
 *     no hex/rgb colour with a purple hue;
 *   - use no gradients and no dark-slate or black backgrounds;
 *   - use none of the authenticated app's @theme tokens (bg-ground, text-ink, bg-accent, ...),
 *     which resolve to its dark palette;
 *   - opt out of automatic dark mode (no `dark:` variants, no prefers-color-scheme: dark);
 *   - stay at or below font weight 700;
 *   - name no font family other than Libre Baskerville, Inter and IBM Plex Mono (plus their
 *     system fallbacks), and load no fonts from a CDN;
 *   - use only hex colours from src/lib/public-site/tokens.ts;
 *   - render inside the shared system: an app file must import it or sit under a family
 *     layout.tsx that renders PublicShell. Components listed here render only inside the shell.
 *
 * Directories are walked, so a migrated route family stays guarded when pages are added to it.
 * Generated social images (opengraph-image, twitter-image, icon) are metadata, not page UI, and
 * are skipped.
 *
 * The purple Mindy logo is an image asset, not a colour, so nothing here touches it.
 *
 * Unlike audit-design-tokens.mjs there is no baseline: an opted-in file is either clean or
 * blocked. Files join the list only when their route is migrated.
 *
 * Run:  node scripts/audit-public-design.mjs          (gate; exit 1 on any finding)
 *       node scripts/audit-public-design.mjs --list   (print the files checked)
 *       node scripts/audit-public-design.mjs --self-test
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, relative } from 'path';

const ROOT = process.cwd();
const MANIFEST = 'src/lib/public-site/opt-in.json';
const TOKENS = 'src/lib/public-site/tokens.ts';
const SHARED_DIRS = ['src/lib/public-site/', 'src/components/public-site/'];

function walk(p, out = []) {
  if (!existsSync(p)) throw new Error(`opt-in path does not exist: ${p}`);
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e), out);
  } else if (/\.(tsx?|jsx?|mjs|css)$/.test(p) && !/\.(test|spec)\./.test(p) && !/\/(?:opengraph-image|twitter-image|icon|apple-icon)\.[jt]sx?$/.test(p)) {
    out.push(relative(ROOT, p));
  }
  return out;
}

/** Remove block comments and `//` line comments (not `://` in URLs). */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

/** True when a layout.tsx between the file's directory and src/app renders PublicShell. */
function underShellLayout(file) {
  let dir = dirname(file);
  while (dir.startsWith('src/app')) {
    const layout = join(ROOT, dir, 'layout.tsx');
    if (existsSync(layout) && /<PublicShell\b/.test(readFileSync(layout, 'utf8'))) return true;
    dir = dirname(dir);
  }
  return false;
}

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isPurple([r, g, b]) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  if (d < 0.08) return false;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s < 0.2) return false;
  let h;
  const R = r / 255, G = g / 255, B = b / 255;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return h >= 250 && h <= 320;
}

function tokenPalette() {
  const src = readFileSync(join(ROOT, TOKENS), 'utf8');
  const block = src.slice(src.indexOf('MP_COLORS'), src.indexOf('} as const'));
  const hexes = new Set((block.match(/#[0-9a-fA-F]{6}\b/g) || []).map((h) => h.toLowerCase()));
  hexes.add('#fff');
  hexes.add('#ffffff');
  return hexes;
}

const RULES = [
  { id: 'purple-utility', re: /\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|decoration|divide|accent|caret|placeholder)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b/g, msg: 'purple-family Tailwind colour' },
  { id: 'purple-word', re: /\b(?:purple|violet|indigo|fuchsia|blueviolet|darkviolet|mediumpurple|rebeccapurple)\b(?=\s*[;}"'`)!])/g, msg: 'purple-family named colour' },
  { id: 'gradient', re: /\b(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\(|\bbg-gradient-to-\w+|\bbg-(?:linear|radial|conic)-\w+/g, msg: 'gradient' },
  { id: 'dark-bg', re: /\bbg-(?:slate|gray|zinc|neutral|stone)-(?:800|900|950)\b|\bbg-black\b/g, msg: 'dark background' },
  { id: 'dark-mode', re: /\bdark:[\w-]+|prefers-color-scheme\s*:\s*dark/g, msg: 'automatic dark mode' },
  { id: 'weight', re: /(?<![-\w])font-(?:extrabold|black)\b|font-weight\s*:\s*[89]00\b|\bfont\s*:\s*(?:italic\s+)?[89]00\b|fontWeight\s*:\s*['"]?[89]00/g, msg: 'font weight above 700' },
  { id: 'font-family', re: /\b(?:Newsreader|JetBrains|Roboto|Poppins|Montserrat|Lato|Open Sans|Playfair|Merriweather|Source Serif|Space Grotesk|DM Sans|Helvetica Neue|Arial)\b|(?<![-\w])font-(?:mono|serif)\b/g, msg: 'font outside Libre Baskerville / Inter / IBM Plex Mono' },
  { id: 'app-theme', re: /(?<![\w(-])(?:[a-z-]+:)*(?:bg|text|border|ring|divide|placeholder|from|via|to|fill|stroke|outline)-(?:ground(?:-deep)?|surface(?:-2)?|input|hairline|ink(?:-soft)?|muted|faint|accent(?:-[a-z]+)?|navy(?:-\d{3}|-hover)?)(?![\w(-])/g, msg: 'authenticated-app theme token (dark @theme); use the --mp-* roles' },
  { id: 'font-cdn', re: /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net/g, msg: 'font loaded from a CDN (use src/lib/public-site/fonts.ts)' },
];

export function auditSource(file, src, palette) {
  const findings = [];
  const code = stripComments(src);
  const lineOf = (i) => code.slice(0, i).split('\n').length;
  for (const r of RULES) {
    for (const m of code.matchAll(r.re)) findings.push({ file, line: lineOf(m.index), rule: r.id, msg: r.msg, text: m[0] });
  }
  if (file !== TOKENS) {
    for (const m of code.matchAll(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0].toLowerCase();
      if (![4, 5, 7, 9].includes(hex.length)) continue;
      const rgb = hexToRgb(hex);
      if (isPurple(rgb)) findings.push({ file, line: lineOf(m.index), rule: 'purple-hex', msg: 'purple-hue colour', text: m[0] });
      else if (!palette.has(hex.length === 9 ? hex.slice(0, 7) : hex)) findings.push({ file, line: lineOf(m.index), rule: 'off-palette', msg: 'hex colour not in tokens.ts', text: m[0] });
    }
  }
  for (const m of code.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g)) {
    if (isPurple([+m[1], +m[2], +m[3]])) findings.push({ file, line: lineOf(m.index), rule: 'purple-rgb', msg: 'purple-hue colour', text: m[0] });
  }
  const shared = SHARED_DIRS.some((d) => file.startsWith(d));
  const appFile = file.startsWith('src/app/');
  if (!shared && appFile && /\.(tsx?|jsx?)$/.test(file) && !/@\/(?:lib|components)\/public-site\//.test(src) && !underShellLayout(file)) {
    findings.push({ file, line: 1, rule: 'shared-import', msg: 'opted-in route neither imports the public design system nor sits under a PublicShell layout', text: '' });
  }
  return findings;
}

function selfTest() {
  const palette = tokenPalette();
  const bad = [
    'className="bg-purple-600"', 'background:linear-gradient(135deg,#1e3a8a,#7c3aed)', 'className="bg-slate-950"',
    'className="dark:bg-black"', 'font-weight:800', 'className="font-black"', 'color:#7c3aed', 'color:#123456',
    "font-family:'Newsreader'", 'rgba(124,58,237,.5)', '@import url(https://fonts.googleapis.com/css2)',
    'className="font-mono text-sm"', 'className="bg-ground-deep text-ink"', 'className="hover:bg-accent-hover"', 'className="border-hairline"',
  ];
  const good = [
    'color:#1B3A6B', 'background:#fff', 'font:700 16px Inter', '/* #7c3aed in a comment */', 'href="https://x.y/z" // note',
    '&#39;', 'font:400 13px var(--mp-font-mono)', 'font:700 1rem var(--mp-font-serif)',
    'className="bg-(--mp-surface) text-(--mp-ink) border-(--mp-line)"', 'className="text-muted-foreground-x"',
  ];
  let ok = true;
  for (const s of bad) {
    const f = auditSource('src/lib/public-site/x.ts', s, palette);
    if (!f.length) { ok = false; console.error(`self-test: expected a finding for ${s}`); }
  }
  for (const s of good) {
    const f = auditSource('src/lib/public-site/x.ts', s, palette);
    if (f.length) { ok = false; console.error(`self-test: unexpected finding for ${s}: ${f.map((x) => x.rule)}`); }
  }
  console.log(ok ? 'self-test passed' : 'self-test FAILED');
  process.exit(ok ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8'));
  const files = manifest.files.flatMap((p) => walk(join(ROOT, p)));
  if (process.argv.includes('--list')) {
    for (const f of files) console.log(f);
    return;
  }
  const palette = tokenPalette();
  const findings = files.flatMap((f) => auditSource(f, readFileSync(join(ROOT, f), 'utf8'), palette));
  if (!findings.length) {
    console.log(`public design: ${files.length} opted-in files clean`);
    return;
  }
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}  ${f.msg}  ${f.text}`);
  console.log(`\npublic design: ${findings.length} finding(s) in ${new Set(findings.map((f) => f.file)).size} file(s)`);
  process.exit(1);
}

main();
