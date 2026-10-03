#!/usr/bin/env node
/**
 * public-site-recolor — moves a public page's Tailwind classes onto the Mindy public palette.
 *
 * Rewrites only Tailwind utility tokens inside string and template literals; copy, links,
 * metadata and markup are untouched, so the parity harness can prove nothing else moved.
 * Colours become `--mp-*` variables (defined on `.mp-site` by PublicShell), so a migrated file
 * must render inside the shell.
 *
 * Context rules (decided per literal, i.e. per className):
 *   - a literal with a solid fill (purple/blue/green/amber button, saturated gradient) keeps
 *     `text-white` and becomes navy; every other `text-white` becomes ink
 *   - dark gradients become a wash band, saturated gradients navy, gradient text oxblood
 *   - large h1–h3 headings get the serif face
 *
 * Run:  node scripts/public-site-recolor.mjs <file...>          (dry run, prints a summary)
 *       node scripts/public-site-recolor.mjs --write <file...>
 * Unmapped colour tokens are listed and make the run exit 1.
 */
import { readFileSync, writeFileSync } from 'fs';

const v = (name) => `(--mp-${name})`;
const R = {
  P: v('paper'), S: v('surface'), W: v('wash'), I: v('ink'), B: v('body'), M: v('muted'), Su: v('subtle'),
  L: v('line'), H: v('hair'), N: v('navy'), NH: v('navy-hover'), NW: v('navy-wash'), A: v('accent'),
  warn: v('warn'), warnBg: v('warn-bg'), warnLine: v('warn-line'), ok: v('ok'), okBg: v('ok-bg'), okLine: v('ok-line'), crit: v('crit'),
};
const NEUTRAL = 'slate|gray|zinc|neutral|stone';
const COOL = 'purple|violet|indigo|fuchsia|blue|sky|cyan';
const GREEN = 'green|emerald|teal|lime';
const WARM = 'amber|yellow|orange';
const RED = 'red|rose|pink';
const HEX = {
  '#111c26': 'I', '#3a4a5c': 'B', '#6b7787': 'M', '#2563eb': 'N', '#1d4ed8': 'NH', '#f5f8fb': 'W', '#eff5ff': 'NW', '#c4cfda': 'L',
  '#ffffff': 'S', '#fff': 'S', '#0f172a': 'I', '#64748b': 'M', '#94a3b8': 'Su', '#e2e8f0': 'L',
  '#eef2f7': 'W', '#fff7ec': 'warnBg', '#dbe7ff': 'L', '#e6ebf0': 'H', '#f0d9b5': 'warnLine', '#f0f3f7': 'H',
  '#137a41': 'ok', '#516072': 'B', '#8595a6': 'Su', '#c2740a': 'warn',
};
// The authenticated app's semantic theme (globals.css @theme) is dark: ground #0f172a, ink #f1f5f9,
// accent violet. Public pages must not inherit it, so each role maps to its public counterpart.
const APP_TOKENS = {
  'bg-ground': `bg-${v('paper')}`, 'bg-ground-deep': `bg-${v('paper')}`, 'bg-surface': `bg-${v('surface')}`,
  'bg-surface-2': `bg-${v('wash')}`, 'bg-input': `bg-${v('wash')}`,
  'border-hairline': `border-${v('line')}`, 'border-surface': `border-${v('line')}`, 'border-input': `border-${v('line')}`,
  'divide-hairline': `divide-${v('hair')}`,
  'text-ink': `text-${v('ink')}`, 'text-ink-soft': `text-${v('body')}`, 'text-muted': `text-${v('muted')}`, 'text-faint': `text-${v('muted')}`,
  'placeholder-faint': `placeholder:text-${v('subtle')}`,
  'bg-accent': `bg-${v('navy')}`, 'bg-accent-hover': `bg-${v('navy-hover')}`, 'text-accent': `text-${v('navy')}`,
  'ring-accent': `ring-${v('navy')}`, 'border-accent': `border-${v('navy')}`,
  'bg-navy': `bg-${v('navy')}`, 'bg-navy-hover': `bg-${v('navy-hover')}`, 'text-navy': `text-${v('navy')}`,
  'text-ok': `text-${v('ok')}`, 'text-warn': `text-${v('warn')}`, 'text-crit': `text-${v('crit')}`,
};
const SATURATED_FROM = new RegExp(`^(?:hover:)?from-(?:${COOL}|${GREEN}|${WARM}|${RED})-[4-7]00(?:/(?:[5-9]\\d|100))?$`);
const LIGHT_FROM = /^from-[a-z]+-(?:50|100|200)(?:\/\d+)?$/;

const unknown = new Map();
const note = (tok, file) => {
  const k = `${tok}`;
  if (!unknown.has(k)) unknown.set(k, new Set());
  unknown.get(k).add(file);
};

function shadeRole(kind, fam, shade, opacity) {
  const s = Number(shade);
  if (new RegExp(`^(?:${NEUTRAL})$`).test(fam)) {
    if (kind === 'text' || kind === 'placeholder' || kind === 'decoration' || kind === 'fill' || kind === 'stroke') {
      if (kind === 'placeholder') return 'Su';
      if (s <= 200) return 'I';
      if (s === 300) return 'B';
      if (s === 400) return 'M';
      if (s === 500) return 'M';
      if (s === 600) return 'M';
      if (s === 700) return 'B';
      return 'I';
    }
    if (kind === 'bg') {
      if (s <= 200) return 'W';
      if (s <= 600) return 'L';
      if (s <= 800) return 'W';
      if (s === 900) return opacity && Number(opacity) < 90 ? 'W' : 'S';
      return opacity ? 'W' : 'P';
    }
    if (kind === 'border' || kind === 'divide' || kind === 'outline') {
      if (s <= 200) return 'H';
      if (s === 800 && opacity) return 'H';
      if (s >= 900) return 'H';
      return 'L';
    }
    if (kind === 'ring' || kind === 'ring-offset') return kind === 'ring-offset' ? 'P' : 'L';
  }
  if (new RegExp(`^(?:${COOL})$`).test(fam)) {
    if (kind === 'text' || kind === 'decoration' || kind === 'fill' || kind === 'stroke' || kind === 'caret' || kind === 'accent') return 'N';
    if (kind === 'placeholder') return 'Su';
    if (kind === 'bg') {
      if (s <= 400) return 'NW';
      if (s <= 700) return opacity && Number(opacity) <= 40 ? 'NW' : 'N';
      return 'NW';
    }
    if (kind === 'border' || kind === 'divide' || kind === 'outline') return s >= 500 && !opacity ? 'N' : 'L';
    if (kind === 'ring') return 'N';
    if (kind === 'ring-offset') return 'P';
  }
  if (new RegExp(`^(?:${GREEN})$`).test(fam)) {
    if (kind === 'bg') return s >= 500 && s <= 700 && !opacity ? 'N' : 'okBg';
    if (kind === 'border' || kind === 'divide' || kind === 'outline' || kind === 'ring') return 'okLine';
    return 'ok';
  }
  if (new RegExp(`^(?:${WARM})$`).test(fam)) {
    if (kind === 'bg') return s >= 400 && s <= 700 && !opacity ? 'N' : 'warnBg';
    if (kind === 'border' || kind === 'divide' || kind === 'outline' || kind === 'ring') return 'warnLine';
    return 'warn';
  }
  if (new RegExp(`^(?:${RED})$`).test(fam)) {
    if (kind === 'bg') return s >= 500 && s <= 700 && !opacity ? 'crit' : 'warnBg';
    if (kind === 'border' || kind === 'divide' || kind === 'outline' || kind === 'ring') return 'warnLine';
    return 'crit';
  }
  return null;
}

const COLOR_RE = new RegExp(
  `^(bg|text|border(?:-[trblxy])?|divide|ring-offset|ring|outline|fill|stroke|placeholder|decoration|accent|caret|shadow|from|via|to)-(${NEUTRAL}|${COOL}|${GREEN}|${WARM}|${RED}|white|black|transparent|current|inherit)(?:-(\\d{2,3}))?(?:/(\\d+|\\[[\\d.]+\\]))?$`,
);
const HEX_RE = /^(bg|text|border(?:-[trblxy])?|divide|from|via|to|fill|stroke|ring|outline|decoration)-\[(#[0-9a-fA-F]{3,8})\]$/;

/** Map one base token (no variant prefix). Returns replacement string ('' drops it) or null for unchanged. */
function mapBase(base, ctx, file) {
  if (/^bg-gradient-to-|^bg-linear-to-/.test(base)) return '';
  if (/^(from|via|to)-/.test(base) && !/^to-(?:\d|full|transparent)/.test(base)) {
    if (COLOR_RE.test(base) || HEX_RE.test(base)) return '';
  }
  if (base === 'bg-clip-text') return '';
  if (base === 'text-transparent' && ctx.gradientText) return '';
  if (/^shadow-(lg|xl|2xl)$/.test(base)) return '';
  if (/^scale-1\d\d$/.test(base) && ctx.variant) return '';
  if (/^rounded(?:-[trbl]{1,2})?-(xl|2xl|3xl)$/.test(base)) return base.replace(/-(xl|2xl|3xl)$/, '-lg');
  if (/^rounded(?:-[trbl]{1,2})?-full$/.test(base) && ctx.button) return base.replace(/-full$/, '-lg');
  if (base === 'font-black' || base === 'font-extrabold') return 'font-bold';
  if (base === 'font-mono') return `font-(family-name:--mp-font-mono)`;
  if (base === 'transition-all' && !ctx.sized) return 'transition-colors';
  if (/^shadow-\[.*rgba\(/.test(base)) return '';
  if (base === 'brightness-110' && ctx.variant) return `bg-${R.NH}`;
  if (base === 'min-h-screen' && ctx.mainRoot) return '';

  const [appBase, appOpacity] = base.split('/');
  const app = APP_TOKENS[appBase];
  if (app) {
    if (app.startsWith('bg-') && (appOpacity || (ctx.variant && app === `bg-${R.S}`))) return `bg-${R.W}`;
    return app;
  }

  const hx = base.match(HEX_RE);
  if (hx) {
    const role = HEX[hx[2].toLowerCase()];
    if (!role) {
      note(base, file);
      return null;
    }
    const kind = hx[1];
    const textRole = kind === 'text' && (role === 'L' || role === 'H' || role === 'Su') ? 'M' : role;
    return `${kind}-${R[textRole]}`;
  }

  const m = base.match(COLOR_RE);
  if (!m) return null;
  const [, kindRaw, fam, shade, opacityRaw] = m;
  const opacity = opacityRaw && opacityRaw.startsWith('[') ? String(Math.round(parseFloat(opacityRaw.slice(1, -1)) * 100)) : opacityRaw;
  const kind = kindRaw.startsWith('border') ? 'border' : kindRaw;
  const out = (role) => `${kindRaw}-${R[role]}`;

  if (kind === 'shadow') return fam === 'black' || fam === 'transparent' ? null : '';
  if (fam === 'transparent' || fam === 'current' || fam === 'inherit') return null;
  if (fam === 'white') {
    if (kind === 'text') {
      if (ctx.solid) return null;
      return opacity ? `text-${R.B}` : `text-${R.I}`;
    }
    if (kind === 'bg') return opacity ? `bg-${R.S}` : null;
    if (kind === 'border' || kind === 'divide') return `${kindRaw}-${R.L}`;
    if (kind === 'ring') return `ring-${R.L}`;
    if (kind === 'fill' || kind === 'stroke') return ctx.solid ? null : `${kindRaw}-${R.I}`;
    return null;
  }
  if (fam === 'black') {
    if (kind === 'bg') return opacity ? `bg-${R.I}/${opacity}` : `bg-${R.I}`;
    if (kind === 'text') return `text-${R.I}`;
    return `${kindRaw}-${R.L}`;
  }
  if (!shade) {
    note(base, file);
    return null;
  }
  const role = shadeRole(kind, fam, shade, opacity);
  if (!role) {
    note(base, file);
    return null;
  }
  return out(role);
}

const TOKEN_RE = /(?<![\w-])((?:[a-z0-9-]+:)*)(-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:-\[[^\]\s]+\])?(?:\/(?:\d+|\[[^\]\s]+\]))?)(?![\w/[-])/g;

function recolorLiteral(text, file, { mainRoot = false } = {}) {
  if (!/(bg|text|border|from|shadow|ring|divide|font|rounded|min-h|scale|transition|brightness)-/.test(text)) return text;
  const tokens = text.split(/\s+/).filter(Boolean);
  const bases = tokens.map((t) => t.slice(t.lastIndexOf(':') + 1));
  const hasGradient = bases.some((b) => /^bg-(gradient|linear)-to-/.test(b));
  const gradientText = hasGradient && bases.includes('bg-clip-text');
  const satGradient = hasGradient && tokens.some((t) => SATURATED_FROM.test(t));
  const lightGradient = hasGradient && tokens.some((t) => LIGHT_FROM.test(t));
  const solidBg = tokens.some((t) => {
    if (t.includes(':')) return false;
    const m = t.match(COLOR_RE);
    if (!m || m[1] !== 'bg') return false;
    const [, , fam, shade, op] = m;
    if (!shade) return false;
    const s = Number(shade);
    return new RegExp(`^(?:${COOL}|${GREEN}|${WARM}|${RED})$`).test(fam) && s >= 500 && s <= 700 && !(op && Number(op) <= 40);
  });
  const alreadySolid = tokens.some((t) => /^bg-\(--mp-(navy|navy-hover|crit|ink)\)$|^bg-(?:accent|navy|crit)$/.test(t));
  const solid = (solidBg || satGradient || alreadySolid) && !gradientText;
  const button = bases.some((b) => /^px-(?:[3-9]|1[0-2])$/.test(b)) && bases.some((b) => /^py-/.test(b));
  const sized = bases.some((b) => /^(?:h|w)-full$/.test(b));
  const ctx = { solid, gradientText, button, mainRoot, sized };

  let addedHoverBg = false;
  let changed = false;
  const out = text.replace(TOKEN_RE, (full, prefix, base) => {
    const variant = prefix.length > 0;
    if (hasGradient && variant && /^from-/.test(base) && satGradient) {
      changed = true;
      if (addedHoverBg) return '';
      addedHoverBg = true;
      return `${prefix}bg-${R.NH}`;
    }
    const r = mapBase(base, { ...ctx, variant }, file);
    if (r === null) return full;
    changed = true;
    if (r === '') return '';
    if (variant && prefix.includes('hover')) {
      if (r === `text-${R.N}` || r === `bg-${R.N}`) return `${prefix}${r.replace(R.N, R.NH)}`;
      if (/^border(?:-[trblxy])?-\(--mp-line\)$/.test(r) && new RegExp(`-(?:${COOL})-`).test(base)) return `${prefix}${r.replace(R.L, R.N)}`;
    }
    return `${prefix}${r}`;
  });
  if (!changed && !hasGradient && !/(?:^|\s)bg-\(--mp-(?:navy|navy-hover|crit|ink)\)(?:\s|$)/.test(text)) return text;
  let res = out;
  if (hasGradient) {
    if (gradientText) res += ` text-${R.A}`;
    else if (satGradient) res += ` bg-${R.N}`;
    else if (lightGradient) res += ` bg-${R.W}`;
    else res += ` bg-${R.W}`;
  }
  if (/(?:^|\s)bg-\(--mp-(?:navy|navy-hover|crit|ink)\)(?:\s|$)/.test(res)) {
    res = res.replace(/(^|\s)text-\(--mp-(?:ink|body)\)(?=\s|$)/g, '$1text-white');
  }
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const collapsed = res.split(/\s+/).filter(Boolean);
  const dedup = [...new Set(collapsed)].join(' ');
  return lead + dedup + trail;
}

const HEADING_SIZE = /(?:^|\s)(?:[a-z]+:)*text-(?:xl|[2-9]xl)(?:\s|$)/;
const SERIF = 'font-(family-name:--mp-font-serif)';

const QUOTED = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

function transform(src, file) {
  let s = src.replace(/(<main\b[^>]*?className=)(["'])([^"']*)\2/g, (m, a, q, cls) => `${a}${q}${recolorLiteral(cls, file, { mainRoot: true })}${q}`);
  s = s.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (lit) => {
    const q = lit[0];
    const body = lit.slice(1, -1);
    if (q === '`') {
      const parts = body.split(/(\$\{[^}]*\})/);
      return q + parts.map((p) => (p.startsWith('${') ? p.replace(QUOTED, (inner) => inner[0] + recolorLiteral(inner.slice(1, -1), file) + inner[0]) : recolorLiteral(p, file))).join('') + q;
    }
    return q + recolorLiteral(body, file) + q;
  });
  s = s.replace(/(<h([1-3])\b[^>]*?className=)(["'])([^"']*)\3/g, (m, a, lvl, q, cls) => {
    if (cls.includes(SERIF)) return m;
    if (lvl === '1' || HEADING_SIZE.test(cls)) return `${a}${q}${cls} ${SERIF}${q}`;
    return m;
  });
  return s;
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter((a) => !a.startsWith('--'));
let changedFiles = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const out = transform(src, f);
  if (out !== src) {
    changedFiles++;
    if (write) writeFileSync(f, out);
  }
}
console.log(`${write ? 'rewrote' : 'would rewrite'} ${changedFiles}/${files.length} files`);
if (unknown.size) {
  console.log(`\nunmapped colour tokens (${unknown.size}):`);
  for (const [tok, fs] of [...unknown].sort()) console.log(`  ${tok}  ← ${[...fs].map((x) => x.replace(/^src\//, '')).slice(0, 3).join(', ')}`);
  process.exit(1);
}
