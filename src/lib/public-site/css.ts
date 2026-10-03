/**
 * The public site's CSS, as strings, so React pages (<PublicShell>) and raw-HTML route
 * handlers (/today) emit the same rules from the same tokens.
 *
 * Class names are `mp-*`. Nothing here may reference a colour, font or radius that is not in
 * tokens.ts; `scripts/audit-public-design.mjs` enforces that for every opted-in file.
 */
import { ACCOUNT_MENU_CSS } from '@/app/opportunity-map/account-menu';
import { MP_COLORS, MP_FONT_STACKS, MP_LAYOUT, MP_RADIUS } from './tokens';
import { mpFontFaceCss } from './fonts';

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `--mp-*` custom-property declarations (no selector). */
export function mpTokenDeclarations(): string {
  const colors = Object.entries(MP_COLORS).map(([k, v]) => `--mp-${kebab(k)}:${v}`);
  const fonts = Object.entries(MP_FONT_STACKS).map(([k, v]) => `--mp-font-${k}:${v}`);
  const layout = Object.entries(MP_LAYOUT).map(([k, v]) => `--mp-${kebab(k)}:${v}`);
  const radius = Object.entries(MP_RADIUS).map(([k, v]) => `--mp-radius-${k}:${v}`);
  return [...colors, ...fonts, ...layout, ...radius].join(';');
}

/**
 * Paints the whole canvas cream: the viewport, iOS/macOS overscroll bounce and the mobile
 * safe-area insets all show the root background, so it has to be set on html and body
 * themselves. `html body` outranks the dark theme's unlayered `body` rule in globals.css,
 * and unlayered CSS outranks the root layout's Tailwind `bg-slate-950` utility.
 *
 * React pages render this as an ordinary in-body <style>, not a hoisted resource, so it is
 * removed when the public page unmounts and the signed-in app keeps its own theme.
 */
export const MP_ROOT_PAINT_CSS =
  `html{background-color:${MP_COLORS.paper};color-scheme:light}`
  + `html body{background-color:${MP_COLORS.paper};color:${MP_COLORS.ink}}`
  + `::-webkit-scrollbar-track{background:${MP_COLORS.wash}}`
  + `::-webkit-scrollbar-thumb{background:${MP_COLORS.line}}`
  + `::-webkit-scrollbar-thumb:hover{background:${MP_COLORS.faint}}`;

/**
 * The shared account chrome ships a navy-to-violet gradient for the "Log In" button and the
 * initials avatar. Public pages override both to solid navy here instead of editing
 * account-menu.ts, so the signed-in map pages, which never load this CSS, are unchanged.
 */
export const MP_ACCOUNT_OVERRIDES_CSS =
  `.mindy-acct-btn.mindy-acct-signin{background:${MP_COLORS.navy};filter:none}`
  + `.mindy-acct-btn.mindy-acct-signin:hover{background:${MP_COLORS.navyHover};filter:none}`
  + `.mindy-acct-btn .mindy-acct-ini{background:${MP_COLORS.navy}}`;

/** Keyboard focus and reduced motion, scoped to `scope` (e.g. `.mp-site` or `` for a whole page). */
export function mpA11yCss(scope: string): string {
  const s = scope ? `${scope} ` : '';
  return `${s}:focus-visible{outline:2px solid ${MP_COLORS.navy};outline-offset:2px}`
    + `@media (prefers-reduced-motion:reduce){${s}*,${s}*::before,${s}*::after{`
    + 'animation-duration:.01ms!important;animation-iteration-count:1!important;'
    + 'transition-duration:.01ms!important;scroll-behavior:auto!important}}';
}

/** The `mp-*` component rules (shell, header, footer, typography, controls). Shared by React and raw HTML. */
export const MP_COMPONENTS_CSS = [
  // Shell
  `.mp-site{${mpTokenDeclarations()};min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;`
    + 'background:var(--mp-paper);color:var(--mp-ink);font-family:var(--mp-font-sans);'
    + '-webkit-font-smoothing:antialiased;padding-bottom:env(safe-area-inset-bottom)}',
  '.mp-site *,.mp-site *::before,.mp-site *::after{box-sizing:border-box}',
  '.mp-main{flex:1 0 auto}',
  '.mp-main:focus{outline:none}',
  '.mp-skip{position:absolute;left:12px;top:-64px;z-index:100;background:var(--mp-navy);color:var(--mp-surface);'
    + 'padding:10px 16px;font:600 14px var(--mp-font-sans);text-decoration:none}',
  '.mp-skip:focus{top:8px}',

  // Header: the homepage's .zhead, without the signed-in rail.
  '.mp-head{position:sticky;top:0;height:var(--mp-header-height);display:flex;align-items:center;'
    + 'justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--mp-line);'
    + 'background:var(--mp-surface);z-index:40}',
  '.mp-head-left,.mp-head-right{display:flex;align-items:center;gap:22px}',
  '.mp-head-left a{font:700 16px var(--mp-font-sans);color:var(--mp-ink);text-decoration:none;white-space:nowrap;letter-spacing:-.01em}',
  '.mp-head-right>a{font:700 15px var(--mp-font-sans);color:var(--mp-ink);text-decoration:none;white-space:nowrap;letter-spacing:-.01em}',
  '.mp-head-left a:hover,.mp-head-right>a:hover{color:var(--mp-navy)}',
  '.mp-head a[aria-current="page"]{color:var(--mp-navy)}',
  '.mp-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}',
  '.mp-logo img{height:25px;width:auto;display:block}',
  '.mp-logo span{font:700 19px var(--mp-font-sans);color:var(--mp-ink);letter-spacing:-.02em}',
  '@media(max-width:1000px){.mp-head-left,.mp-head-right{gap:14px}.mp-head-left a:nth-child(n+3),.mp-head-right>a:first-child{display:none}}',
  '@media(max-width:640px){.mp-head{padding:0 14px;gap:10px}.mp-logo{position:static;transform:none;order:-1;flex:0 0 auto}'
    + '.mp-head-left{display:none}.mp-head-right{gap:12px;margin-left:auto}.mp-head-right>a{display:none}}',

  // Footer: the homepage's .sfoot.
  '.mp-foot{border-top:1px solid var(--mp-line);margin-top:72px;padding:34px var(--mp-gutter) 48px}',
  '.mp-foot-g{display:grid;gap:26px 34px;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));max-width:1100px;margin:0 auto}',
  '.mp-foot h2{font:600 11px var(--mp-font-sans);letter-spacing:.09em;text-transform:uppercase;color:var(--mp-muted);margin:0 0 11px}',
  '.mp-foot ul{list-style:none;margin:0;padding:0}',
  '.mp-foot li{margin:0 0 7px}',
  '.mp-foot a{font:400 13.5px/1.45 var(--mp-font-sans);color:var(--mp-body);text-decoration:none}',
  '.mp-foot a:hover{color:var(--mp-navy);text-decoration:underline}',
  '.mp-foot-b{max-width:1100px;margin:30px auto 0;padding-top:18px;border-top:1px solid var(--mp-hair);font:400 12px var(--mp-font-sans);color:var(--mp-subtle)}',

  // Layout
  '.mp-container{max-width:var(--mp-content-max);margin:0 auto;padding:0 var(--mp-gutter)}',
  '.mp-container--wide{max-width:var(--mp-wide-max)}',
  '.mp-container--prose{max-width:var(--mp-prose-max)}',
  '.mp-section{padding-top:var(--mp-section-gap)}',
  '.mp-section--chapter{border-top:1px solid var(--mp-line);margin-top:var(--mp-chapter-gap)}',
  '.mp-section-h{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:20px}',
  '.mp-rule{border:0;border-top:1px solid var(--mp-line);margin:0}',
  '.mp-rule--strong{border-top:2px solid var(--mp-ink)}',

  // Typography
  '.mp-eyebrow{display:block;font:700 10px var(--mp-font-sans);letter-spacing:.2em;text-transform:uppercase;color:var(--mp-muted);margin:0}',
  '.mp-eyebrow--accent{color:var(--mp-accent)}',
  '.mp-dateline{font:600 10px var(--mp-font-sans);letter-spacing:.2em;text-transform:uppercase;color:var(--mp-muted);margin:0}',
  '.mp-dateline b{color:var(--mp-ink);font-weight:700}',
  '.mp-display{font:700 clamp(2.2rem,3.6vw,3.2rem)/1.16 var(--mp-font-serif);letter-spacing:-.012em;max-width:22ch;text-wrap:balance;color:var(--mp-ink);margin:18px 0 0}',
  '.mp-title{font:700 clamp(1.5rem,2.4vw,2rem)/1.25 var(--mp-font-serif);letter-spacing:-.01em;color:var(--mp-ink);margin:0;text-wrap:balance}',
  '.mp-subtitle{font:700 1.08rem/1.36 var(--mp-font-serif);color:var(--mp-ink);margin:0}',
  '.mp-label{font:700 11px var(--mp-font-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mp-ink);margin:0}',
  '.mp-standfirst{font:400 1.16rem/1.62 var(--mp-font-serif);color:var(--mp-body);margin:24px 0 0;max-width:52ch}',
  '.mp-standfirst b,.mp-standfirst strong{font-weight:700;color:var(--mp-ink)}',
  '.mp-meta{font:400 12px var(--mp-font-sans);color:var(--mp-subtle)}',
  '.mp-num{font-family:var(--mp-font-mono);font-variant-numeric:tabular-nums}',
  '.mp-prose{font:400 16px/1.7 var(--mp-font-sans);color:var(--mp-body);max-width:var(--mp-prose-max)}',
  '.mp-prose h2{font:700 1.45rem/1.3 var(--mp-font-serif);color:var(--mp-ink);margin:2.2em 0 .6em}',
  '.mp-prose h3{font:700 1.12rem/1.35 var(--mp-font-serif);color:var(--mp-ink);margin:1.8em 0 .5em}',
  '.mp-prose p,.mp-prose ul,.mp-prose ol{margin:0 0 1.1em}',
  '.mp-prose ul,.mp-prose ol{padding-left:1.3em}',
  '.mp-prose ul{list-style:disc}',
  '.mp-prose ol{list-style:decimal}',
  '.mp-prose li{margin:0 0 .4em}',
  '.mp-prose a{color:var(--mp-navy);text-decoration:underline;text-underline-offset:2px}',
  '.mp-prose strong{color:var(--mp-ink);font-weight:600}',

  // Links and buttons. Square corners, like every homepage CTA.
  '.mp-link{color:var(--mp-navy);text-decoration:none;font-weight:600}',
  '.mp-link:hover{text-decoration:underline;text-underline-offset:2px}',
  '.mp-link--quiet{color:var(--mp-ink);font-weight:inherit}',
  '.mp-link--quiet:hover{color:var(--mp-navy)}',
  '.mp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;'
    + 'font:600 14px/1.2 var(--mp-font-sans);text-decoration:none;white-space:nowrap;cursor:pointer;'
    + 'border:1px solid transparent;border-radius:var(--mp-radius-none);transition:background .15s,border-color .15s,color .15s}',
  '.mp-btn--primary{background:var(--mp-navy);color:var(--mp-surface)}',
  '.mp-btn--primary:hover{background:var(--mp-navy-hover)}',
  '.mp-btn--secondary{background:var(--mp-surface);color:var(--mp-ink);border-color:var(--mp-line)}',
  '.mp-btn--secondary:hover{background:var(--mp-wash);border-color:var(--mp-ink)}',
  '.mp-btn--sm{padding:8px 14px;font-size:13px}',
  '.mp-btn[disabled],.mp-btn[aria-disabled="true"]{opacity:.55;cursor:not-allowed}',

  // Cards and stats: the homepage's hairline grid and borderless KPI row.
  '.mp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--mp-line);border:1px solid var(--mp-line)}',
  '.mp-cards--2{grid-template-columns:repeat(2,1fr)}',
  '@media(max-width:900px){.mp-cards,.mp-cards--2{grid-template-columns:1fr}}',
  '.mp-card{display:block;padding:30px 28px 26px;text-decoration:none;color:inherit;background:var(--mp-surface);transition:background .15s}',
  'a.mp-card:hover{background:var(--mp-wash)}',
  '.mp-panel{border:1px solid var(--mp-line);background:var(--mp-surface);padding:28px 30px}',
  '.mp-stats{display:grid;grid-template-columns:repeat(4,1fr)}',
  '@media(max-width:900px){.mp-stats{grid-template-columns:repeat(2,1fr);row-gap:40px}}',
  '.mp-stat{display:block;text-decoration:none;color:inherit;padding:0 24px;min-width:0}',
  '@media(max-width:900px){.mp-stat{padding:0 12px}}',
  '.mp-stat:first-child{padding-left:0}',
  '@media(min-width:901px){.mp-stat+.mp-stat{border-left:1px solid var(--mp-line)}}',
  '.mp-stat-v{font:600 2.7rem/1 var(--mp-font-mono);letter-spacing:-.035em;font-variant-numeric:tabular-nums;color:var(--mp-ink)}',
  '.mp-stat-l{font:400 13px/1.4 var(--mp-font-sans);color:var(--mp-muted);margin-top:9px}',

  // Chips: status, so warn/ok are the only colours.
  '.mp-chip{display:inline-flex;align-items:center;font:600 12px var(--mp-font-sans);color:var(--mp-muted);background:var(--mp-wash);'
    + 'border:1px solid var(--mp-line);border-radius:var(--mp-radius-chip);padding:3px 8px}',
  '.mp-chip--warn{color:var(--mp-warn);background:var(--mp-warn-bg);border-color:var(--mp-warn-line)}',
  '.mp-chip--ok{color:var(--mp-ok);background:var(--mp-ok-bg);border-color:var(--mp-ok-line)}',

  // Breadcrumbs
  '.mp-crumbs{font:500 12px var(--mp-font-sans);color:var(--mp-muted)}',
  '.mp-crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0}',
  '.mp-crumbs li+li::before{content:"/";margin-right:6px;color:var(--mp-faint)}',
  '.mp-crumbs a{color:var(--mp-muted);text-decoration:none}',
  '.mp-crumbs a:hover{color:var(--mp-navy);text-decoration:underline}',

  // Forms
  '.mp-field{display:flex;flex-direction:column;gap:6px}',
  '.mp-field-label{font:600 12px var(--mp-font-sans);color:var(--mp-ink)}',
  '.mp-field-help{font:400 12px var(--mp-font-sans);color:var(--mp-muted)}',
  '.mp-input,.mp-select,.mp-textarea{width:100%;font:400 15px/1.4 var(--mp-font-sans);color:var(--mp-ink);background:var(--mp-surface);'
    + 'border:1px solid var(--mp-line);border-radius:var(--mp-radius-control);padding:10px 12px}',
  '.mp-input::placeholder,.mp-textarea::placeholder{color:var(--mp-subtle)}',
  '.mp-input:hover,.mp-select:hover,.mp-textarea:hover{border-color:var(--mp-faint)}',
  '.mp-input:focus-visible,.mp-select:focus-visible,.mp-textarea:focus-visible{border-color:var(--mp-navy)}',
  '.mp-textarea{min-height:120px;resize:vertical}',

  // Tables and code
  '.mp-table{width:100%;border-collapse:collapse;font:400 14px/1.45 var(--mp-font-sans);color:var(--mp-body)}',
  '.mp-table th{font:600 11px var(--mp-font-sans);letter-spacing:.09em;text-transform:uppercase;color:var(--mp-muted);text-align:left;padding:10px 12px;border-bottom:1px solid var(--mp-line)}',
  '.mp-table td{padding:12px;border-bottom:1px solid var(--mp-hair);vertical-align:top}',
  '.mp-table .mp-num{text-align:right;color:var(--mp-ink)}',
  '.mp-site :is(code,kbd,samp,pre){font-family:var(--mp-font-mono)}',
  '.mp-code code{font:inherit}',
  '.mp-code{font:400 13px/1.6 var(--mp-font-mono);background:var(--mp-wash);border:1px solid var(--mp-hair);color:var(--mp-ink);padding:16px 18px;overflow-x:auto;margin:0}',
  ':not(pre)>code.mp-code-inline{font:400 .9em var(--mp-font-mono);background:var(--mp-wash);border:1px solid var(--mp-hair);border-radius:var(--mp-radius-chip);padding:1px 5px}',
].join('');

/** Everything a React public page needs, scoped to `.mp-site`. Font faces exclude Inter (see fonts.ts). */
export const MP_SITE_CSS =
  mpFontFaceCss({ includeInter: false })
  + MP_COMPONENTS_CSS
  + ACCOUNT_MENU_CSS
  + MP_ACCOUNT_OVERRIDES_CSS
  + mpA11yCss('.mp-site');

/**
 * The same stylesheet for raw-HTML route handlers (/gov, /institute, /research, /bid, the
 * Observatory report). Identical rules to MP_SITE_CSS plus the static Inter file, because a
 * route handler cannot use the root layout's next/font Inter. Pair it with MP_ROOT_PAINT_CSS.
 */
export const MP_RAW_SITE_CSS =
  mpFontFaceCss({ includeInter: true })
  + MP_COMPONENTS_CSS
  + ACCOUNT_MENU_CSS
  + MP_ACCOUNT_OVERRIDES_CSS
  + mpA11yCss('.mp-site');
